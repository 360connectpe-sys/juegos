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

/** ¿Se puede aparecer en (x, z)? Fuera de estructuras y lejos de troncos. */
export function isClearSpawn(layout: WorldLayout, x: number, z: number): boolean {
  if (layout.structures.some((s) => Math.hypot(x - s.x, z - s.z) < s.def.clearRadius)) return false;
  return !layout.trees.some((t) => Math.hypot(x - t.x, z - t.z) < 1.5);
}

/**
 * Punto de aparición del jugador `index` (determinista): el 0 es el de
 * siempre; el resto recorre anillos alrededor del pueblo saltando posiciones
 * ocupadas por estructuras o árboles, para no aparecer uno encima de otro.
 */
export function spawnPoint(layout: WorldLayout, index: number): { x: number; z: number } {
  if (index <= 0) return { ...layout.spawn };
  let found = 0;
  for (let k = 0; k < 400; k++) {
    const ring = Math.floor(k / 12);
    const angle = ((k % 12) / 12) * Math.PI * 2 + ring * 0.26;
    const r = 13 + ring * 2.5;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (!isClearSpawn(layout, x, z)) continue;
    if (++found === index) return { x, z };
  }
  return { ...layout.spawn };
}
