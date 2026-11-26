import { describe, expect, it } from 'vitest';
import { WORLD } from '@shared/constants';
import { quatFromEuler, rotateXZ } from '@shared/math';
import { boundaryColliders, prefabColliders, worldColliders } from '@shared/world/colliders';
import { generateWorldLayout } from '@shared/world/layout';
import { facesCamera, insideState, placePart, worldToLocal, type BoxPart } from '@shared/world/prefab';
import { HOUSE, createHouseDef, stairs } from '@shared/world/structures';
import { defaultTerrainParams, sampleTerrainGrid, terrainHeight } from '@shared/world/terrain';
import { visibilityTargets } from '@/game/world/PrefabView';

describe('terreno', () => {
  const p = defaultTerrainParams();
  it('es determinista y plano en el pueblo', () => {
    expect(terrainHeight(20, -13, p)).toBe(terrainHeight(20, -13, defaultTerrainParams()));
    for (const [x, z] of [[0, 0], [11, -6], [-8, 7], [7.5, 6.5]] as const) {
      expect(Math.abs(terrainHeight(x, z, p))).toBeLessThan(1e-6);
    }
  });
  it('baja hacia la playa en los bordes y no supera la altura máxima', () => {
    expect(terrainHeight(WORLD.size / 2, 0, p)).toBeLessThan(0);
    sampleTerrainGrid(p, 32).forEach((h) => expect(h).toBeLessThanOrEqual(WORLD.maxHeight));
  });
  it('la rejilla usa fila = z, columna = x', () => {
    const grid = sampleTerrainGrid(p, 32);
    const step = p.size / 32;
    expect(grid[5 * 33 + 20]).toBeCloseTo(terrainHeight(-p.size / 2 + 20 * step, -p.size / 2 + 5 * step, p));
  });
});

describe('layout del mapa', () => {
  const a = generateWorldLayout({ seed: 7, treeCount: 120 });
  it('es determinista por semilla', () => {
    expect(generateWorldLayout({ seed: 7, treeCount: 120 }).trees).toEqual(a.trees);
    expect(generateWorldLayout({ seed: 8, treeCount: 120 }).trees[0]).not.toEqual(a.trees[0]);
  });
  it('coloca casa, mirador y cajas, y ningún árbol encima', () => {
    expect(a.structures.map((s) => s.def.id)).toEqual(['house', 'tower', 'crates', 'crates']);
    expect(a.trees.length).toBeGreaterThan(100);
    for (const t of a.trees)
      for (const s of a.structures) expect(Math.hypot(t.x - s.x, t.z - s.z)).toBeGreaterThan(s.def.clearRadius);
  });
  it('el punto de aparición queda fuera de la casa', () => {
    const house = a.structures[0]!;
    expect(insideState(house, a.spawn.x, 0, a.spawn.z)).toBe('outside');
  });
});

describe('prefabs', () => {
  const layout = generateWorldLayout();
  const house = layout.structures[0]!;
  it('transforma piezas con la rotación del prefab', () => {
    const rotated = { ...house, x: 10, z: 5, rotationY: Math.PI / 2 };
    const part: BoxPart = { kind: 'box', center: { x: 1, y: 2, z: 0 }, size: { x: 1, y: 1, z: 1 }, color: '#fff', layer: 'base', collide: true, visible: true };
    const { center, rotation } = placePart(rotated, part);
    const r = rotateXZ(1, 0, Math.PI / 2);
    expect(center.x).toBeCloseTo(10 + r.x);
    expect(center.z).toBeCloseTo(5 + r.z);
    expect(center.y).toBeCloseTo(2);
    expect(rotation.y).toBeCloseTo(quatFromEuler(0, Math.PI / 2, 0).y);
    const back = worldToLocal(rotated, center.x, center.y, center.z);
    expect(back.x).toBeCloseTo(1);
    expect(back.z).toBeCloseTo(0);
  });
  it('detecta dentro/fuera y planta baja/alta', () => {
    expect(insideState(house, 0, 0, 0)).toBe('lower');
    expect(insideState(house, 0, HOUSE.groundHeight, -2)).toBe('upper');
    expect(insideState(house, 0, 0, HOUSE.depth)).toBe('outside');
  });
  it('las paredes que miran a la cámara (+X/+Z) son "cut"', () => {
    expect(facesCamera(house, { x: 0, y: 1 })).toBe(true);
    expect(facesCamera(house, { x: 1, y: 0 })).toBe(true);
    expect(facesCamera(house, { x: 0, y: -1 })).toBe(false);
    expect(facesCamera({ ...house, rotationY: Math.PI }, { x: 0, y: 1 })).toBe(false);
  });
  it('la casa tiene hueco de puerta en la fachada', () => {
    const front = prefabColliders(house).filter(
      (c) => c.kind === 'box' && Math.abs(c.center.z - (HOUSE.depth / 2 - HOUSE.wallThickness / 2)) < 0.01 && c.center.y < HOUSE.groundHeight,
    );
    const xs = front.filter((c) => c.kind === 'box' && c.halfExtents.y > 1).map((c) => (c.kind === 'box' ? [c.center.x - c.halfExtents.x, c.center.x + c.halfExtents.x] : [0, 0]));
    xs.sort((p, q) => p[0]! - q[0]!);
    expect(xs).toHaveLength(2);
    expect(xs[1]![0]! - xs[0]![1]!).toBeCloseTo(HOUSE.doorWidth);
  });
  it('escaleras: peldaños de ≤ 0,4 m (autostep) y una rampa invisible con la pendiente correcta', () => {
    const parts = stairs(0, 3, 0, 2.8, 3.7, 1.2, -1, '#000', 'base') as BoxPart[];
    const steps = parts.filter((p) => p.visible);
    const ramp = parts.find((p) => !p.visible)!;
    const heights = steps.map((s) => s.center.y + s.size.y / 2).sort((a, b) => a - b);
    for (let i = 1; i < heights.length; i++) expect(heights[i]! - heights[i - 1]!).toBeLessThanOrEqual(0.4);
    expect(heights.at(-1)).toBeCloseTo(2.8);
    expect(ramp.collide).toBe(true);
    expect(ramp.rot!.x).toBeCloseTo(Math.atan2(2.8, 3.7));
  });
  it('genera colisionadores de estructuras, árboles y bordes', () => {
    const expected = layout.structures.reduce((n, s) => n + prefabColliders(s).length, 0) + layout.trees.length + 4;
    expect(worldColliders(layout)).toHaveLength(expected);
    expect(boundaryColliders(100)).toHaveLength(4);
    expect(createHouseDef().parts.some((p) => p.kind === 'gable')).toBe(true);
  });
  it('visibilidad: fuera todo opaco; dentro sin techo; abajo sin planta alta', () => {
    expect(visibilityTargets('outside')).toEqual({ base: 1, 'base-cut': 1, upper: 1, 'upper-cut': 1, roof: 1, 'roof-cut': 1 });
    const lower = visibilityTargets('lower');
    expect(lower.roof).toBe(0);
    expect(lower.upper).toBe(0);
    expect(lower['base-cut']).toBeLessThan(0.5);
    const upper = visibilityTargets('upper');
    expect(upper.roof).toBe(0);
    expect(upper.upper).toBe(1);
    expect(upper['upper-cut']).toBeLessThan(0.5);
  });
});
