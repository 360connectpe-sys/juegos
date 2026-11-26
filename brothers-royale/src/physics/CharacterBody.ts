import type RAPIERNS from '@dimforge/rapier3d-compat';
import { PLAYER, SIMULATION } from '@shared/constants';
import {
  applyCollisionResult,
  DEFAULT_MODIFIERS,
  deriveLocomotion,
  initialMotorState,
  motorIntent,
  type MotorModifiers,
  type MotorState,
} from '@shared/movement';
import { isValidPlayerInput } from '@shared/inputValidation';
import type { CharacterSnapshot } from '@shared/reconciliation';
export type { CharacterSnapshot } from '@shared/reconciliation';
import { emptyInput, type PlayerInput, type PlayerState, type Vec3 } from '@shared/types';
import { PLAYER_GROUPS } from './groups';
import type { PhysicsWorld } from './PhysicsWorld';

export interface StepEvents {
  jumped: boolean;
  landed: boolean;
  /** Velocidad vertical al aterrizar (para animación/daño por caída futuro). */
  impactSpeed: number;
}

const FOOT_OFFSET = PLAYER.halfHeight + PLAYER.radius;

/**
 * Personaje cinemático: lógica de movimiento pura (`shared/movement`) +
 * resolución de colisiones con el KinematicCharacterController de Rapier
 * (pendientes, escalones, superficies elevadas). El mismo código correrá en el
 * servidor autoritativo y en el cliente para predicción.
 */
export class CharacterBody {
  private readonly body: RAPIERNS.RigidBody;
  private readonly collider: RAPIERNS.Collider;
  private readonly controller: RAPIERNS.KinematicCharacterController;
  private motor: MotorState = initialMotorState();
  /** Modificadores de movimiento (combate/construcción los cambiarán). */
  modifiers: MotorModifiers = { ...DEFAULT_MODIFIERS };
  readonly state: PlayerState;
  readonly lastEvents: StepEvents = { jumped: false, landed: false, impactSpeed: 0 };
  private readonly desired = { x: 0, y: 0, z: 0 };
  private readonly idleInput: PlayerInput = emptyInput(0);

  constructor(
    private readonly physics: PhysicsWorld,
    id: string,
    name: string,
    spawn: Vec3,
  ) {
    const R = physics.R;
    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + FOOT_OFFSET, spawn.z),
    );
    this.collider = physics.world.createCollider(
      R.ColliderDesc.capsule(PLAYER.halfHeight, PLAYER.radius).setCollisionGroups(PLAYER_GROUPS),
      this.body,
    );
    this.controller = physics.world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.enableAutostep(PLAYER.maxStepHeight, 0.15, false);
    this.controller.enableSnapToGround(0.35);
    this.controller.setMaxSlopeClimbAngle((PLAYER.maxSlopeDeg * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle(((PLAYER.maxSlopeDeg + 5) * Math.PI) / 180);
    this.controller.setSlideEnabled(true);

    this.state = {
      id,
      name,
      position: { ...spawn },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: 0,
      grounded: false,
      locomotion: 'fall',
      lastProcessedSeq: 0,
    };
  }

  step(input: PlayerInput, dt: number = SIMULATION.fixedDt, replaying = false): PlayerState {
    this.lastEvents.jumped = false;
    this.lastEvents.landed = false;
    this.lastEvents.impactSpeed = 0;
    if (!isValidPlayerInput(input, this.state.lastProcessedSeq)) return this.state;
    this.simulate(input, dt, replaying);
    this.state.lastProcessedSeq = input.seq;
    return this.state;
  }

  /**
   * Paso sin entrada (el servidor lo usa si un cliente deja de enviar entradas:
   * la gravedad sigue actuando). No consume secuencia, así que no altera la
   * reconciliación del cliente cuando vuelve a enviar.
   */
  stepIdle(dt: number = SIMULATION.fixedDt): PlayerState {
    this.lastEvents.jumped = false;
    this.lastEvents.landed = false;
    this.lastEvents.impactSpeed = 0;
    this.idleInput.aimYaw = this.motor.yaw;
    this.simulate(this.idleInput, dt, false);
    return this.state;
  }

  private simulate(input: PlayerInput, dt: number, replaying: boolean): void {
    const m = this.motor;
    const wasGrounded = m.grounded;
    const vyBefore = m.vy;
    const { jumped } = motorIntent(m, input, dt, this.modifiers);

    const d = this.desired;
    d.x = m.vx * dt;
    d.y = m.vy * dt;
    d.z = m.vz * dt;
    this.controller.computeColliderMovement(this.collider, d, undefined, PLAYER_GROUPS);
    const move = this.controller.computedMovement();
    const grounded = this.controller.computedGrounded() && !jumped;
    applyCollisionResult(m, d, move, grounded, dt);

    const p = this.body.translation();
    const next = { x: p.x + move.x, y: p.y + move.y, z: p.z + move.z };
    this.body.setNextKinematicTranslation(next);
    // Aplica ya la posición (sin esperar a world.step) para que pasos
    // consecutivos (p. ej. al re-simular en reconciliación) sean coherentes.
    this.body.setTranslation(next, true);
    this.physics.world.propagateModifiedBodyPositionsToColliders();

    const ev = this.lastEvents;
    ev.jumped = !replaying && jumped;
    ev.landed = !replaying && !wasGrounded && grounded;
    ev.impactSpeed = ev.landed ? -vyBefore : 0;

    const s = this.state;
    s.position.x = next.x;
    s.position.y = next.y - FOOT_OFFSET;
    s.position.z = next.z;
    s.velocity.x = move.x / dt;
    s.velocity.y = move.y / dt;
    s.velocity.z = move.z / dt;
    s.yaw = m.yaw;
    s.grounded = grounded;
    s.locomotion = deriveLocomotion(grounded, m.vx, m.vy, m.vz);
  }

  snapshot(): CharacterSnapshot {
    return {
      position: { ...this.state.position },
      motor: { ...this.motor },
      modifiers: { ...this.modifiers },
      velocity: { ...this.state.velocity },
      locomotion: this.state.locomotion,
      lastProcessedSeq: this.state.lastProcessedSeq,
    };
  }

  restore(snap: CharacterSnapshot): void {
    this.motor = { ...snap.motor };
    this.modifiers = { ...snap.modifiers };
    this.setFeet(snap.position);
    this.state.velocity = { ...snap.velocity };
    this.state.locomotion = snap.locomotion;
    this.lastEvents.jumped = false;
    this.lastEvents.landed = false;
    this.lastEvents.impactSpeed = 0;
    this.state.yaw = snap.motor.yaw;
    this.state.grounded = snap.motor.grounded;
    this.state.lastProcessedSeq = snap.lastProcessedSeq;
  }

  teleport(p: Vec3): void {
    this.motor = initialMotorState(this.motor.yaw);
    this.setFeet(p);
    this.state.velocity = { x: 0, y: 0, z: 0 };
  }

  private setFeet(p: Vec3): void {
    const t = { x: p.x, y: p.y + FOOT_OFFSET, z: p.z };
    this.body.setTranslation(t, true);
    this.body.setNextKinematicTranslation(t);
    // Sin esto el colisionador seguiría en la posición vieja hasta el próximo world.step().
    this.physics.world.propagateModifiedBodyPositionsToColliders();
    this.state.position = { ...p };
  }

  dispose(): void {
    this.physics.world.removeCharacterController(this.controller);
    this.physics.world.removeRigidBody(this.body);
  }
}
