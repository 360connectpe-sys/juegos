import { CharacterBody } from '@/physics/CharacterBody';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { CombatState, type AttackContext, type TargetPose, type Vitals } from '@shared/combat/CombatState';
import { MatchState } from '@shared/match/MatchState';
import { Buttons, hasButton, type PlayerInput, type PlayerState, type Vec3 } from '@shared/types';
import type { ChestPlacement } from '@shared/world/layout';
import type { ClientCombatEvent, CombatView } from './CombatView';
import type { GameSession, PlayerIdentity } from './GameSession';
import type { ClientMatchEvent, MatchView } from './MatchView';

/** Muñeco de práctica (solo sin conexión): no se mueve ni ataca; vuelve a los 3 s. */
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
  private readonly dummies = new Map<string, Dummy>();
  onMatchEvent: ((e: ClientMatchEvent) => void) | null = null;
  onCombatEvent: ((e: ClientCombatEvent) => void) | null = null;
  private interactHeld = false;
  private tickCount = 0;
  private readonly ctx: AttackContext;

  constructor(
    private readonly physics: PhysicsWorld,
    spawn: Vec3,
    name = 'Jugador',
    chests: readonly ChestPlacement[] = [],
    matchSeed: number = randomSeed(),
    dummies: readonly Vec3[] = [],
  ) {
    this.spawn = { ...spawn };
    this.local = new CharacterBody(physics, this.localPlayerId, name, spawn);
    this.list = [this.local.state];
    this.state = new MatchState(chests, matchSeed);
    this.state.addPlayer(this.localPlayerId);
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
    this.fight.onRespawn = (id) => {
      if (id === this.localPlayerId) this.local.teleport(this.spawn);
    };
    this.fight.drain();
    this.ctx = {
      feet: this.local.state.position,
      grounded: true,
      speed: 0,
      dt: 1 / 30,
      tick: 0,
      targets: () => this.targets(),
      castStatic: (o, d, max) => physics.castStatic(o, d, max),
    };
  }

  get match(): MatchView {
    const s = this.state;
    const id = this.localPlayerId;
    return {
      chests: s.chests,
      opened: s.opened,
      pickups: s.pickups,
      get inventory() {
        return s.inventory(id) ?? null;
      },
    };
  }

  get combat(): CombatView {
    const f = this.fight;
    const id = this.localPlayerId;
    return {
      get vitals(): Vitals {
        return f.vitals(id)!;
      },
    };
  }

  selectSlot(slot: number): void {
    this.state.selectSlot(this.localPlayerId, slot);
    this.flush();
  }

  private *targets(): Generator<TargetPose> {
    yield { id: this.localPlayerId, feet: this.local.state.position };
    for (const [id, d] of this.dummies) yield { id, feet: d.state.position };
  }

  tick(input: PlayerInput, dt: number): void {
    const dead = this.fight.isDead(this.localPlayerId);
    const move = dead ? { seq: input.seq, moveX: 0, moveZ: 0, buttons: 0, aimYaw: input.aimYaw } : input;
    const s = this.local.step(move, dt);
    // Mismas reglas que el servidor: flanco de interacción con la posición tras el paso.
    const interact = hasButton(move.buttons, Buttons.INTERACT);
    if (interact && !this.interactHeld) this.state.interact(this.localPlayerId, s.position, (a, b) => this.physics.lineOfSight(a, b));
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
      d.state.gear = this.fight.gear(id);
    }
    this.local.state.gear = this.fight.gear(this.localPlayerId);
    this.tickCount++;
    this.flush();
    this.physics.step();
    if (s.position.y < -20) this.local.teleport(this.spawn);
  }

  players(): readonly PlayerState[] {
    return this.list;
  }

  identity(id: string): PlayerIdentity {
    const d = this.dummies.get(id);
    if (d) return { name: d.name, color: d.color };
    return { name: this.local.state.name, color: 0 };
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
    this.local.dispose();
  }
}

function randomSeed(): number {
  const c = globalThis.crypto;
  return c?.getRandomValues ? c.getRandomValues(new Uint32Array(1))[0]! : Math.floor(Math.random() * 0xffffffff);
}
