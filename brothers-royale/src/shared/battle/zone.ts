import { createRng } from '../random';
import type { Vec3 } from '../types';

export interface Circle { x: number; z: number; radius: number }
export const ROUND_SECONDS = 1800;
/** Inicio en segundos, radio objetivo y daño por segundo. */
export const ZONE_PHASES = [
  [0, 1, 0], [180, .8, 1], [420, .6, 2], [720, .4, 4],
  [1020, .25, 6], [1320, .1, 10], [1560, .03, 20], [1740, 0, 50],
] as const;
export interface ZoneState {
  current: Circle; next: Circle; phase: number; damage: number;
  closing: boolean; warning: boolean; changesIn: number;
}
export function contains(c: Circle, p: Pick<Vec3, 'x' | 'z'>, inset = 0): boolean {
  return c.radius > inset && Math.hypot(p.x - c.x, p.z - c.z) <= c.radius - inset;
}
export function constrain(c: Circle, p: Pick<Vec3, 'x' | 'z'>, inset = 0): { x: number; z: number } {
  const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz);
  const r = Math.max(0, c.radius - inset);
  return d > r && d > 0 ? { x: c.x + dx / d * r, z: c.z + dz / d * r } : { x: p.x, z: p.z };
}
/** RNG independiente del botín/mapa. Cada círculo queda contenido en el anterior. */
export function zonePlan(size: number, seed: number): Circle[] {
  const rng = createRng((seed ^ 0x870a) >>> 0), half = size / 2 - 2;
  const initial = half * Math.SQRT2;
  const circles: Circle[] = [{ x: 0, z: 0, radius: initial }];
  for (let i = 1; i < ZONE_PHASES.length; i++) {
    const before = circles[i - 1]!, radius = initial * ZONE_PHASES[i]![1];
    const angle = rng() * Math.PI * 2, distance = (before.radius - radius) * .6 * rng();
    const bound = Math.max(0, half - radius);
    circles.push({ x: Math.max(-bound, Math.min(bound, before.x + Math.cos(angle) * distance)), z: Math.max(-bound, Math.min(bound, before.z + Math.sin(angle) * distance)), radius });
  }
  return circles;
}
export function zoneAt(plan: readonly Circle[], elapsed: number): ZoneState {
  const t = Math.max(0, Math.min(ROUND_SECONDS, elapsed));
  let phase = 0;
  for (let i = 1; i < ZONE_PHASES.length; i++) if (t >= ZONE_PHASES[i]![0]) phase = i;
  const target = plan[phase]!, from = plan[Math.max(0, phase - 1)]!;
  const fraction = phase === 0 ? 1 : Math.min(1, (t - ZONE_PHASES[phase]![0]) / 60);
  const deadline = ZONE_PHASES[phase + 1]?.[0] ?? ROUND_SECONDS;
  return { phase, damage: ZONE_PHASES[phase]![2], closing: phase > 0 && fraction < 1,
    current: { x: from.x + (target.x - from.x) * fraction, z: from.z + (target.z - from.z) * fraction, radius: from.radius + (target.radius - from.radius) * fraction },
    next: fraction < 1 ? { ...target } : { ...(plan[phase + 1] ?? target) },
    warning: phase < 7 && deadline - t <= 30, changesIn: Math.max(0, deadline - t),
  };
}
