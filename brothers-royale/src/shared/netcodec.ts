import type { Locomotion, PlayerState } from './types';

/**
 * Codificación compacta del estado público para la red (prioridad móvil):
 * enteros pequeños en lugar de objetos con floats de 64 bits. MessagePack
 * guarda cada entero en 1-3 bytes → ~25 bytes por jugador y snapshot.
 *
 * Por jugador, 10 enteros:
 *   [netId, x, y, z (cm), yaw (mrad), vx, vy, vz (cm/s), flags, lastSeq]
 * flags: bit 0 = grounded; bits 1-3 = índice de locomoción.
 */
export const PACKED_STRIDE = 10;

const LOCOMOTIONS: readonly Locomotion[] = ['idle', 'walk', 'run', 'jump', 'fall'];

const POS = 100; // cm
const ANG = 1000; // mrad
const VEL = 100; // cm/s

export interface PublicPlayer {
  netId: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  locomotion: Locomotion;
  lastSeq: number;
}

/** Añade un jugador al array aplanado `out`. */
export function packPlayer(out: number[], netId: number, s: PlayerState): void {
  const loco = Math.max(0, LOCOMOTIONS.indexOf(s.locomotion));
  out.push(
    netId,
    Math.round(s.position.x * POS),
    Math.round(s.position.y * POS),
    Math.round(s.position.z * POS),
    Math.round(s.yaw * ANG),
    Math.round(s.velocity.x * VEL),
    Math.round(s.velocity.y * VEL),
    Math.round(s.velocity.z * VEL),
    (s.grounded ? 1 : 0) | (loco << 1),
    s.lastProcessedSeq,
  );
}

/** Decodifica un snapshot aplanado. Ignora datos truncados o no numéricos. */
export function unpackPlayers(p: unknown): PublicPlayer[] {
  if (!Array.isArray(p)) return [];
  const out: PublicPlayer[] = [];
  for (let i = 0; i + PACKED_STRIDE <= p.length; i += PACKED_STRIDE) {
    const v = p.slice(i, i + PACKED_STRIDE) as unknown[];
    if (!v.every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
    const n = v as number[];
    const flags = n[8]!;
    out.push({
      netId: n[0]!,
      x: n[1]! / POS,
      y: n[2]! / POS,
      z: n[3]! / POS,
      yaw: n[4]! / ANG,
      vx: n[5]! / VEL,
      vy: n[6]! / VEL,
      vz: n[7]! / VEL,
      grounded: (flags & 1) === 1,
      locomotion: LOCOMOTIONS[(flags >> 1) & 7] ?? 'idle',
      lastSeq: n[9]!,
    });
  }
  return out;
}

/** Convierte un jugador público en PlayerState (para vistas e interpolación). */
export function toPlayerState(p: PublicPlayer, id: string, name: string): PlayerState {
  return {
    id,
    name,
    position: { x: p.x, y: p.y, z: p.z },
    velocity: { x: p.vx, y: p.vy, z: p.vz },
    yaw: p.yaw,
    grounded: p.grounded,
    locomotion: p.locomotion,
    lastProcessedSeq: p.lastSeq,
  };
}
