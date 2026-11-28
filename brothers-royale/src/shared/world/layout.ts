import { WORLD } from '../constants';
import { createRng, randRange } from '../random';
import { rotateXZ } from '../math';
import type { PlacedPrefab } from './prefab';
import {
  createChestDef,
  createCratesDef,
  createHouseDef,
  createSmallHouseDef,
  createTowerDef,
  HOUSE,
  SMALL_HOUSE_PALETTES,
  SMALL_HOUSE_SIZE,
  SMALL_HOUSE_VARIANTS,
  smallHouseChestSpot,
  TOWER,
  type SmallHouseVariant,
} from './structures';
import { createExtraDef, EXTRA_SIZE, EXTRA_VARIANTS, extraChestSpots, type ExtraVariant } from './buildings';
import { defaultTerrainParams, sectorAt, terrainHeight, villageHeight, type FlatZone, type TerrainParams } from './terrain';

export interface TreePlacement {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
  /** 0 = pino, 1 = árbol redondo. */
  variant: 0 | 1;
}

/** Cofre del mapa (también es un prefab con colisionador en `structures`). */
export interface ChestPlacement {
  /** Índice estable: lo comparten servidor y clientes. */
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Dónde está: dentro de una casa (id del prefab) o fuera. */
  where: 'outside' | 'house' | 'loft' | 'tower' | 'small-house' | 'upper';
}

export interface WorldLayout {
  seed: number;
  terrain: TerrainParams;
  /** Todo lo que se dibuja y colisiona: pueblo, casas pequeñas y cofres. */
  structures: PlacedPrefab[];
  /** Casas pequeñas repartidas por el mapa (también están en `structures`). */
  houses: PlacedPrefab[];
  chests: ChestPlacement[];
  trees: TreePlacement[];
  /** Fase 15: rocas (colisionan: cobertura) y arbustos (solo visuales). */
  rocks: RockPlacement[];
  bushes: RockPlacement[];
  spawn: { x: number; z: number };
}

/** Roca o arbusto: posición en el suelo, escala y giro. */
export interface RockPlacement { x: number; y: number; z: number; scale: number; rotation: number }
const SPAWN = { x: 2.5, z: 7.5 } as const;
/** Probabilidad de aceptar un árbol según el sector (fase 15). */
const TREE_DENSITY = { forest: 1, rural: 0.45, residential: 0.35, open: 0.12 } as const;
const ROCK_DENSITY = { open: 1, rural: 0.8, forest: 0.45, residential: 0.2 } as const;

/** Rocas de cobertura (su propio RNG): en terreno firme, lejos de edificios, cofres y árboles. */
function placeRocks(seed: number, terrain: TerrainParams, structures: PlacedPrefab[], chests: ChestPlacement[], trees: TreePlacement[]): RockPlacement[] {
  const rng = createRng(seed ^ 0x70c55);
  const out: RockPlacement[] = [];
  const half = terrain.size / 2 - 7;
  for (let k = 0; out.length < 24 && k < 1500; k++) {
    const x = randRange(rng, -half, half), z = randRange(rng, -half, half);
    if (rng() > ROCK_DENSITY[sectorAt(x, z, seed)]) continue;
    const y = terrainHeight(x, z, terrain);
    if (y < 0.3 || Math.abs(terrainHeight(x + 1.2, z, terrain) - terrainHeight(x - 1.2, z, terrain)) > 0.8) continue;
    if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 6 || Math.hypot(x, z) < 8) continue;
    if (structures.some((s) => Math.hypot(x - s.x, z - s.z) < s.def.clearRadius + 2)) continue;
    if (chests.some((c) => Math.hypot(x - c.x, z - c.z) < 2.5) || trees.some((t) => Math.hypot(x - t.x, z - t.z) < 2.6)) continue;
    if (out.some((r) => Math.hypot(x - r.x, z - r.z) < 5)) continue;
    out.push({ x, y, z, scale: randRange(rng, 0.8, 1.5), rotation: randRange(rng, 0, Math.PI * 2) });
  }
  return out;
}

/** Arbustos (solo visuales, no colisionan): bordes de bosque, campo y jardines. */
function placeBushes(seed: number, terrain: TerrainParams, structures: PlacedPrefab[], chests: ChestPlacement[], rocks: RockPlacement[]): RockPlacement[] {
  const rng = createRng(seed ^ 0xb05e5);
  const out: RockPlacement[] = [];
  const half = terrain.size / 2 - 6;
  for (let k = 0; out.length < 48 && k < 1500; k++) {
    const x = randRange(rng, -half, half), z = randRange(rng, -half, half);
    if (sectorAt(x, z, seed) === 'open' && rng() < 0.7) continue;
    const y = terrainHeight(x, z, terrain);
    if (y < 0.2) continue;
    if (structures.some((s) => Math.hypot(x - s.x, z - s.z) < s.def.clearRadius)) continue;
    if (chests.some((c) => Math.hypot(x - c.x, z - c.z) < 1.8) || rocks.some((r) => Math.hypot(x - r.x, z - r.z) < 2)) continue;
    out.push({ x, y, z, scale: randRange(rng, 0.7, 1.3), rotation: randRange(rng, 0, Math.PI * 2) });
  }
  return out;
}

