import { unpackZombies, ZombieDirector, type PublicZombie } from '@/physics/ZombieDirector';
import { BattleRound } from '@shared/battle/BattleRound';
import { DEFAULT_MODIFIERS } from '@shared/movement';
import { WORLD } from '@shared/constants';
import type { BuildingWorld } from '@/physics/BuildingWorld';
import type { BuildRequest } from '@shared/building/BuildingState';
import { CharacterBody } from '@/physics/CharacterBody';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { CombatState, type AttackContext, type TargetPose, type Vitals } from '@shared/combat/CombatState';
import { MatchState } from '@shared/match/MatchState';
import { Buttons, hasButton, type PlayerInput, type PlayerState, type Vec3 } from '@shared/types';
import type { ChestPlacement } from '@shared/world/layout';
import type { ClientCombatEvent, CombatView } from './CombatView';
import type { GameSession, PlayerIdentity } from './GameSession';
import type { ClientMatchEvent, MatchView } from './MatchView';

/** Muñeco de práctica (solo sin conexión): no ataca; comparte vidas y reaparición. */
interface Dummy {
  state: PlayerState;
  name: string;
  color: number;
}

/**
 * Sesión de un solo jugador: la simulación corre entera en el navegador. Para
 * probar las armas sin servidor hay muñecos de práctica que reciben daño.
 */
export class OfflineSession implements GameSession {
  readonly kind = 'offline' as const;
  readonly localPlayerId = 'local';
  readonly local: CharacterBody;
  private readonly spawn: Vec3;
  private readonly list: PlayerState[];
  /** Sin conexión, la autoridad de cofres e inventario es esta misma sesión. */
  readonly state: MatchState;
  /** … y también la del combate (mismas reglas que el servidor). */
  readonly fight: CombatState;
  readonly round: BattleRound;
  private readonly dummies = new Map<string, Dummy>();
  onMatchEvent: ((e: ClientMatchEvent) => void) | null = null;
  onCombatEvent: ((e: ClientCombatEvent) => void) | null = null;
  private interactHeld = false;
  private jumpHeld = false;
  private tickCount = 0;
  private readonly ctx: AttackContext;

  constructor(
    private readonly physics: PhysicsWorld,
    spawn: Vec3,
    name = 'Jugador',
    chests: readonly ChestPlacement[] = [],
    matchSeed: number = randomSeed(),
    dummies: readonly Vec3[] = [],
    readonly building?: BuildingWorld,
  ) {
    this.spawn = { ...spawn };
    this.local = new CharacterBody(physics, this.localPlayerId, name, spawn);
    this.list = [this.local.state];
    this.state = new MatchState(chests, matchSeed);
    this.state.addPlayer(this.localPlayerId);
    // Una sesión offline nueva no hereda geometría ni materiales de una sala anterior.
    building?.reset();
    building?.state.addPlayer(this.localPlayerId);
    this.state.drain();
    this.fight = new CombatState(this.state, matchSeed);
    this.fight.addFighter(this.localPlayerId);
    dummies.forEach((p, i) => {
      const id = `dummy-${i + 1}`;
      const state: PlayerState = {
        id, name: `Muñeco ${i + 1}`, position: { ...p }, velocity: { x: 0, y: 0, z: 0 },
        yaw: Math.atan2(spawn.x - p.x, spawn.z - p.z), grounded: true, locomotion: 'idle', lastProcessedSeq: 0, gear: 0,
      };
      this.dummies.set(id, { state, name: state.name, color: 5 + (i % 3) });
      this.fight.addFighter(id, true);
      this.list.push(state);
    });
    this.round = new BattleRound(this.fight, building?.layout.terrain.size ?? WORLD.size, matchSeed, {
      actors: () => this.list.map(s => ({ id: s.id, name: s.name, feet: s.position, grounded: s.grounded, connected: true })),
      reset: ids => {
        this.state.reset(ids); building?.reset();
        for (const id of ids) building?.state.addPlayer(id);
        this.fight.reset(ids);
        for (const id of this.dummies.keys()) { this.fight.removeFighter(id); this.fight.addFighter(id, true); }
        for (const [i, dummy] of [...this.dummies.values()].entries()) {
          dummy.state.position = { ...dummies[i]! }; dummy.state.velocity = { x: 0, y: 0, z: 0 }; dummy.state.grounded = true; dummy.state.gear = 0;
        }
        this.zombieDirector?.reset();
        this.local.modifiers = { ...DEFAULT_MODIFIERS }; this.local.teleport(this.spawn);
        this.onMatchEvent?.({ type: 'reset' });
      },
      spawn: (id, at) => {
        if (id === this.localPlayerId) this.local.teleport(at);
        else {
          const dummy = this.dummies.get(id);
          if (dummy) { dummy.state.position = { ...at }; dummy.state.grounded = false; dummy.state.locomotion = 'fall'; }
        }
      },
      ground: (x, z) => physics.groundHeightAt(x, z, 120),
      // Los muñecos de práctica no suben al avión.
      flies: id => !this.dummies.has(id),
    }, false);
    this.round.holdResults=true;
    // Fase 12: zombis también sin conexión (misma autoridad que el servidor).
    this.zombieDirector = building ? new ZombieDirector({
      physics, layout: building.layout, combat: this.fight, round: this.round,
      players: () => [{ id: this.localPlayerId, feet: this.local.state.position }],
      drop: (item, at) => this.state.dropLoot(item, at),
      giveWood: (id, n) => { building.state.giveWood(id, n); },
    }, matchSeed) : null;
    if(building){building.state.onHarvest=(id,n)=>this.round.harvest(id,n);building.state.onBuild=id=>this.round.built(id);}
    this.fight.onRespawn = id => this.round.respawn(id);
    this.fight.drain();
    this.ctx = {
      feet: this.local.state.position,
      grounded: true,
      speed: 0,
      dt: 1 / 30,
      tick: 0,
      targets: () => this.targets(),
      damageObstacle: (by, o, d, range, damage, axe) => building?.damageRay(by, o, d, range, damage, axe) ?? false,
      castStatic: (o, d, max) => physics.castStatic(o, d, max),
    };
  }

