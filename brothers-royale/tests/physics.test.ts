import { beforeAll, describe, expect, it } from 'vitest';
import { CharacterBody } from '@/physics/CharacterBody';
import { loadRapier, PhysicsWorld, type Rapier } from '@/physics/PhysicsWorld';
import { SIMULATION } from '@shared/constants';
import { Buttons, emptyInput, type PlayerInput } from '@shared/types';
import { worldColliders } from '@shared/world/colliders';
import { generateWorldLayout } from '@shared/world/layout';
import { insideState } from '@shared/world/prefab';
import { HOUSE, TOWER } from '@shared/world/structures';
import { terrainHeight } from '@shared/world/terrain';

let R: Rapier;
beforeAll(async () => {
  R = await loadRapier();
});

const layout = generateWorldLayout();
const house = layout.structures.find((s) => s.def.id === 'house')!;
const tower = layout.structures.find((s) => s.def.id === 'tower')!;

function makeWorld() {
  const physics = new PhysicsWorld(R);
  physics.addTerrain(layout.terrain);
  worldColliders(layout).forEach((c) => physics.addStatic(c));
  physics.step();
  return physics;
}

let seq = 0;
function run(body: CharacterBody, physics: PhysicsWorld, input: Partial<PlayerInput>, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    body.step({ ...emptyInput(++seq), ...input }, SIMULATION.fixedDt);
    physics.step();
  }
  return body.state;
}

/** Camina hacia un punto (x, z) con control proporcional simple. */
function walkTo(body: CharacterBody, physics: PhysicsWorld, x: number, z: number, maxTicks = 300) {
  for (let i = 0; i < maxTicks; i++) {
    const dx = x - body.state.position.x;
    const dz = z - body.state.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.25) break;
    run(body, physics, { moveX: dx / Math.max(d, 1), moveZ: dz / Math.max(d, 1) }, 1);
  }
  return body.state;
}

