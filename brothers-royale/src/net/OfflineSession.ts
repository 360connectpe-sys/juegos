import { CharacterBody } from '@/physics/CharacterBody';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { MatchState } from '@shared/match/MatchState';
import { Buttons, hasButton, type PlayerInput, type PlayerState, type Vec3 } from '@shared/types';
import type { ChestPlacement } from '@shared/world/layout';
import type { GameSession, PlayerIdentity } from './GameSession';
import type { ClientMatchEvent, MatchView } from './MatchView';

/** Sesión de un solo jugador: la simulación corre entera en el navegador. */
export class OfflineSession implements GameSession {
  readonly kind = 'offline' as const;
  readonly localPlayerId = 'local';
  readonly local: CharacterBody;
  private readonly spawn: Vec3;
  private readonly list: PlayerState[];
  /** Sin conexión, la autoridad de cofres e inventario es esta misma sesión. */
  readonly state: MatchState;
  onMatchEvent: ((e: ClientMatchEvent) => void) | null = null;
  private interactHeld = false;

  constructor(
    private readonly physics: PhysicsWorld,
    spawn: Vec3,
    name = 'Jugador',
    chests: readonly ChestPlacement[] = [],
    matchSeed: number = randomSeed(),
  ) {
    this.spawn = { ...spawn };
    this.local = new CharacterBody(physics, this.localPlayerId, name, spawn);
    this.list = [this.local.state];
    this.state = new MatchState(chests, matchSeed);
    this.state.addPlayer(this.localPlayerId);
    this.state.drain();
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

  selectSlot(slot: number): void {
    this.state.selectSlot(this.localPlayerId, slot);
    this.flush();
  }

  tick(input: PlayerInput, dt: number): void {
    const s = this.local.step(input, dt);
    // Mismas reglas que el servidor: flanco de interacción con la posición tras el paso.
    const interact = hasButton(input.buttons, Buttons.INTERACT);
    if (interact && !this.interactHeld) this.state.interact(this.localPlayerId, s.position, (a, b) => this.physics.lineOfSight(a, b));
    this.interactHeld = interact;
    this.flush();
    this.physics.step();
    if (s.position.y < -20) this.local.teleport(this.spawn);
  }

  players(): readonly PlayerState[] {
    return this.list;
  }

  identity(): PlayerIdentity {
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
  }

  dispose(): void {
    this.local.dispose();
  }
}

function randomSeed(): number {
  const c = globalThis.crypto;
  return c?.getRandomValues ? c.getRandomValues(new Uint32Array(1))[0]! : Math.floor(Math.random() * 0xffffffff);
}
