import { WORLD } from '../constants';
import { createRng, randRange } from '../random';
import type { PlacedPrefab } from './prefab';
import { createCratesDef, createHouseDef, createTowerDef } from './structures';
import { defaultTerrainParams, terrainHeight, type TerrainParams } from './terrain';

export interface TreePlacement {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
  /** 0 = pino, 1 = árbol redondo. */
  variant: 0 | 1;
}

export interface WorldLayout {
  seed: number;
  terrain: TerrainParams;
  structures: PlacedPrefab[];
  trees: TreePlacement[];
  spawn: { x: number; z: number };
}

export interface LayoutOptions {
  seed?: number;
  treeCount?: number;
}

/**
 * Genera el mapa de prueba de forma determinista. El servidor podrá llamar a
 * esta misma función con la misma semilla y obtener colisiones idénticas.
 */
export function generateWorldLayout(opts: LayoutOptions = {}): WorldLayout {
  const seed = opts.seed ?? WORLD.seed;
  const treeCount = opts.treeCount ?? 140;
  const terrain = defaultTerrainParams(seed);
  const rng = createRng(seed);

  // Pueblo de prueba dentro de la zona plana (y = 0).
  const place = (def: PlacedPrefab['def'], x: number, z: number, rotationY = 0): PlacedPrefab => ({
    def,
    x,
    y: terrainHeight(x, z, terrain),
    z,
    rotationY,
  });
  const structures: PlacedPrefab[] = [
    place(createHouseDef(), 0, 0),
    place(createTowerDef(), 11, -6),
    place(createCratesDef(), 7.5, 6.5, 0.3),
    place(createCratesDef(), -8, 7, -0.6),
  ];

  const half = terrain.size / 2;
  const margin = 6;
  const minTreeGap = 2.6;
  const trees: TreePlacement[] = [];
  let attempts = 0;
  while (trees.length < treeCount && attempts < treeCount * 30) {
    attempts++;
    const x = randRange(rng, -half + margin, half - margin);
    const z = randRange(rng, -half + margin, half - margin);
    if (structures.some((s) => Math.hypot(x - s.x, z - s.z) < s.def.clearRadius + 1.5)) continue;
    if (Math.hypot(x, z) < 6) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < minTreeGap)) continue;
    trees.push({
      x,
      y: terrainHeight(x, z, terrain),
      z,
      scale: randRange(rng, 0.8, 1.35),
      rotation: randRange(rng, 0, Math.PI * 2),
      variant: rng() < 0.55 ? 0 : 1,
    });
  }

  return { seed, terrain, structures, trees, spawn: { x: 2.5, z: 7.5 } };
}
