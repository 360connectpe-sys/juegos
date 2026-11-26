import type RAPIERNS from '@dimforge/rapier3d-compat';
import { PLAYER, SIMULATION } from '@shared/constants';
import { desiredHorizontalVelocity, stepYaw } from '@shared/movement';
import type { PlayerInput, PlayerState, Vec3 } from '@shared/types';
import type { PhysicsWorld } from './PhysicsWorld';

/**
 * Personaje cinemático con el KinematicCharacterController de Rapier.
 * `step(input, dt)` es la función de simulación que más adelante ejecutará
 * también el servidor (y el cliente para predicción).
 */
export class CharacterBody {
  private readonly body: RAPIERNS.RigidBody;
  private readonly collider: RAPIERNS.Collider;
  private readonly controller: RAPIERNS.KinematicCharacterController;
  private verticalVelocity = 0;
  readonly state: PlayerState;

  constructor(
    private readonly physics: PhysicsWorld,
    id: string,
    name: string,
    spawn: Vec3,
  ) {
    const R = physics.R;
    const footOffset = PLAYER.halfHeight + PLAYER.radius;
    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + footOffset, spawn.z),
    );
    this.collider = physics.world.createCollider(R.ColliderDesc.capsule(PLAYER.halfHeight, PLAYER.radius), this.body);
    this.controller = physics.world.createCharacterController(0.02);
    this.controller.enableAutostep(0.4, 0.2, false);
    this.controller.enableSnapToGround(0.4);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((35 * Math.PI) / 180);
    this.controller.setSlideEnabled(true);

    this.state = {
      id,
      name,
      position: { ...spawn },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: 0,
      grounded: false,
      lastProcessedSeq: 0,
    };
  }

  step(input: PlayerInput, dt: number = SIMULATION.fixedDt): PlayerState {
    const s = this.state;
    const v = desiredHorizontalVelocity(input);

    if (s.grounded && input.jump) this.verticalVelocity = PLAYER.jumpVelocity;
    this.verticalVelocity += SIMULATION.gravity * dt;
    if (s.grounded && this.verticalVelocity < 0) this.verticalVelocity = Math.max(this.verticalVelocity, -2);

    this.controller.computeColliderMovement(this.collider, {
      x: v.x * dt,
      y: this.verticalVelocity * dt,
      z: v.y * dt,
    });
    const m = this.controller.computedMovement();
    const p = this.body.translation();
    const next = { x: p.x + m.x, y: p.y + m.y, z: p.z + m.z };
    this.body.setNextKinematicTranslation(next);
    // Actualiza la posición del colisionador ya (sin esperar a world.step) para
    // que varios pasos seguidos del controlador sean coherentes.
    this.body.setTranslation(next, true);

    s.grounded = this.controller.computedGrounded();
    if (s.grounded && this.verticalVelocity < 0) this.verticalVelocity = 0;
    // Golpe contra el techo: corta la subida.
    if (this.verticalVelocity > 0 && m.y < this.verticalVelocity * dt * 0.5) this.verticalVelocity = 0;

    const footOffset = PLAYER.halfHeight + PLAYER.radius;
    s.velocity = { x: m.x / dt, y: m.y / dt, z: m.z / dt };
    s.position = { x: next.x, y: next.y - footOffset, z: next.z };
    s.yaw = stepYaw(s.yaw, input.moveX, input.moveZ, dt);
    s.lastProcessedSeq = input.seq;
    return s;
  }

  teleport(p: Vec3): void {
    const footOffset = PLAYER.halfHeight + PLAYER.radius;
    this.body.setTranslation({ x: p.x, y: p.y + footOffset, z: p.z }, true);
    this.verticalVelocity = 0;
    this.state.position = { ...p };
    this.state.velocity = { x: 0, y: 0, z: 0 };
  }

  dispose(): void {
    this.physics.world.removeCharacterController(this.controller);
    this.physics.world.removeRigidBody(this.body);
  }
}
