import { describe, expect, it } from 'vitest';
import { anchorOf, BUILD, buildTop, FLOOR_TOP, groundRange, planBuild, quadrantFromYaw, QUADRANT_DIR, rampRise, rotationForYaw, type BuildKind, type BuildRequest } from '@shared/building/BuildingState';
import { BuildingWorld } from '@/physics/BuildingWorld';
import { CharacterBody } from '@/physics/CharacterBody';
import { loadRapier, PhysicsWorld } from '@/physics/PhysicsWorld';
import { emptyInput, type Vec3 } from '@shared/types';
import { generateWorldLayout } from '@shared/world/layout';
import { terrainHeight } from '@shared/world/terrain';

const base = generateWorldLayout();
const layout = { ...base, trees: [], structures: [] };
const ground = (x: number, z: number) => terrainHeight(x, z, layout.terrain);

async function world() {
  const physics = new PhysicsWorld(await loadRapier());
  physics.addTerrain(layout.terrain);
  physics.step();
  const w = new BuildingWorld(physics, layout, () => []);
  w.state.addPlayer('a');
  w.state.wood.set('a', 999);
  return { physics, w, dispose: () => { w.dispose(); physics.dispose(); } };
}

/** Planifica como el cliente y coloca como la autoridad. */
function build(w: BuildingWorld, kind: BuildKind, feet: Vec3, yaw: number): BuildRequest {
  const plan = planBuild(kind, feet, yaw, { pieces: w.state.pieces.values(), ground, canPlace: (r) => w.state.canPlace('a', r, feet) });
  expect(plan.valid, `${kind} ${JSON.stringify(plan.request)}`).toBe(true);
  expect(w.state.place('a', plan.request, feet)).toBe(true);
  return plan.request;
}

describe('orientación y casilla automáticas', () => {
  it('cuadrante, rotación de pared/rampa y subida de la rampa hacia donde se mira', () => {
    for (let q = 0; q < 4; q++) {
      const yaw = (q * Math.PI) / 2 + 0.3; // no hace falta mirar exacto
      expect(quadrantFromYaw(yaw)).toBe(q);
      expect(rotationForYaw('wall', yaw)).toBe(q);
      expect(rampRise(rotationForYaw('ramp', yaw))).toEqual(QUADRANT_DIR[q]);
    }
    expect(quadrantFromYaw(-Math.PI / 2)).toBe(3);
  });
});

