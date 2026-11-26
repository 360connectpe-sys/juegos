import { CharacterBody } from '@/physics/CharacterBody';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import type { PlayerInput, PlayerState, Vec3 } from '@shared/types';
import type { GameSession } from './GameSession';

/** Sesión de un solo jugador: la simulación corre entera en el navegador. */
export class OfflineSession implements GameSession {
  readonly kind = 'offline' as const;
  readonly localPlayerId = 'local';
  private readonly local: CharacterBody;
  private readonly spawn: Vec3;

  constructor(
    private readonly physics: PhysicsWorld,
    spawn: Vec3,
    name = 'Jugador',
  ) {
    this.spawn = { ...spawn };
    this.local = new CharacterBody(physics, this.localPlayerId, name, spawn);
  }

  tick(input: PlayerInput, dt: number): void {
    const s = this.local.step(input, dt);
    this.physics.step();
    if (s.position.y < -20) this.respawn();
  }

  private respawn(): void {
    this.local.teleport(this.spawn);
  }

  players(): readonly PlayerState[] {
    return [this.local.state];
  }

  dispose(): void {
    this.local.dispose();
  }
}