describe('física (Rapier)', () => {
  it('el heightfield coincide con la función de altura compartida', () => {
    const physics = makeWorld();
    const step = layout.terrain.size / 64;
    for (const [c, r] of [[10, 12], [50, 8], [20, 55], [44, 40]] as const) {
      const x = -layout.terrain.size / 2 + c * step;
      const z = -layout.terrain.size / 2 + r * step;
      if (layout.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 1)) continue;
      expect(physics.groundHeightAt(x, z)).toBeCloseTo(terrainHeight(x, z, layout.terrain), 3);
    }
    physics.dispose();
  });

  it('cae, se apoya, acelera hasta la velocidad de caminar y frena', () => {
    const physics = makeWorld();
    const body = new CharacterBody(physics, 'p', 'P', { x: layout.spawn.x, y: 3, z: layout.spawn.z });
    let s = run(body, physics, {}, 60);
    expect(s.grounded).toBe(true);
    expect(s.locomotion).toBe('idle');
    s = run(body, physics, { moveZ: 1 }, 2);
    expect(Math.abs(s.velocity.z)).toBeLessThan(5); // acelera, no es instantáneo
    s = run(body, physics, { moveZ: 1 }, 20);
    expect(s.velocity.z).toBeCloseTo(5, 0);
    expect(s.locomotion).toBe('walk');
    s = run(body, physics, { moveZ: 1, buttons: Buttons.SPRINT }, 20);
    expect(s.locomotion).toBe('run');
    s = run(body, physics, {}, 15);
    expect(Math.hypot(s.velocity.x, s.velocity.z)).toBeLessThan(0.1);
    physics.dispose();
  });

  it('movimiento analógico en 360° (diagonal)', () => {
    const physics = makeWorld();
    const body = new CharacterBody(physics, 'd', 'D', { x: layout.spawn.x, y: 0.2, z: layout.spawn.z });
    run(body, physics, {}, 10);
    const s = run(body, physics, { moveX: -Math.SQRT1_2, moveZ: Math.SQRT1_2 }, 25);
    expect(s.velocity.x).toBeCloseTo(-5 * Math.SQRT1_2, 0);
    expect(s.velocity.z).toBeCloseTo(5 * Math.SQRT1_2, 0);
    physics.dispose();
  });

  it('las paredes bloquean y la puerta deja entrar', () => {
    const physics = makeWorld();
    const front = house.z + HOUSE.depth / 2;
    const blocked = new CharacterBody(physics, 'a', 'A', { x: house.x + 3, y: 0.2, z: front + 2 });
    run(blocked, physics, {}, 10);
    let s = run(blocked, physics, { moveZ: -1 }, 60);
    expect(s.position.z).toBeGreaterThan(front);
    const door = new CharacterBody(physics, 'b', 'B', { x: house.x, y: 0.2, z: front + 2 });
    run(door, physics, {}, 10);
    s = run(door, physics, { moveZ: -1 }, 30);
    expect(s.position.z).toBeLessThan(front - 1);
    expect(insideState(house, s.position.x, s.position.y, s.position.z)).toBe('lower');
    physics.dispose();
  });

  it('sube la escalera interior hasta la planta alta', () => {
    const physics = makeWorld();
    const body = new CharacterBody(physics, 'c', 'C', { x: house.x, y: 0.2, z: house.z + HOUSE.depth / 2 + 1.5 });
    run(body, physics, {}, 10);
    const stairX = house.x - HOUSE.width / 2 + HOUSE.wallThickness + 0.6;
    walkTo(body, physics, house.x, house.z + 3.6);
    walkTo(body, physics, stairX, house.z + 3.7);
    let s = walkTo(body, physics, stairX, house.z - 1.5);
    s = run(body, physics, {}, 10);
    expect(s.position.y).toBeCloseTo(HOUSE.groundHeight, 1);
    expect(s.grounded).toBe(true);
    expect(insideState(house, s.position.x, s.position.y, s.position.z)).toBe('upper');
    // Camina por la entreplanta sin caerse y la barandilla impide saltar al vacío.
    s = walkTo(body, physics, house.x + 3, house.z - 2);
    expect(s.position.y).toBeCloseTo(HOUSE.groundHeight, 1);
    s = run(body, physics, { moveZ: 1 }, 40);
    expect(s.position.y).toBeCloseTo(HOUSE.groundHeight, 1);
    physics.dispose();
  });

  it('sube la escalera del mirador hasta la plataforma elevada', () => {
    const physics = makeWorld();
    const h = TOWER.size / 2;
    const sx = tower.x - h + TOWER.stairWidth / 2;
    const body = new CharacterBody(physics, 't', 'T', { x: sx, y: 0.2, z: tower.z + h + TOWER.stairRun + 1.5 });
    run(body, physics, {}, 10);
    let s = walkTo(body, physics, sx, tower.z);
    s = run(body, physics, {}, 10);
    expect(s.position.y).toBeCloseTo(tower.y + TOWER.height, 1);
    expect(s.grounded).toBe(true);
    physics.dispose();
  });

  it('salta (con búfer de salto), sube a una caja y vuelve al suelo', () => {
    const physics = makeWorld();
    const body = new CharacterBody(physics, 'j', 'J', { x: layout.spawn.x, y: 0.5, z: layout.spawn.z });
    let s = run(body, physics, {}, 30);
    const ground = s.position.y;
    s = run(body, physics, { buttons: Buttons.JUMP }, 1);
    expect(body.lastEvents.jumped).toBe(true);
    s = run(body, physics, { buttons: Buttons.JUMP }, 8); // mantener pulsado no re-salta
    expect(s.position.y).toBeGreaterThan(ground + 0.8);
    expect(s.locomotion === 'jump' || s.locomotion === 'fall').toBe(true);
    s = run(body, physics, {}, 40);
    expect(s.grounded).toBe(true);
    expect(s.position.y).toBeCloseTo(ground, 1);
    physics.dispose();
  });

  it('snapshot/restore reproduce exactamente la simulación (base de la reconciliación)', () => {
    const physics = makeWorld();
    const body = new CharacterBody(physics, 'r', 'R', { x: layout.spawn.x, y: 0.2, z: layout.spawn.z });
    run(body, physics, {}, 10);
    const snap = body.snapshot();
    const inputs: Partial<PlayerInput>[] = [
      { moveX: 1 },
      { moveX: 1, buttons: Buttons.JUMP },
      { moveX: 0.5, moveZ: -0.5 },
      { moveZ: 1, buttons: Buttons.SPRINT },
    ];
    const replay = () => {
      for (const inp of inputs) run(body, physics, inp, 5);
      return { ...body.state.position };
    };
    const a = replay();
    body.restore(snap);
    const b = replay();
    expect(b.x).toBeCloseTo(a.x, 5);
    expect(b.y).toBeCloseTo(a.y, 5);
    expect(b.z).toBeCloseTo(a.z, 5);
    physics.dispose();
  });
});
