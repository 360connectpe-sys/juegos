/** Fase 15.3 — construcción: bordes, habitaciones cerradas, puertas, rampa-suelo-rampa y orientaciones. */
import { beforeAll, describe, expect, it } from 'vitest';
import { BuildingWorld } from '@/physics/BuildingWorld';
import { loadRapier, PhysicsWorld, type Rapier } from '@/physics/PhysicsWorld';
import { anchorOf, buildTop, planBuild, validBuildRequest, type BuildKind, type BuildRequest } from '@shared/building/BuildingState';
import { worldColliders } from '@shared/world/colliders';
import { buildSlots, generateWorldLayout, variantOf } from '@shared/world/layout';
import { terrainHeight } from '@shared/world/terrain';
import { rotateXZ } from '@shared/math';
import type { Vec3 } from '@shared/types';
import { BuildingView } from '@/game/world/BuildingView';
import { createTrees } from '@/game/world/Trees';

let R: Rapier;
beforeAll(async () => { R = await loadRapier(); });
const full = generateWorldLayout();

function world(withStructures = false) {
  const physics = new PhysicsWorld(R);
  const layout = withStructures ? full : { ...full, trees: [], structures: [] };
  physics.addTerrain(layout.terrain);
  if (withStructures) worldColliders(layout, true).forEach((c) => physics.addStatic(c));
  physics.step();
  const w = new BuildingWorld(physics, layout, () => []);
  w.state.addPlayer('a'); w.state.wood.set('a', 999);
  const ground = (x: number, z: number) => terrainHeight(x, z, layout.terrain);
  const plan = (kind: BuildKind, feet: Vec3, yaw: number, turn = 0) => planBuild(kind, feet, yaw, {
    pieces: w.state.pieces.values(), ground, canPlace: (r) => w.state.canPlace('a', r, feet), slots: buildSlots(layout),
  }, turn);
  const build = (kind: BuildKind, feet: Vec3, yaw: number, turn = 0): BuildRequest => {
    const p = plan(kind, feet, yaw, turn);
    expect(p.valid, `${kind} ${JSON.stringify(p.request)}`).toBe(true);
    expect(w.state.place('a', p.request, feet)).toBe(true);
    return p.request;
  };
  return { w, physics, plan, build, layout, dispose: () => { w.dispose(); physics.dispose(); } };
}
/** Casilla llana (todas las esquinas a la misma altura) para no depender del terreno. */
function flatCell(avoid = false): Vec3 {
  for (let x = -45; x <= 45; x += 3) for (let z = -45; z <= 45; z += 3) {
    const h = terrainHeight(x, z, full.terrain);
    if (avoid && full.structures.some((st) => Math.hypot(st.x - x, st.z - z) < st.def.clearRadius + 6)) continue;
    if (avoid && full.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 5)) continue;
    if (avoid && h > 0.2) return { x, y: h, z };
    if (h > -0.1 && [[-4, -4], [4, 4], [-4, 4], [4, -4], [0, 7], [0, -7], [7, 0], [-7, 0]].every(([a, b]) => Math.abs(terrainHeight(x + a!, z + b!, full.terrain) - h) < (avoid ? 0.15 : 0.01))) return { x, y: h, z };
  }
  throw new Error('sin casilla llana');
}

