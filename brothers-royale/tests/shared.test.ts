import { describe, expect, it } from 'vitest';
import { PLAYER } from '@shared/constants';
import { clamp, rotateTowards, wrapAngle } from '@shared/math';
import {
  applyCollisionResult,
  deriveLocomotion,
  desiredHorizontalVelocity,
  initialMotorState,
  ISO_SCREEN_UP,
  motorIntent,
  screenToWorld,
  stepYaw,
  yawFromDirection,
} from '@shared/movement';
import { createRng, hash2 } from '@shared/random';
import { Buttons, emptyInput } from '@shared/types';

describe('math', () => {
  it('clamp y wrapAngle', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
  });
  it('rotateTowards toma el camino corto y respeta el paso máximo', () => {
    expect(rotateTowards(3, -3, 0.1)).toBeCloseTo(3.1);
    expect(rotateTowards(0, 0.05, 0.1)).toBe(0.05);
  });
});

describe('random', () => {
  it('es determinista por semilla', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(seqA);
    expect(Array.from({ length: 5 }, createRng(43))).not.toEqual(seqA);
    seqA.forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
    seqA.forEach((v) => expect(v).toBeLessThan(1));
  });
  it('hash2 es estable', () => {
    expect(hash2(3, 7, 1)).toBe(hash2(3, 7, 1));
    expect(hash2(3, 7, 1)).not.toBe(hash2(7, 3, 1));
  });
});

describe('movement', () => {
  it('arriba en pantalla va hacia -X -Z en el mundo', () => {
    const v = screenToWorld(0, 1);
    expect(v.x).toBeCloseTo(ISO_SCREEN_UP.x);
    expect(v.y).toBeCloseTo(ISO_SCREEN_UP.y);
    expect(v.x).toBeLessThan(0);
    expect(v.y).toBeLessThan(0);
  });
  it('derecha en pantalla va hacia +X -Z', () => {
    const v = screenToWorld(1, 0);
    expect(v.x).toBeGreaterThan(0);
    expect(v.y).toBeLessThan(0);
  });
  it('limita la magnitud a 1 en diagonal y conserva la analógica', () => {
    expect(Math.hypot(screenToWorld(1, 1).x, screenToWorld(1, 1).y)).toBeCloseTo(1);
    const half = screenToWorld(0.5, 0);
    expect(Math.hypot(half.x, half.y)).toBeCloseTo(0.5);
  });
  it('velocidad deseada: caminar, correr y quieto', () => {
    const input = { ...emptyInput(1), moveX: 1 };
    expect(desiredHorizontalVelocity(input).x).toBeCloseTo(PLAYER.walkSpeed);
    expect(desiredHorizontalVelocity({ ...input, buttons: Buttons.SPRINT }).x).toBeCloseTo(PLAYER.sprintSpeed);
    expect(desiredHorizontalVelocity({ ...input, buttons: Buttons.SPRINT }, { speedMultiplier: 0.5, canSprint: false, canJump: true, faceMovement: true }).x).toBeCloseTo(PLAYER.walkSpeed * 0.5);
    expect(desiredHorizontalVelocity(emptyInput())).toEqual({ x: 0, y: 0 });
  });
  it('el yaw gira hacia la dirección de movimiento', () => {
    expect(yawFromDirection(0, 1)).toBeCloseTo(0);
    expect(yawFromDirection(1, 0)).toBeCloseTo(Math.PI / 2);
    let yaw = 0;
    for (let i = 0; i < 60; i++) yaw = stepYaw(yaw, 1, 0, 1 / 30);
    expect(yaw).toBeCloseTo(Math.PI / 2);
    expect(stepYaw(1.23, 0, 0, 1)).toBe(1.23);
  });
});

describe('motor del personaje (puro)', () => {
  const dt = 1 / 30;
  it('acelera progresivamente y gira suave hacia el movimiento', () => {
    const m = initialMotorState();
    m.grounded = true;
    motorIntent(m, { ...emptyInput(1), moveX: 1 }, dt);
    expect(m.vx).toBeGreaterThan(0);
    expect(m.vx).toBeLessThan(PLAYER.walkSpeed);
    expect(m.yaw).toBeGreaterThan(0);
    expect(m.yaw).toBeLessThan(Math.PI / 2);
    for (let i = 0; i < 30; i++) motorIntent(m, { ...emptyInput(1), moveX: 1 }, dt);
    expect(m.vx).toBeCloseTo(PLAYER.walkSpeed);
    expect(m.yaw).toBeCloseTo(Math.PI / 2);
  });
  it('salta solo en el flanco de pulsación y respeta el coyote time', () => {
    const m = initialMotorState();
    m.grounded = true;
    const jump = { ...emptyInput(1), buttons: Buttons.JUMP };
    expect(motorIntent(m, jump, dt).jumped).toBe(true);
    m.grounded = true; // aunque vuelva a tocar suelo, mantener pulsado no re-salta
    expect(motorIntent(m, jump, dt).jumped).toBe(false);
    // Coyote: deja el suelo y salta 2 ticks después.
    const c = initialMotorState();
    c.grounded = true;
    motorIntent(c, emptyInput(), dt);
    c.grounded = false;
    motorIntent(c, emptyInput(), dt);
    expect(motorIntent(c, jump, dt).jumped).toBe(true);
  });
  it('búfer de salto: pulsar justo antes de aterrizar salta al tocar suelo', () => {
    const m = initialMotorState();
    m.grounded = false;
    m.vy = -5;
    motorIntent(m, { ...emptyInput(1), buttons: Buttons.JUMP }, dt);
    expect(m.vy).toBeLessThan(0);
    applyCollisionResult(m, { x: 0, y: -0.2, z: 0 }, { x: 0, y: -0.1, z: 0 }, true, dt);
    expect(motorIntent(m, emptyInput(2), dt).jumped).toBe(true);
  });
  it('la gravedad es más fuerte al caer y hay velocidad terminal', () => {
    const m = initialMotorState();
    for (let i = 0; i < 200; i++) motorIntent(m, emptyInput(), dt);
    expect(m.vy).toBe(PLAYER.terminalVelocity);
  });
  it('choque con pared y techo corta la velocidad', () => {
    const m = initialMotorState();
    m.vx = 5;
    m.vy = 6;
    applyCollisionResult(m, { x: 5 * dt, y: 6 * dt, z: 0 }, { x: 0, y: 0, z: 0 }, false, dt);
    expect(m.vx).toBe(0);
    expect(m.vy).toBe(0);
  });
  it('apuntar (AIM) orienta hacia aimYaw en lugar de hacia el movimiento', () => {
    const m = initialMotorState();
    m.grounded = true;
    for (let i = 0; i < 30; i++) motorIntent(m, { ...emptyInput(1), moveX: 1, buttons: Buttons.AIM, aimYaw: Math.PI }, dt);
    expect(Math.abs(m.yaw)).toBeCloseTo(Math.PI);
  });
  it('deriva la locomoción para animar', () => {
    expect(deriveLocomotion(true, 0, 0, 0)).toBe('idle');
    expect(deriveLocomotion(true, 3, 0, 0)).toBe('walk');
    expect(deriveLocomotion(true, 0, 0, 8)).toBe('run');
    expect(deriveLocomotion(false, 0, 3, 0)).toBe('jump');
    expect(deriveLocomotion(false, 0, -3, 0)).toBe('fall');
  });
});