describe('encaje de piezas con física real', () => {
  it.each([0, 1, 2, 3])('rampa → suelo a ras → rampa → suelo, subiendo sin elegir nivel (orientación %i)', async (q) => {
    const { w, dispose } = await world();
    try {
      const yaw = (q * Math.PI) / 2;
      const [dx, dz] = QUADRANT_DIR[q]!;
      const g = ground(0, 0);
      let feet: Vec3 = { x: 0, y: g, z: 0 };
      const ramp1 = build(w, 'ramp', feet, yaw);
      expect(ramp1).toMatchObject({ x: dx * 3 + 0, z: dz * 3 + 0, y: groundRange(ground, ramp1.x, ramp1.z)[1] });
      // De pie arriba de la rampa: el suelo siguiente queda A RAS de su extremo alto.
      feet = { x: ramp1.x, y: ramp1.y + 2.6, z: ramp1.z };
      const floor1 = build(w, 'floor', feet, yaw);
      expect(floor1).toMatchObject({ x: ramp1.x + dx * 3 + 0, z: ramp1.z + dz * 3 + 0 });
      expect(buildTop(floor1)).toBeCloseTo(ramp1.y + 3, 5);
      // Sobre el suelo: otra rampa empieza en su superficie y otro suelo sigue arriba.
      feet = { x: floor1.x, y: buildTop(floor1), z: floor1.z };
      const ramp2 = build(w, 'ramp', feet, yaw);
      expect(ramp2.y).toBeCloseTo(buildTop(floor1), 5);
      feet = { x: ramp2.x, y: ramp2.y + 2.6, z: ramp2.z };
      const floor2 = build(w, 'floor', feet, yaw);
      expect(buildTop(floor2)).toBeCloseTo(ramp2.y + 3, 5);
      expect(w.state.pieces.size).toBe(4);
      // La cadena se sostiene: romper la primera rampa derriba lo que dependía de ella.
      w.state.hitPiece(1, BUILD.hp);
      expect(w.state.pieces.size).toBe(0);
    } finally { dispose(); }
  });

  it('suelo encima de una pared y pared sobre ese suelo, sin seleccionar la altura', async () => {
    const { w, dispose } = await world();
    try {
      const feet = { x: 0, y: ground(0, 0), z: 0 };
      // Fase 15: la pared va en el borde de la casilla propia; el suelo de la casilla siguiente
      // queda a ras del terreno (antes chocaba con una pared en su centro y subía 3 m).
      // (el suelo primero: detrás de una pared ya no se puede construir).
      const floor = build(w, 'floor', feet, 0);
      expect(floor).toMatchObject({ x: 0, z: 3 });
      const wall = build(w, 'wall', feet, 0);
      expect(anchorOf(wall)).toEqual({ x: 0, z: 1.5 });
      expect(floor.y).toBeLessThan(wall.y + 0.5);
      // De pie sobre la pared (a su altura), el suelo de arriba se apoya en su borde superior
      // y la pared siguiente se apila encima.
      const up = build(w, 'floor', { x: 0, y: wall.y + 3, z: 0.4 }, 0);
      expect(up.y).toBeCloseTo(wall.y + 3, 5);
      const top = build(w, 'wall', { x: 0, y: wall.y + 3, z: 0 }, 0);
      expect(top.y).toBeCloseTo(buildTop(up), 5); // sobre el suelo de arriba
    } finally { dispose(); }
  });

  it('suelo sobre ladera: se apoya en el punto más alto (antes se rechazaba)', async () => {
    const { w, dispose } = await world();
    try {
      // Una casilla con desnivel real del terreno pero dentro del límite.
      let cell: [number, number] | null = null;
      for (let x = -48; x <= 48 && !cell; x += 3) for (let z = -48; z <= 48 && !cell; z += 3) {
        const [min, max] = groundRange(ground, x, z);
        if (max - min > 0.25 && max - min < 1 && min > 0) cell = [x, z];
      }
      expect(cell).not.toBeNull();
      const [x, z] = cell!;
      const feet = { x, y: ground(x, z - 3), z: z - 3 };
      const plan = planBuild('floor', feet, 0, { pieces: w.state.pieces.values(), ground, canPlace: (r) => w.state.canPlace('a', r, feet) });
      expect(plan.request).toMatchObject({ x, z, y: groundRange(ground, x, z)[1] });
      expect(plan.valid).toBe(true);
      // Flotar por encima del punto más alto sigue sin estar permitido.
      expect(w.state.canPlace('a', { ...plan.request, y: plan.request.y + 0.3 }, feet)).toBe(false);
    } finally { dispose(); }
  });

  it.each([0, 1, 2, 3])('el personaje sube la rampa y pasa al suelo sin quedar atrapado (orientación %i)', async (q) => {
    const { physics, w, dispose } = await world();
    let body: CharacterBody | undefined;
    try {
      const yaw = (q * Math.PI) / 2;
      const [dx, dz] = QUADRANT_DIR[q]!;
      const g = ground(0, 0);
      const ramp = build(w, 'ramp', { x: 0, y: g, z: 0 }, yaw);
      build(w, 'floor', { x: ramp.x, y: ramp.y + 2.6, z: ramp.z }, yaw);
      physics.step();
      body = new CharacterBody(physics, 'a', 'A', { x: -dx * 1, y: g + 0.05, z: -dz * 1 });
      const rampEnd = ramp.x * dx + ramp.z * dz + 1.5; // borde entre rampa y suelo
      let onFloor = false;
      for (let seq = 1; seq <= 110 && !onFloor; seq++) {
        body.step({ ...emptyInput(seq), moveX: dx, moveZ: dz }, 1 / 30);
        physics.step();
        const p = body.state.position;
        // Ya en el suelo (1 m pasado el borde) y a la altura de su superficie: no se atascó.
        onFloor = p.x * dx + p.z * dz > rampEnd + 1 && Math.abs(p.y - (ramp.y + 3)) < 0.1;
      }
      expect(onFloor, JSON.stringify(body.state.position)).toBe(true);
    } finally { body?.dispose(); dispose(); }
  });

  it('la superficie del suelo al final de la rampa coincide con el extremo alto (sin escalón)', () => {
    const ramp: BuildRequest = { kind: 'ramp', x: 0, y: 0, z: 0, rotation: 2 };
    const floorY = ramp.y + 3 - FLOOR_TOP;
    expect(buildTop({ kind: 'floor', x: 0, y: floorY, z: 3, rotation: 0 })).toBeCloseTo(3, 6);
  });
});
