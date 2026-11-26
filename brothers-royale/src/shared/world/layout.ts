import { WORLD } from '../constants';
import { createRng, randRange } from '../random';
import { defaultTerrainParams, terrainHeight, type TerrainParams } from './terrain';

export interface HousePlacement {
  x: number;
  z: number;
  /** Rotación en Y (radianes). */
  rotation: number;
  width: number;
  depth: number;
  wallHeight: number;
}

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
  house: HousePlacement;
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

  const house: HousePlacement = {
    x: terrain.flatCenter.x,
    z: terrain.flatCenter.z,
    rotation: 0,
    width: 8,
    depth: 6,
    wallHeight: 3,
  };

  const half = terrain.size / 2;
  const margin = 6;
  const minTreeGap = 2.6;
  const trees: TreePlacement[] = [];
  let attempts = 0;
  while (trees.length < treeCount && attempts < treeCount * 30) {
    attempts++;
    const x = randRange(rng, -half + margin, half - margin);
    const z = randRange(rng, -half + margin, half - margin);
    if (Math.hypot(x - house.x, z - house.z) < WORLD.houseClearRadius + 2) continue;
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

  return { seed, terrain, house, trees, spawn: { x: house.x + 2, z: house.z + house.depth / 2 + 4 } };
}
