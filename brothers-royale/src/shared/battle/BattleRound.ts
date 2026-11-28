import type { CombatState, FighterStats } from '../combat/CombatState';
import type { Vec3 } from '../types';
import { constrain, contains, ROUND_SECONDS, zoneAt, zonePlan, type Circle, type ZoneState } from './zone';
import { FLIGHT, mapCircle, planeAt, respawnRoute, startRoute, type AirMode, type PlaneRoute, type PlanePose } from './flight';
import { PLAYER } from '../constants';
import { SupplyDrops, type SupplyDrop, type SupplySpot } from './supply';

export type RoundPhase = 'waiting' | 'countdown' | 'running' | 'finished';
export interface RoundActor { id: string; name: string; feet: Vec3; grounded: boolean; connected: boolean }
export interface RoundScore extends FighterStats { id: string; name: string; lives: number; hp: number; forfeited: boolean; position?: number; survivalSeconds?: number; woodCollected?: number; structuresBuilt?: number; accuracy?: number }
export interface RoundResult { round: number; elapsed: number; reason: 'survivor' | 'limit' | 'draw'; winners: string[]; scores: RoundScore[] }
export interface RoundSnapshot {
  round: number; phase: RoundPhase; elapsed: number; countdown: number; zone: ZoneState;
  players: { id: string; lives: number; descending: boolean; protection: number; air: AirMode; plane?: number }[];
  result: RoundResult | null;
  /** Fase 12: aviones en vuelo (ruta completa; la posición se calcula con `elapsed`). */
  planes: PlaneRoute[];
  /** Fase 16: cajas de suministros (descendiendo o en el suelo). */
  drops: SupplyDrop[];
}
export interface RoundHooks {
  actors(): readonly RoundActor[];
  reset(ids: readonly string[]): void;
  /** Coloca el cuerpo en el avión o en el punto de salto (teletransporte autoritativo). */
  spawn(id: string, at: Vec3): void;
  /** Altura del suelo en (x, z): decide cuándo se abre el paracaídas. */
  ground?(x: number, z: number): number | null;
  /** ¿Viaja en avión? (los muñecos de práctica no: reaparecen cayendo como antes). */
  flies?(id: string): boolean;
  /** Fase 16: altura del suelo si (x, z) es un aterrizaje válido para una caja; null si no. */
  supplySpot?: SupplySpot;
}
interface AirState { mode: AirMode; plane: number; bound: 'map' | 'zone'; jumpY: number }
const zeroStats = (): FighterStats => ({ shots: 0, hits: 0, damageDealt: 0, damageTaken: 0, kills: 0, eliminations: 0, deaths: 0, healed: 0 });

