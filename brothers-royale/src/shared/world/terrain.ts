import { WORLD } from '../constants';
import { smoothstep } from '../math';
import { hash2 } from '../random';

/** Ruido de valor 2D suavizado, determinista. */
function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(x0, z0, seed);
  const b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed);
  const d = hash2(x0 + 1, z0 + 1, seed);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return top + (bottom - top) * sz;
}

export interface TerrainParams {
  seed: number;
  size: number;
  maxHeight: number;
  /** Centro de la zona aplanada (donde va la casa). */
  flatCenter: { x: number; z: number };
  flatRadius: number;
  /**
   * Zonas planas adicionales (casas pequeñas): dentro de `radius` el terreno
   * queda exactamente a `base`; hasta 1,8 × radius se funde con las colinas.
   */
  flatZones?: readonly FlatZone[];
}

export interface FlatZone {
  x: number;
  z: number;
  radius: number;
  base: number;
}

export const defaultTerrainParams = (seed: number = WORLD.seed): TerrainParams => ({
  seed,
  size: WORLD.size,
  maxHeight: WORLD.maxHeight,
  flatCenter: { x: 0, z: 0 },
  flatRadius: WORLD.flatRadius,
});

/**
 * Altura del terreno en (x, z). Función pura: la usan la malla visual,
 * el heightfield de Rapier y, más adelante, el servidor.
 */
export function terrainHeight(x: number, z: number, p: TerrainParams): number {
  let h = villageHeight(x, z, p);
  // Zonas planas de las casas pequeñas (a la altura de su colina).
  if (p.flatZones)
    for (const f of p.flatZones) {
      const d = Math.hypot(x - f.x, z - f.z);
      if (d < f.radius * 1.8) h = f.base + (h - f.base) * smoothstep(f.radius, f.radius * 1.8, d);
    }

  // Bordes del mapa: bajan suavemente hacia una "playa".
  const half = p.size / 2;
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const shore = smoothstep(half * 0.8, half, edge);
  return h * (1 - shore) - shore * 1.2;
}

/** Colinas con el pueblo ya aplanado, sin zonas de casas ni costa (base de cada zona). */
export function villageHeight(x: number, z: number, p: TerrainParams): number {
  const dFlat = Math.hypot(x - p.flatCenter.x, z - p.flatCenter.z);
  return rawHeight(x, z, p) * smoothstep(p.flatRadius, p.flatRadius * 1.8, dFlat);
}

/** Altura de las colinas sin ninguna zona plana ni costa. */
export function rawHeight(x: number, z: number, p: Pick<TerrainParams, 'seed' | 'maxHeight'>): number {
  const n = valueNoise(x * 0.03, z * 0.03, p.seed) * 0.65 + valueNoise(x * 0.08, z * 0.08, p.seed + 17) * 0.35;
  let h = (n - 0.35) * p.maxHeight;
  // Fase 15: colinas pequeñas tácticas (2-3,5 m, suaves: < 35°) en los sectores rural y abierto.
  for (const hill of hillsFor(p.seed)) {
    const d2 = (x - hill.x) ** 2 + (z - hill.z) ** 2;
    if (d2 < hill.r * hill.r * 4) h += hill.h * Math.exp(-d2 / (hill.r * hill.r * 0.5));
  }
  return h;
}

/** Sectores del mapa (fase 15): el pueblo y las casas, campo, bosque y claro abierto. */
export type Sector = 'residential' | 'rural' | 'forest' | 'open';
const sectorStart = (seed: number) => (hash2(seed, 77, 3) * Math.PI * 2);
/**
 * Sector de un punto: residencial dentro de 24 m del pueblo; fuera, tres porciones angulares
 * (bosque 150°, campo 120°, abierto 90°) giradas con la semilla. Puro y determinista.
 */
export function sectorAt(x: number, z: number, seed: number): Sector {
  if (Math.hypot(x, z) < 24) return 'residential';
  let a = Math.atan2(z, x) - sectorStart(seed);
  a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const deg = (a * 180) / Math.PI;
  return deg < 150 ? 'forest' : deg < 270 ? 'rural' : 'open';
}
interface Hill { x: number; z: number; r: number; h: number }
const hillCache = new Map<number, Hill[]>();
/** Cuatro colinas por semilla, en anillo 30-46 m (lejos del pueblo), en campo o abierto. */
export function hillsFor(seed: number): Hill[] {
  let hills = hillCache.get(seed);
  if (hills) return hills;
  hills = [];
  for (let i = 0, k = 0; hills.length < 4 && k < 40; k++) {
    const a = hash2(seed, k, 11) * Math.PI * 2, r = 30 + hash2(seed, k, 12) * 16;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const sec = sectorAt(x, z, seed);
    if (sec === 'forest' && i < 3) { i++; continue; }
    if (hills.some((o) => Math.hypot(o.x - x, o.z - z) < 20)) continue;
    hills.push({ x, z, r: 7 + hash2(seed, k, 13) * 4, h: 2 + hash2(seed, k, 14) * 1.5 });
  }
  hillCache.set(seed, hills);
  return hills;
}

/** Muestrea el terreno en una rejilla (segments+1)² con orden fila = z, columna = x. */
export function sampleTerrainGrid(p: TerrainParams, segments: number): Float32Array {
  const n = segments + 1;
  const out = new Float32Array(n * n);
  const step = p.size / segments;
  const half = p.size / 2;
  for (let row = 0; row < n; row++) {
    const z = -half + row * step;
    for (let col = 0; col < n; col++) {
      out[row * n + col] = terrainHeight(-half + col * step, z, p);
    }
  }
  return out;
}