describe('fase 15.3: construcción', () => {
  it('suelo + cuatro paredes en los cuatro bordes + techo: habitación cerrada sin paredes centrales ni duplicadas', () => {
    const { w, build, plan, dispose } = world();
    try {
      const c = flatCell();
      // El suelo de la casilla se pide desde la casilla vecina (−Z) mirando hacia +Z.
      const floor = build('floor', { ...c, z: c.z - 3 }, 0);
      expect(floor).toMatchObject({ x: c.x, z: c.z });
      const inside = { x: c.x, y: buildTop(floor), z: c.z };
      const walls = [0, 1, 2, 3].map((q) => build('wall', inside, q * Math.PI / 2));
      const edges = walls.map(anchorOf);
      // Cada pared en un borde distinto, a 1,5 m del centro: ninguna en el centro de la plataforma.
      for (const e of edges) expect(Math.hypot(e.x - c.x, e.z - c.z)).toBeCloseTo(1.5, 5);
      expect(new Set(edges.map((e) => `${e.x},${e.z}`)).size).toBe(4);
      for (const wl of walls) expect(wl.y).toBeCloseTo(buildTop(floor), 5);
      // Volver a pedir una pared en un borde ocupado no duplica (ni desde fuera, por el borde compartido).
      // (el planificador pasa a apilar encima; a la misma altura ya no hay hueco)
      const again = plan('wall', inside, 0).request;
      expect(again.y).toBeGreaterThan(walls[0]!.y + 2);
      expect(w.state.canPlace('a', { kind: 'wall', x: c.x, y: walls[0]!.y, z: c.z + 3, rotation: 2 }, { ...c, z: c.z + 4.5 })).toBe(false);
      const roof = build('roof', inside, 0);
      expect(roof).toMatchObject({ x: c.x, z: c.z });
      expect(roof.y).toBeCloseTo(walls[0]!.y + 3, 5);
      expect(w.state.pieces.size).toBe(6);
    } finally { dispose(); }
  });

  it('rampa → suelo → rampa en las cuatro orientaciones, enlazadas a la altura correcta', () => {
    for (let q = 0; q < 4; q++) {
      const { build, dispose } = world();
      try {
        const c = flatCell();
        const [dx, dz] = ([[0, 1], [1, 0], [0, -1], [-1, 0]] as const)[q]!;
        const yaw = q * Math.PI / 2;
        const r1 = build('ramp', c, yaw);
        expect(anchorOf(r1)).toEqual({ x: c.x + dx * 3, z: c.z + dz * 3 });
        const top1 = { x: c.x + dx * 3, y: r1.y + 3, z: c.z + dz * 3 };
        const f = build('floor', top1, yaw);
        expect(buildTop(f)).toBeCloseTo(r1.y + 3, 5); // a ras del extremo alto, sin escalón
        const r2 = build('ramp', { x: f.x, y: buildTop(f), z: f.z }, yaw);
        expect(r2.y).toBeCloseTo(buildTop(f), 5);
        // Pared en las cuatro orientaciones desde el suelo alto.
        for (let k = 0; k < 4; k++) if (k !== q && k !== (q + 2) % 4) build('wall', { x: f.x, y: buildTop(f), z: f.z }, k * Math.PI / 2);
      } finally { dispose(); }
    }
  });

  it('giro previo: la misma mirada con giro elige otro borde / otra orientación', () => {
    const { plan, dispose } = world();
    try {
      const c = flatCell();
      const a = plan('wall', c, 0, 0).request, b = plan('wall', c, 0, 1).request;
      expect(anchorOf(a)).not.toEqual(anchorOf(b));
      expect(plan('ramp', c, 0, 1).request.rotation).toBe((plan('ramp', c, 0, 0).request.rotation + 1) % 4);
    } finally { dispose(); }
  });

  it('dentro de una casa se puede tapar la puerta (y el boquete del edificio abandonado) con un panel a medida', () => {
    const { w, plan, layout, dispose } = world(true);
    try {
      const slots = buildSlots(layout);
      expect(slots.length).toBeGreaterThan(layout.houses.length);
      for (const v of ['cabin', 'ruin', 'garage'] as const) {
        const h = layout.houses.find((x) => variantOf(x) === v);
        if (!h) continue;
        const open = h.def.nav!.openings![0]!;
        // De pie dentro, a 1,3 m de la puerta, mirándola.
        const p = rotateXZ(open.x, open.z - 1.3, h.rotationY);
        const feet = { x: h.x + p.x, y: h.y, z: h.z + p.z };
        const yaw = h.rotationY;
        const res = plan('wall', feet, yaw);
        expect(res.request.slot, v).toBeDefined();
        expect(res.valid, v).toBe(true);
        expect(w.state.place('a', res.request, feet)).toBe(true);
        // No se duplica y no se acepta un panel manipulado (otro tamaño u otra posición).
        expect(w.state.canPlace('a', res.request, feet)).toBe(false);
        const other = { ...res.request, slot: res.request.slot! + 1 };
        expect(w.state.canPlace('a', other, feet)).toBe(false);
        expect(w.state.canPlace('a', { ...res.request, w: res.request.w! + 1 }, feet)).toBe(false);
      }
      expect(validBuildRequest({ kind: 'floor', x: 1, y: 0, z: 1, rotation: 0, slot: 0, yaw: 0, w: 1, h: 2 })).toBe(false);
      expect(validBuildRequest({ kind: 'wall', x: 0, y: 0, z: 0, rotation: 0, yaw: 1 })).toBe(false);
    } finally { dispose(); }
  });

  it('cliente y servidor coinciden: la réplica carga paneles y paredes de borde y los dibuja', () => {
    const a = world(true), b = world(true);
    try {
      const c = flatCell(true);
      a.build('floor', { ...c, z: c.z - 3 }, 0);
      a.build('wall', { x: c.x, y: c.y + 0.18, z: c.z }, 0);
      const h = a.layout.houses.find((x) => variantOf(x) === 'cabin')!;
      const open = h.def.nav!.openings![0]!, p = rotateXZ(open.x, open.z - 1.3, h.rotationY);
      const feet = { x: h.x + p.x, y: h.y, z: h.z + p.z };
      const res = a.plan('wall', feet, h.rotationY);
      expect(a.w.state.place('a', res.request, feet)).toBe(true);
      const snap = a.w.state.snapshot();
      expect(b.w.load(structuredClone(snap))).toBe(true);
      expect([...b.w.state.pieces.values()].map((x) => anchorOf(x))).toEqual([...a.w.state.pieces.values()].map((x) => anchorOf(x)));
      const view = new BuildingView(a.layout.trees, createTrees(a.layout.trees, a.layout.seed, false));
      view.update(snap, 0);
      expect(view.drawn.wall).toBe(2);
      view.dispose();
    } finally { a.dispose(); b.dispose(); }
  });
});