/** Ciclo de partida puro; la sala solo transporta datos. No acepta mensajes de jugadores. */
export class BattleRound {
  /** Valor inicial de `transport` (las pruebas de sistemas ajenos al avión lo desactivan). */
  static defaultTransport = true;
  managed = false;
  /**
   * Fase 12: inicio y reapariciones en avión. false = comportamiento anterior (inicio en tierra y
   * reaparición cayendo del cielo); lo usan las pruebas de sistemas que no dependen del transporte.
   */
  transport = BattleRound.defaultTransport;
  holdResults = false;
  phase: RoundPhase = 'waiting';
  round = 0;
  elapsed = 0;
  countdown = 0;
  readonly history: RoundResult[] = [];
  private plan: Circle[];
  private readonly participants = new Map<string, { name: string; forfeited: boolean; saved?: RoundScore; eliminatedAt?: number; woodCollected?: number; structuresBuilt?: number }>();
  private stormClock = 0;
  private wallNow: number | null = null;
  private wallStart: number | null = null;
  private result: RoundResult | null = null;
  private readonly air = new Map<string, AirState>();
  private planes: PlaneRoute[] = [];
  private planeSerial = 0;
  /** Fase 16: suministros aéreos (autoridad de la ronda). */
  readonly supplies: SupplyDrops;
  private readonly pose: PlanePose = { x: 0, y: 0, z: 0, yaw: 0, progress: 0 };
  constructor(readonly combat: CombatState, readonly size: number, readonly seed: number, private readonly hooks: RoundHooks, readonly autoStart = true) {
    this.plan = zonePlan(size, seed);
    this.supplies = new SupplyDrops(seed, size);
    combat.externalLifeClock = true;
  }
  syncWallTime(now: number): void { if (Number.isFinite(now)) this.wallNow = now; }
  get zone(): ZoneState { return zoneAt(this.plan, this.elapsed); }
  get active(): boolean { return this.phase === 'running'; }
  canAct(id: string): boolean {
    return (!this.managed || this.phase === 'running') && this.phase !== 'finished' && !this.combat.isDead(id) && (this.phase !== 'running' || this.participants.has(id));
  }
  /** Altas durante la ronda esperan la siguiente: una sesión nueva no recupera vidas. */
  joined(id: string): void { if (this.phase === 'running' || this.phase === 'finished') this.combat.exclude(id); }
  harvest(id:string,amount:number):void{const p=this.participants.get(id);if(this.active&&p&&amount>0&&Number.isFinite(amount))p.woodCollected=(p.woodCollected??0)+amount;}
  built(id:string):void{const p=this.participants.get(id);if(this.active&&p)p.structuresBuilt=(p.structuresBuilt??0)+1;}
  departed(id: string): void {
    const p = this.participants.get(id);
    if (p && this.phase === 'running') { p.forfeited = true; p.eliminatedAt=this.elapsed; p.saved = this.score(id, p); }
    this.air.delete(id);
  }
  start(): boolean {
    const actors = this.hooks.actors().filter(a => a.connected);
    if (this.phase === 'running' || this.phase === 'finished' || actors.length < (this.autoStart ? 2 : 1)) return false;
    this.round++; this.elapsed = 0; this.stormClock = 0; this.wallStart = this.wallNow;
    this.plan = zonePlan(this.size, (this.seed + this.round) >>> 0);
    this.participants.clear(); this.result = null;
    for (const a of actors) this.participants.set(a.id, { name: a.name, forfeited: false });
    this.hooks.reset(actors.map(a => a.id));
    this.phase = 'running'; this.countdown = 0;
    // Fase 12: todos empiezan dentro del avión inicial (ruta aleatoria con la semilla de la ronda).
    this.air.clear(); this.planeSerial = 0;
    this.supplies.reset((this.seed + this.round) >>> 0);
    const route = startRoute(this.size, (this.seed + this.round) >>> 0, 0);
    this.planes = [route];
    if (this.transport) for (const a of actors) if (this.hooks.flies?.(a.id) ?? true) this.board(a.id, route, 'map');
    return true;
  }
  requestCountdown(): boolean {
    if (this.phase !== 'waiting') return false;
    this.phase='countdown'; this.countdown=10;return true;
  }
  cancelCountdown(): void { if (this.phase==='countdown') { this.phase='waiting';this.countdown=0; } }
  returnToLobby(force=false): boolean {
    if(!force&&this.phase!=='finished')return false;
    this.phase='waiting';this.elapsed=0;this.countdown=0;this.participants.clear();this.result=null;this.clearAir();
    this.plan=zonePlan(this.size,this.seed+this.round+1);
    this.hooks.reset(this.hooks.actors().filter(a=>a.connected).map(a=>a.id));return true;
  }
  before(dt: number): void {
    if (this.phase === 'finished') {
      if (this.managed || this.holdResults) return;
      this.countdown = Math.max(0, this.countdown - dt);
      if (this.countdown <= 1e-9) {
        this.phase = 'waiting'; this.elapsed = 0; this.participants.clear(); this.result = null; this.clearAir();
        this.plan = zonePlan(this.size, this.seed + this.round + 1);
        this.hooks.reset(this.hooks.actors().filter(a => a.connected).map(a => a.id));
      }
      return;
    }
    if (this.phase === 'waiting' || this.phase === 'countdown') {
      if (this.managed) {
        if (this.phase === 'countdown') { this.countdown -= dt; if (this.countdown <= 1e-9) this.start(); }
      } else if (this.autoStart && this.hooks.actors().filter(a => a.connected).length >= 2) {
        if (this.phase === 'waiting') { this.phase = 'countdown'; this.countdown = 10; }
        else { this.countdown -= dt; if (this.countdown <= 1e-9) this.start(); }
      } else { this.phase = 'waiting'; this.countdown = 0; }
    } else {
      this.elapsed = Math.min(ROUND_SECONDS, this.elapsed + dt);
      if (this.wallStart !== null && this.wallNow !== null) this.elapsed = Math.min(ROUND_SECONDS, Math.max(this.elapsed, this.wallNow - this.wallStart));
      if (this.elapsed >= ROUND_SECONDS - 1e-9) { this.elapsed = ROUND_SECONDS; this.finish('limit'); return; }
      this.flyPlanes();
      if (this.hooks.supplySpot) this.supplies.step(this.elapsed, this.zone.current, this.hooks.supplySpot);
    }
    this.combat.tickLives(dt);
  }
  after(dt: number, tick: number): void {
    for (const a of this.hooks.actors()) {
      const air = this.air.get(a.id);
      if (this.combat.isDead(a.id)) { this.air.delete(a.id); continue; }
      if (!air) { if (a.grounded) this.combat.landed(a.id); continue; }
      if (air.mode === 1) continue;
      if (a.grounded) { this.air.delete(a.id); this.combat.landed(a.id); continue; }
      // Caída libre → paracaídas automático cerca del suelo.
      if (air.mode === 2 && air.jumpY - a.feet.y >= FLIGHT.minFallBeforeChute) {
        const ground = this.hooks.ground?.(a.feet.x, a.feet.z);
        if (ground !== null && ground !== undefined && a.feet.y - ground <= FLIGHT.chuteHeight) air.mode = 3;
      }
    }
    if (!this.active) return;
    this.stormClock += dt;
    if (this.stormClock >= 1 - 1e-9) {
      this.stormClock -= 1;
      const zone = this.zone;
      if (zone.damage > 0) for (const a of this.hooks.actors()) {
        const p = this.participants.get(a.id);
        if (p && !p.forfeited && !contains(zone.current, a.feet)) this.combat.environmentalDamage(a.id, zone.damage, a.feet, tick);
      }
    }
    for(const [id,p] of this.participants)if(this.combat.lives(id)===0&&p.eliminatedAt===undefined)p.eliminatedAt=this.elapsed;
    const survivors = [...this.participants].filter(([id, p]) => !p.forfeited && this.combat.lives(id) > 0);
    if (survivors.length <= 1 && this.participants.size >= 2) this.finish(survivors.length ? 'survivor' : 'draw');
  }
  private score(id: string, p: { name: string; forfeited: boolean; saved?: RoundScore; eliminatedAt?: number; woodCollected?: number; structuresBuilt?: number }): RoundScore {
    if (p.saved) return { ...p.saved };
    return { ...zeroStats(), ...this.combat.log.stats.get(id), id, name: p.name, forfeited: p.forfeited,
      damageDealt:this.combat.log.stats.get(id)?.effectiveDamageDealt??this.combat.log.stats.get(id)?.damageDealt??0,
      damageTaken:this.combat.log.stats.get(id)?.effectiveDamageTaken??this.combat.log.stats.get(id)?.damageTaken??0,
      lives: p.forfeited ? 0 : this.combat.lives(id), hp: p.forfeited ? 0 : this.combat.hp(id),
      survivalSeconds:p.eliminatedAt??this.elapsed,woodCollected:p.woodCollected??0,structuresBuilt:p.structuresBuilt??0,
      accuracy:Math.min(100,100*(this.combat.log.stats.get(id)?.accurateShots??0)/Math.max(1,this.combat.log.stats.get(id)?.rangedShots??0)) };
  }
  private finish(reason: RoundResult['reason']): void {
    const scores = [...this.participants].map(([id, p]) => this.score(id, p));
    const eligible = scores.filter(p => !p.forfeited && p.lives > 0);
    // Fase 12: desempate por vidas, después salud y después eliminaciones de jugadores.
    eligible.sort((a, b) => b.lives - a.lives || b.hp - a.hp || b.eliminations - a.eliminations);
    const first = eligible[0];
    const winners = first ? eligible.filter(p => p.lives === first.lives && p.hp === first.hp && p.eliminations === first.eliminations).map(p => p.id) : [];
    const compare=(a:RoundScore,b:RoundScore)=>{
      const aliveA=!a.forfeited&&a.lives>0,aliveB=!b.forfeited&&b.lives>0;
      return Number(aliveB)-Number(aliveA)||(aliveA?b.lives-a.lives||b.hp-a.hp||b.eliminations-a.eliminations:(b.survivalSeconds??0)-(a.survivalSeconds??0));
    };
    scores.sort(compare);
    for(const s of scores)s.position=1+scores.filter(other=>compare(other,s)<0).length;
    this.result = { round: this.round, elapsed: this.elapsed, reason: winners.length === 1 ? reason : 'draw', winners, scores };
    this.history.push(structuredClone(this.result)); if (this.history.length > 10) this.history.shift();
    this.phase = 'finished'; this.countdown = 10; this.combat.active = false; this.clearAir();
  }
  /** Teletransporte físico lo ejecuta el adaptador y limpia el historial de poses. */
  respawn(id: string): void {
    if (!this.transport || !(this.hooks.flies?.(id) ?? true)) {
      // Muñecos de práctica: caen del cielo dentro de la zona (comportamiento de la fase 8).
      const zone = this.zone.current, index = Math.max(0, [...this.participants.keys()].indexOf(id));
      const angle = index * 2.399963, d = Math.min(12, zone.radius * .4);
      const x = zone.x + Math.sin(angle) * d, z = zone.z + Math.cos(angle) * d;
      this.hooks.spawn(id, { x, y: (this.hooks.ground?.(x, z) ?? 0) + 30, z });
      return;
    }
    // Fase 12: avión propio cuya ruta termina dentro de la zona segura actual. No altera
    // los aviones de los demás.
    const route = respawnRoute(this.zone.current, this.size, (this.seed + this.round) >>> 0, ++this.planeSerial, this.elapsed);
    this.planes.push(route);
    this.board(id, route, 'zone');
  }
  /** 0 en tierra, 1 avión, 2 caída libre, 3 paracaídas. */
  airMode(id: string): AirMode { return this.air.get(id)?.mode ?? 0; }
  /** Límite horizontal del descenso (mapa en el salto inicial, zona segura al reaparecer). */
  airBound(id: string): Circle | null {
    const a = this.air.get(id);
    return !a ? null : a.bound === 'map' ? mapCircle(this.size) : this.zone.current;
  }
  /** Construir, interactuar y atacar: solo en tierra. */
  canFight(id: string): boolean { return this.canAct(id) && !this.air.has(id); }
  /** El jugador salta del avión (o el servidor lo hace al final de la ruta). */
  jump(id: string): boolean {
    const a = this.air.get(id);
    const route = a && a.mode === 1 ? this.planes.find(r => r.id === a.plane) : undefined;
    if (!a || !route) return false;
    const pose = planeAt(route, this.elapsed, this.pose);
    const at = constrain(this.airBound(id)!, pose, PLAYER.radius + 0.5);
    this.combat.leavePlane(id);
    a.mode = 2; a.jumpY = pose.y - 2;
    this.hooks.spawn(id, { x: at.x, y: a.jumpY, z: at.z });
    return true;
  }
  /** Abrir el paracaídas antes de tiempo (tras caer un mínimo). */
  openChute(id: string, feetY: number): boolean {
    const a = this.air.get(id);
    if (!a || a.mode !== 2 || a.jumpY - feetY < FLIGHT.minFallBeforeChute) return false;
    a.mode = 3; return true;
  }
  private board(id: string, route: PlaneRoute, bound: AirState['bound']): void {
    this.air.set(id, { mode: 1, plane: route.id, bound, jumpY: route.y });
    this.combat.beginDescent(id, true);
    const pose = planeAt(route, this.elapsed, this.pose);
    this.hooks.spawn(id, { x: pose.x, y: pose.y, z: pose.z });
  }
  /** Mueve a los pasajeros con su avión y los hace saltar al final de la ruta. */
  private flyPlanes(): void {
    for (const [id, a] of this.air) {
      if (a.mode !== 1) continue;
      const route = this.planes.find(r => r.id === a.plane);
      if (!route) { this.air.delete(id); continue; }
      const pose = planeAt(route, this.elapsed, this.pose);
      if (pose.progress >= 1) this.jump(id);
      else this.hooks.spawn(id, { x: pose.x, y: pose.y, z: pose.z });
    }
    // Un avión sin pasajeros desaparece al terminar su ruta.
    this.planes = this.planes.filter(r => this.elapsed < r.start + r.duration + 2 || [...this.air.values()].some(a => a.mode === 1 && a.plane === r.id));
  }
  private clearAir(): void { this.air.clear(); this.planes = []; this.supplies.reset((this.seed + this.round) >>> 0); }
  /** Fase 16: abrir la caja aterrizada más cercana (en tierra, vivo). Primera petición gana. */
  openSupply(id: string, feet: Vec3) { return this.active && this.canFight(id) ? this.supplies.open(feet, this.elapsed) : null; }
  snapshot(): RoundSnapshot {
    return { round: this.round, phase: this.phase, elapsed: this.elapsed, countdown: Math.max(0, this.countdown), zone: this.zone,
      players: this.hooks.actors().map(a => ({ id: a.id, lives: this.combat.lives(a.id), descending: this.combat.vitals(a.id)?.descending ?? false, protection: this.combat.vitals(a.id)?.protection ?? 0, air: this.airMode(a.id), ...(this.air.get(a.id)?.mode === 1 ? { plane: this.air.get(a.id)!.plane } : {}) })), result: this.result,
      planes: [...this.planes, ...this.supplies.planes].map(r => ({ ...r })), drops: this.supplies.drops.map(d => ({ ...d })) };
  }
}
