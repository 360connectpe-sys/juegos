import type { CombatState, FighterStats } from '../combat/CombatState';
import type { Vec3 } from '../types';
import { contains, ROUND_SECONDS, zoneAt, zonePlan, type Circle, type ZoneState } from './zone';

export type RoundPhase = 'waiting' | 'countdown' | 'running' | 'finished';
export interface RoundActor { id: string; name: string; feet: Vec3; grounded: boolean; connected: boolean }
export interface RoundScore extends FighterStats { id: string; name: string; lives: number; hp: number; forfeited: boolean; position?: number; survivalSeconds?: number; woodCollected?: number; structuresBuilt?: number; accuracy?: number }
export interface RoundResult { round: number; elapsed: number; reason: 'survivor' | 'limit' | 'draw'; winners: string[]; scores: RoundScore[] }
export interface RoundSnapshot {
  round: number; phase: RoundPhase; elapsed: number; countdown: number; zone: ZoneState;
  players: { id: string; lives: number; descending: boolean; protection: number }[];
  result: RoundResult | null;
}
export interface RoundHooks {
  actors(): readonly RoundActor[];
  reset(ids: readonly string[]): void;
  spawn(id: string, zone: Circle, index: number): void;
}
const zeroStats = (): FighterStats => ({ shots: 0, hits: 0, damageDealt: 0, damageTaken: 0, kills: 0, eliminations: 0, deaths: 0, healed: 0 });

/** Ciclo de partida puro; la sala solo transporta datos. No acepta mensajes de jugadores. */
export class BattleRound {
  managed = false;
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
  constructor(readonly combat: CombatState, readonly size: number, readonly seed: number, private readonly hooks: RoundHooks, readonly autoStart = true) {
    this.plan = zonePlan(size, seed);
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
    return true;
  }
  requestCountdown(): boolean {
    if (this.phase !== 'waiting') return false;
    this.phase='countdown'; this.countdown=10;return true;
  }
  cancelCountdown(): void { if (this.phase==='countdown') { this.phase='waiting';this.countdown=0; } }
  returnToLobby(force=false): boolean {
    if(!force&&this.phase!=='finished')return false;
    this.phase='waiting';this.elapsed=0;this.countdown=0;this.participants.clear();this.result=null;
    this.plan=zonePlan(this.size,this.seed+this.round+1);
    this.hooks.reset(this.hooks.actors().filter(a=>a.connected).map(a=>a.id));return true;
  }
  before(dt: number): void {
    if (this.phase === 'finished') {
      if (this.managed || this.holdResults) return;
      this.countdown = Math.max(0, this.countdown - dt);
      if (this.countdown <= 1e-9) {
        this.phase = 'waiting'; this.elapsed = 0; this.participants.clear(); this.result = null;
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
    }
    this.combat.tickLives(dt);
  }
  after(dt: number, tick: number): void {
    for (const a of this.hooks.actors()) if (a.grounded) this.combat.landed(a.id);
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
    eligible.sort((a, b) => b.lives - a.lives || b.eliminations - a.eliminations || b.hp - a.hp);
    const first = eligible[0];
    const winners = first ? eligible.filter(p => p.lives === first.lives && p.eliminations === first.eliminations && p.hp === first.hp).map(p => p.id) : [];
    const compare=(a:RoundScore,b:RoundScore)=>{
      const aliveA=!a.forfeited&&a.lives>0,aliveB=!b.forfeited&&b.lives>0;
      return Number(aliveB)-Number(aliveA)||(aliveA?b.lives-a.lives||b.eliminations-a.eliminations||b.hp-a.hp:(b.survivalSeconds??0)-(a.survivalSeconds??0));
    };
    scores.sort(compare);
    for(const s of scores)s.position=1+scores.filter(other=>compare(other,s)<0).length;
    this.result = { round: this.round, elapsed: this.elapsed, reason: winners.length === 1 ? reason : 'draw', winners, scores };
    this.history.push(structuredClone(this.result)); if (this.history.length > 10) this.history.shift();
    this.phase = 'finished'; this.countdown = 10; this.combat.active = false;
  }
  /** Teletransporte físico lo ejecuta el adaptador y limpia el historial de poses. */
  respawn(id: string): void { this.hooks.spawn(id, this.zone.current, [...this.participants.keys()].indexOf(id)); }
  snapshot(): RoundSnapshot {
    return { round: this.round, phase: this.phase, elapsed: this.elapsed, countdown: Math.max(0, this.countdown), zone: this.zone,
      players: this.hooks.actors().map(a => ({ id: a.id, lives: this.combat.lives(a.id), descending: this.combat.vitals(a.id)?.descending ?? false, protection: this.combat.vitals(a.id)?.protection ?? 0 })), result: this.result };
  }
}
