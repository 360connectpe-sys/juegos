import { beforeAll, describe, expect, it } from 'vitest';
import { CharacterBody } from '@/physics/CharacterBody';
import { loadRapier, PhysicsWorld, type Rapier } from '@/physics/PhysicsWorld';
import { SIMULATION } from '@shared/constants';
import { worldColliders } from '@shared/world/colliders';
import { generateWorldLayout } from '@shared/world/layout';
import { terrainHeight } from '@shared/world/terrain';
import { emptyInput, type PlayerInput } from '@shared/types';

let R: Rapier;
beforeAll(async () => {
  R = await loadRapier();
});

const layout = generateWorldLayout();

function makeWorld() {
  const physics = new PhysicsWorld(R);
  physics.addTerrain(layout.terrain);
  worldColliders(layout).forEach((c) => physics.addStatic(c));
  physics.step();
  return physics;
}

function run(body: CharacterBody, physics: PhysicsWorld, input: Partial<PlayerInput>, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    body.step({ ...emptyInput(i), ...input }, SIMULATION.fixedDt);
    physics.step();
  }
  return body.state;
}

describe('física (Rapier)', () => {
  it('el heightfield coincide con la función de altura compartida', () => {
    const physics = makeWorld();
    // Puntos sobre vértices de la rejilla, lejos de árboles y casa.
    const step = layout.terrain.size / 64;
    for (const [c, r] of [[10, 12], [50, 8], [20, 55], [44, 40]] as const) {
      const x = -layout.terrain.size / 2 + c * step;
      const z = -layout.terrain.size / 2 + r * step;
      const tooClose = layout.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 1);
      if (tooClose) continue;
      expect(physics.groundHeightAt(x, z)).toBeCloseTo(terrainHeight(x, z, layout.terrain), 3);
    }
    physics.dispose();
  });

  it('el personaje cae, se apoya en el suelo y camina', () => {
    const physics = makeWorld();
    const spawn = { x: layout.spawn.x, y: 3, z: layout.spawn.z };
    const body = new CharacterBody(physics, 'p', 'P', spawn);
    let s = run(body, physics, {}, 60);
    expect(s.grounded).toBe(true);
    expect(s.position.y).toBeCloseTo(terrainHeight(spawn.x, spawn.z, layout.terrain), 1);
    const x0 = s.position.x;
    s = run(body, physics, { moveX: 1 }, 30);
    expect(s.position.x - x0).toBeGreaterThan(4);
    physics.dispose();
  });

  it('las paredes de la casa bloquean y la puerta deja pasar', () => {
    const physics = makeWorld();
    const h = layout.house;
    // Frente a la pared izquierda de la fachada: camina hacia -Z y choca.
    const blocked = new CharacterBody(physics, 'a', 'A', { x: h.x - 2.5, y: 0.2, z: h.z + h.depth / 2 + 2 });
    let s = run(blocked, physics, {}, 10);
    s = run(blocked, physics, { moveZ: -1 }, 60);
    expect(s.position.z).toBeGreaterThan(h.z + h.depth / 2);
    // Frente a la puerta: entra a la casa.
    const door = new CharacterBody(physics, 'b', 'B', { x: h.x, y: 0.2, z: h.z + h.depth / 2 + 2 });
    run(door, physics, {}, 10);
    s = run(door, physics, { moveZ: -1 }, 30);
    expect(s.position.z).toBeLessThan(h.z + h.depth / 2 - 1);
    physics.dispose();
  });

  it('salta y vuelve al suelo', () => {
    const physics = makeWorld();
    const body = new CharacterBody(physics, 'j', 'J', { x: layout.spawn.x, y: 0.5, z: layout.spawn.z });
    let s = run(body, physics, {}, 30);
    const ground = s.position.y;
    s = run(body, physics, { jump: true }, 1);
    s = run(body, physics, {}, 8);
    expect(s.position.y).toBeGreaterThan(ground + 0.8);
    expect(s.grounded).toBe(false);
    s = run(body, physics, {}, 40);
    expect(s.grounded).toBe(true);
    expect(s.position.y).toBeCloseTo(ground, 1);
    physics.dispose();
  });
});