  // Vistas creadas UNA vez: el juego las consulta varias veces por frame y antes
  // se creaba un objeto nuevo en cada acceso (basura constante para el recolector).
  private matchView: MatchView | null = null;
  private combatView: CombatView | null = null;
  private vitalsCache: Vitals | null = null;
  private battleCache: ReturnType<BattleRound["snapshot"]> | null = null;

  get match(): MatchView {
    if (!this.matchView) {
      const s = this.state;
      const id = this.localPlayerId;
      this.matchView = {
        chests: s.chests,
        opened: s.opened,
        pickups: s.pickups,
        get inventory() {
          return s.inventory(id) ?? null;
        },
      };
    }
    return this.matchView;
  }

  get combat(): CombatView {
    if (!this.combatView) {
      const self = this;
      this.combatView = {
        get vitals(): Vitals {
          return (self.vitalsCache ??= self.fight.vitals(self.localPlayerId)!);
        },
      };
    }
    return this.combatView;
  }

  /** Invalida lo cacheado: cualquier cambio de ronda, combate o vida pasa por aquí. */
  private invalidate(): void {
    this.vitalsCache = null;
    this.battleCache = null;
  }

  requestBuild(request: BuildRequest): boolean {
    return this.round.canFight(this.localPlayerId) && (this.building?.state.place(this.localPlayerId, request, this.local.state.position) ?? false);
  }

  resetPractice():void{this.invalidate();this.round.returnToLobby(true);this.invalidate();}
  returnToLobby():boolean{this.invalidate();const r=this.round.returnToLobby();this.invalidate();return r;}
  rematch():boolean{this.invalidate();if(this.round.phase==='finished')this.round.returnToLobby();const r=this.round.start();this.invalidate();return r;}
  setProfile(profile:{name:string;skin:number}):boolean{this.local.state.name=profile.name;this.localColor=profile.skin;return true;}
  private localColor=0;
  /** Instantánea de la ronda, calculada una vez por tick (recorre a todos los jugadores). */
  get battle() { return (this.battleCache ??= this.round.snapshot()); }
  startRound(): boolean { this.invalidate(); const r = this.round.start(); this.invalidate(); return r; }

  equipScope(equipped: boolean): void {
    if(this.round.canFight(this.localPlayerId) && this.state.equipScope(this.localPlayerId,equipped,this.local.state.position)) {
      this.fight.equipmentChanged(this.localPlayerId); this.invalidate(); this.flush();
    }
  }

  selectSlot(slot: number): void {
    this.invalidate();
    this.state.selectSlot(this.localPlayerId, slot);
    this.flush();
    this.invalidate();
  }

  private *targets(): Generator<TargetPose> {
    yield { id: this.localPlayerId, feet: this.local.state.position };
    for (const [id, d] of this.dummies) yield { id, feet: d.state.position };
    if (this.zombieDirector) yield* this.zombieDirector.poses();
  }

  private readonly zombieDirector: ZombieDirector | null;
  private zombieCache: { tick: number; list: readonly PublicZombie[] } = { tick: -1, list: [] };
  zombies(): readonly PublicZombie[] {
    const d = this.zombieDirector;
    if (!d || !d.zombies.size) return [];
    if (this.zombieCache.tick !== this.tickCount) {
      const packed: number[] = [];
      d.pack(packed);
      this.zombieCache = { tick: this.tickCount, list: unpackZombies(packed) };
    }
    return this.zombieCache.list;
  }