export const MAP = {
  minHouses: 8,
  maxHouses: 12,
  /** Distancia al centro entre la que se reparten las casas pequeñas. */
  houseRing: { min: 24, max: 44 },
  /** Límite |x|,|z| para que la zona plana no toque la costa. */
  houseEdge: 44,
  /** Fase 15: más cofres en campo abierto, colinas y bosque (antes 6). */
  outsideChests: 9,
} as const;

/** Todos los diseños repartidos por el mapa (fase 12: + moderna, balcón, garaje y abandonado). */
export type BuildingVariant = SmallHouseVariant | ExtraVariant;
export const BUILDING_VARIANTS: readonly BuildingVariant[] = [...SMALL_HOUSE_VARIANTS, ...EXTRA_VARIANTS];
/** Diseños que aparecen en TODAS las partidas (junto con la casa familiar de dos plantas del pueblo). */
export const REQUIRED_VARIANTS: readonly BuildingVariant[] = ['cabin', 'modern', 'balcony', 'garage', 'ruin'];
const isExtra = (v: BuildingVariant): v is ExtraVariant => (EXTRA_VARIANTS as readonly string[]).includes(v);
/** Radio de la zona plana que necesita cada diseño (incluye porche, escalera exterior o balcón). */
function footprint(v: BuildingVariant): number {
  if (isExtra(v)) { const s = EXTRA_SIZE[v]; return Math.hypot(s.w + s.extra, s.d + s.extra) / 2 + 0.8; }
  const size = SMALL_HOUSE_SIZE[v];
  return Math.hypot(size.w, size.d + (v === 'porch' ? 3 : 0)) / 2 + 1.5;
}
export const variantOf = (p: PlacedPrefab): BuildingVariant => p.def.id.replace('small-', '') as BuildingVariant;

/**
 * Casas por sectores alrededor del pueblo (así quedan en distintas zonas del mapa), a la
 * altura de su colina y con la puerta hacia el centro. Los primeros sectores llevan los
 * diseños obligatorios (orden barajado con la semilla) y el resto, uno al azar.
 */
