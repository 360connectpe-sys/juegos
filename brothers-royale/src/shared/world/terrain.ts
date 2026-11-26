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
  const n =
    valueNoise(x * 0.03, z * 0.03, p.seed) * 0.65 +
    valueNoise(x * 0.08, z * 0.08, p.seed + 17) * 0.35;
  let h = (n - 0.35) * p.maxHeight;

  // Zona plana alrededor de la casa.
  const dFlat = Math.hypot(x - p.flatCenter.x, z - p.flatCenter.z);
  const flatBlend = smoothstep(p.flatRadius, p.flatRadius * 1.8, dFlat);
  h *= flatBlend;

  // Bordes del mapa: bajan suavemente hacia una "playa".
  const half = p.size / 2;
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const shore = smoothstep(half * 0.8, half, edge);
  return h * (1 - shore) - shore * 1.2;
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
