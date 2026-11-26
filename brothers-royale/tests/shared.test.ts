import { describe, expect, it } from 'vitest';
import { PLAYER } from '@shared/constants';
import { clamp, rotateTowards, wrapAngle } from '@shared/math';
import { desiredHorizontalVelocity, ISO_SCREEN_UP, screenToWorld, stepYaw, yawFromDirection } from '@shared/movement';
import { createRng, hash2 } from '@shared/random';
import { emptyInput } from '@shared/types';

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
    expect(desiredHorizontalVelocity({ ...input, sprint: true }).x).toBeCloseTo(PLAYER.sprintSpeed);
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