function placeSmallHouses(seed: number, terrain: TerrainParams): { houses: PlacedPrefab[]; zones: FlatZone[] } {
  const rng = createRng(seed ^ 0x51ed27);
  const count = MAP.minHouses + Math.floor(rng() * (MAP.maxHouses - MAP.minHouses + 1));
  const houses: PlacedPrefab[] = [];
  const zones: FlatZone[] = [];
  const required = [...REQUIRED_VARIANTS];
  for (let i = required.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [required[i], required[j]] = [required[j]!, required[i]!]; }
  const tryPlace = (k: number, sectors: number, relaxed: boolean, fixed?: BuildingVariant): boolean => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const angle = ((k + 0.1 + rng() * 0.8) / sectors) * Math.PI * 2;
      const r = randRange(rng, MAP.houseRing.min, MAP.houseRing.max);
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const variant: BuildingVariant = fixed ?? BUILDING_VARIANTS[Math.floor(rng() * BUILDING_VARIANTS.length)]!;
      const radius = footprint(variant);
      if (Math.max(Math.abs(x), Math.abs(z)) + radius * (isExtra(variant) ? 1.4 : 1.8) > MAP.houseEdge) continue;
      const base = villageHeight(x, z, terrain);
      // Ni en la arena ni en el agua (relajado: se admite subir un poco el terreno junto a la playa).
      if (base < (relaxed ? -0.3 : 0.25)) continue;
      if (zones.some((o) => Math.hypot(o.x - x, o.z - z) < (o.radius + radius) * 1.3 + 2)) continue;
      const palette = Math.floor(rng() * 4);
      const def = isExtra(variant) ? createExtraDef(variant, SMALL_HOUSE_PALETTES[palette]!) : createSmallHouseDef(variant, palette);
      zones.push({ x, z, radius, base: Math.max(base, 0.25) });
      houses.push({ def, x, y: Math.max(base, 0.25), z, rotationY: Math.atan2(-x, -z) });
      return true;
    }
    return false;
  };
  // Cada sector intenta primero un sitio ideal y, si no lo hay, uno aceptable: así
  // ninguna zona del mapa se queda sin casas.
  for (let k = 0; k < count; k++) {
    const fixed = required[k];
    if (!tryPlace(k, count, false, fixed)) tryPlace(k, count, true, fixed);
  }
  // Un diseño obligatorio que no cupo en su sector se intenta en cualquier otro.
  for (const v of required) for (let k = 0; !houses.some((h) => variantOf(h) === v) && k < 64; k++) tryPlace(k, 16, true, v);
  // Si algún sector no tenía sitio, se completa el mínimo relajando condiciones.
  for (let k = 0; houses.length < MAP.minHouses && k < 64; k++) tryPlace(k, 16, true);
  return { houses, zones };
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
  const { houses, zones } = placeSmallHouses(seed, terrain);
  terrain.flatZones = zones;
  const structures: PlacedPrefab[] = [
    place(createHouseDef(), 0, 0),
    place(createTowerDef(), 11, -6),
    place(createCratesDef(), 7.5, 6.5, 0.3),
    place(createCratesDef(), -8, 7, -0.6),
    ...houses,
  ];

  // Cofres (deterministas): dentro de cada casa pequeña, en la casa grande
  // (planta baja y entreplanta), en el mirador y repartidos por el exterior.
  const chestDef = createChestDef();
  const chests: ChestPlacement[] = [];
  const addChest = (x: number, y: number, z: number, yaw: number, where: ChestPlacement['where']) => {
    chests.push({ id: chests.length, x, y, z, yaw, where });
    structures.push({ def: chestDef, x, y, z, rotationY: yaw });
  };
  const local = (p: PlacedPrefab, lx: number, lz: number) => {
    const r = rotateXZ(lx, lz, p.rotationY);
    return { x: p.x + r.x, z: p.z + r.z };
  };
  for (const h of houses) {
    const variant = variantOf(h);
    const spots = isExtra(variant) ? extraChestSpots(variant) : [{ ...smallHouseChestSpot(variant), y: 0 }];
    spots.forEach((spot, i) => {
      const w = local(h, spot.x, spot.z);
      addChest(w.x, h.y + spot.y, w.z, h.rotationY + spot.yaw, i === 0 ? 'small-house' : 'upper');
    });
  }
  const big = structures[0]!;
  const g = local(big, HOUSE.width / 2 - 1.1, HOUSE.depth / 2 - 1.3);
  addChest(g.x, big.y, g.z, big.rotationY + Math.PI, 'house');
  const loft = local(big, HOUSE.width / 2 - 1.4, -HOUSE.depth / 2 + 1.1);
  addChest(loft.x, big.y + HOUSE.groundHeight, loft.z, big.rotationY, 'loft');
  const tower = structures[1]!;
  addChest(tower.x, tower.y + TOWER.height, tower.z - 0.4, tower.rotationY, 'tower');
  const rngC = createRng(seed ^ 0xc4e57);
  for (let i = 0, tries = 0; i < MAP.outsideChests && tries < 2000; tries++) {
    const a = rngC() * Math.PI * 2;
    const r = randRange(rngC, 14, 48);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const y = terrainHeight(x, z, terrain);
    if (y < 0.3 || Math.abs(terrainHeight(x + 1, z, terrain) - terrainHeight(x - 1, z, terrain)) > 0.6) continue;
    if (structures.some((st) => Math.hypot(x - st.x, z - st.z) < st.def.clearRadius + 1.5)) continue;
    if (chests.some((c) => c.where === 'outside' && Math.hypot(c.x - x, c.z - z) < 12)) continue;
    addChest(x, y, z, rngC() * Math.PI * 2, 'outside');
    i++;
  }

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
    // Fase 15: la zona de aparición queda despejada y la densidad depende del sector
    // (bosque denso, campo y pueblo intermedios, claro abierto casi sin árboles).
    if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 4.5) continue;
    const sector = sectorAt(x, z, seed);
    if (rng() > TREE_DENSITY[sector]) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < minTreeGap)) continue;
    trees.push({
      x,
      y: terrainHeight(x, z, terrain),
      z,
      // Más grandes y variados (antes 0,8-1,35).
      scale: randRange(rng, 1.0, 1.6),
      rotation: randRange(rng, 0, Math.PI * 2),
      variant: rng() < (sector === 'forest' ? 0.7 : 0.45) ? 0 : 1,
    });
  }
  const rocks = placeRocks(seed, terrain, structures, chests, trees);
  const bushes = placeBushes(seed, terrain, structures, chests, rocks);

  return { seed, terrain, structures, houses, chests, trees, rocks, bushes, spawn: { ...SPAWN } };
}

/** ¿Se puede aparecer en (x, z)? Fuera de estructuras y lejos de troncos. */
export function isClearSpawn(layout: WorldLayout, x: number, z: number): boolean {
  if (layout.structures.some((s) => Math.hypot(x - s.x, z - s.z) < s.def.clearRadius)) return false;
  if (layout.rocks?.some((r) => Math.hypot(x - r.x, z - r.z) < 1.4 * r.scale + 0.5)) return false;
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

/**
 * Fase 15: huecos tapables del mapa (puertas y boquetes), en coordenadas de mundo. Orden
 * estable (estructuras en orden del mapa, huecos en orden del prefab): el índice viaja en
 * `BuildRequest.slot` y la autoridad lo compara. Panel 4 cm más pequeño que el hueco.
 */
export function buildSlots(layout: WorldLayout): { x: number; y: number; z: number; yaw: number; w: number; h: number }[] {
  const out: { x: number; y: number; z: number; yaw: number; w: number; h: number }[] = [];
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  for (const s of layout.structures) for (const o of s.def.nav?.openings ?? []) {
    const p = rotateXZ(o.x, o.z, s.rotationY);
    out.push({ x: r4(s.x + p.x), y: r4(s.y + o.y + 0.02), z: r4(s.z + p.z), yaw: r4(s.rotationY + o.yaw), w: r4(o.w - 0.04), h: r4(o.h - 0.04) });
  }
  return out;
}