  tick(input: PlayerInput, dt: number): void {
    this.invalidate();
    try {
      this.tickInner(input, dt);
    } finally {
      this.invalidate();
    }
  }

  private tickInner(input: PlayerInput, dt: number): void {
    this.round.before(dt);
    // Mismas reglas que el servidor (fase 12): avión = congelado; caída/paracaídas = motor aéreo.
    const air = this.round.airMode(this.localPlayerId);
    this.local.modifiers = { ...DEFAULT_MODIFIERS, frozen: !this.round.canAct(this.localPlayerId) || air === 1,
      ...(air >= 2 ? { descent: this.round.airBound(this.localPlayerId)!, air: air as 2 | 3, canJump: false } : this.fight.vitals(this.localPlayerId)?.descending ? { descent: this.round.zone.current, canSprint: false, canJump: false } : {}) };
    const dead = !this.round.canAct(this.localPlayerId);
    const move = dead ? { seq: input.seq, moveX: 0, moveZ: 0, buttons: 0, aimYaw: input.aimYaw } : input;
    const s = this.local.step(move, dt);
    const jump = hasButton(move.buttons, Buttons.JUMP);
    if (!dead && air === 1 && jump) this.round.jump(this.localPlayerId);
    else if (!dead && air === 2 && jump && !this.jumpHeld) this.round.openChute(this.localPlayerId, s.position.y);
    this.jumpHeld = jump;
    // Mismas reglas que el servidor: flanco de interacción con la posición tras el paso.
    const interact = hasButton(move.buttons, Buttons.INTERACT);
    if (interact && !this.interactHeld && this.round.canFight(this.localPlayerId)) this.state.interact(this.localPlayerId, s.position, (a, b) => this.physics.lineOfSight(a, b));
    this.interactHeld = interact;
    if (dead) this.fight.idle(this.localPlayerId, dt);
    else {
      const c = this.ctx;
      c.feet = s.position;
      c.grounded = s.grounded;
      c.speed = Math.hypot(s.velocity.x, s.velocity.z);
      c.dt = dt;
      c.tick = this.tickCount;
      this.fight.step(this.localPlayerId, input, c);
    }
    for (const [id, d] of this.dummies) {
      this.fight.idle(id, dt);
      if (this.fight.vitals(id)?.descending) {
        const p = d.state.position, ground = this.physics.groundHeightAt(p.x, p.z) ?? this.spawn.y;
        p.y = Math.max(ground, p.y - 6 * dt); d.state.velocity.y = -6;
        if (p.y <= ground) { d.state.grounded = true; d.state.locomotion = 'idle'; d.state.velocity.y = 0; this.fight.landed(id); }
      }
      d.state.gear = this.fight.gear(id);
    }
    this.local.state.gear = this.fight.gear(this.localPlayerId);
    this.zombieDirector?.step(dt, this.tickCount);
    this.round.after(dt, this.tickCount);
    this.tickCount++;
    this.flush();
    this.physics.step();
    if (s.position.y < -20 && !this.fight.isDead(this.localPlayerId)) this.fight.environmentalDamage(this.localPlayerId, 100, s.position, this.tickCount, 'fall');
  }

  players(): readonly PlayerState[] {
    return this.list;
  }

  identity(id: string): PlayerIdentity {
    const d = this.dummies.get(id);
    if (d) return { name: d.name, color: d.color };
    return { name: this.local.state.name, color: this.localColor };
  }

  localPlayer(): PlayerState {
    return this.local.state;
  }

  private flush(): void {
    for (const e of this.state.drain()) {
      if (e.type === 'inventory') this.onMatchEvent?.({ type: 'inventory', inventory: e.inventory });
      else if (e.type === 'notice') this.onMatchEvent?.({ type: 'notice', code: e.code });
      else this.onMatchEvent?.(e);
    }
    for (const e of this.fight.drain()) {
      if (e.type === 'vitals') {
        if (e.id === this.localPlayerId) this.onCombatEvent?.({ type: 'vitals', vitals: e.vitals });
      } else if (e.type === 'healed') this.onCombatEvent?.({ type: 'healed', amount: e.amount });
      else if (e.type === 'empty') this.onCombatEvent?.({ type: 'empty' });
      else this.onCombatEvent?.(e);
    }
  }

  dispose(): void {
    this.zombieDirector?.reset();
    this.local.dispose();
  }
}

function randomSeed(): number {
  const c = globalThis.crypto;
  return c?.getRandomValues ? c.getRandomValues(new Uint32Array(1))[0]! : Math.floor(Math.random() * 0xffffffff);
}
