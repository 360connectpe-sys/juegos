import { describe, expect, it } from 'vitest';
import { WORLD } from '@shared/constants';
import { boundaryColliders, HOUSE_STYLE, houseColliders, worldColliders } from '@shared/world/colliders';
import { generateWorldLayout } from '@shared/world/layout';
import { defaultTerrainParams, sampleTerrainGrid, terrainHeight } from '@shared/world/terrain';

describe('terreno', () => {
  const p = defaultTerrainParams();
  it('es determinista y plano alrededor de la casa', () => {
    expect(terrainHeight(20, -13, p)).toBe(terrainHeight(20, -13, defaultTerrainParams()));
    for (const [x, z] of [[0, 0], [3, 2], [-4, -3], [5, -5]] as const) {
      expect(Math.abs(terrainHeight(x, z, p))).toBeLessThan(1e-6);
    }
  });
  it('baja hacia la playa en los bordes y no supera la altura máxima', () => {
    expect(terrainHeight(WORLD.size / 2, 0, p)).toBeLessThan(0);
    const grid = sampleTerrainGrid(p, 32);
    expect(grid.length).toBe(33 * 33);
    grid.forEach((h) => expect(h).toBeLessThanOrEqual(WORLD.maxHeight));
  });
  it('la rejilla usa fila = z, columna = x', () => {
    const n = 33;
    const grid = sampleTerrainGrid(p, 32);
    const step = p.size / 32;
    const row = 5;
    const col = 20;
    expect(grid[row * n + col]).toBeCloseTo(terrainHeight(-p.size / 2 + col * step, -p.size / 2 + row * step, p));
  });
});

describe('layout del mapa', () => {
  const a = generateWorldLayout({ seed: 7, treeCount: 120 });
  it('es determinista por semilla', () => {
    expect(generateWorldLayout({ seed: 7, treeCount: 120 })).toEqual(a);
    expect(generateWorldLayout({ seed: 8, treeCount: 120 }).trees[0]).not.toEqual(a.trees[0]);
  });
  it('genera árboles dentro del mapa, separados y lejos de la casa', () => {
    expect(a.trees.length).toBeGreaterThan(100);
    const half = a.terrain.size / 2;
    for (const t of a.trees) {
      expect(Math.abs(t.x)).toBeLessThan(half);
      expect(Math.abs(t.z)).toBeLessThan(half);
      expect(Math.hypot(t.x - a.house.x, t.z - a.house.z)).toBeGreaterThan(WORLD.houseClearRadius);
    }
    for (let i = 0; i < a.trees.length; i++)
      for (let j = i + 1; j < a.trees.length; j++)
        expect(Math.hypot(a.trees[i]!.x - a.trees[j]!.x, a.trees[i]!.z - a.trees[j]!.z)).toBeGreaterThan(2.5);
  });
  it('el punto de aparición queda fuera de la casa', () => {
    expect(Math.abs(a.spawn.z - a.house.z)).toBeGreaterThan(a.house.depth / 2);
  });
});

describe('colisionadores', () => {
  const layout = generateWorldLayout();
  it('la casa tiene 5 paredes y deja hueco para la puerta', () => {
    const walls = houseColliders(layout.house);
    expect(walls).toHaveLength(5);
    const front = walls.filter((w) => w.kind === 'box' && w.center.z > layout.house.z + 1);
    expect(front).toHaveLength(2);
    const [l, r] = front.map((w) => (w.kind === 'box' ? w : null)!).sort((p, q) => p.center.x - q.center.x);
    const gap = r!.center.x - r!.halfExtents.x - (l!.center.x + l!.halfExtents.x);
    expect(gap).toBeCloseTo(HOUSE_STYLE.doorWidth);
  });
  it('incluye árboles y bordes del mapa', () => {
    expect(worldColliders(layout)).toHaveLength(5 + layout.trees.length + 4);
    expect(boundaryColliders(100)).toHaveLength(4);
  });
});
