import { createRng } from '../random';
import type { Vec3 } from '../types';

export interface Circle { x: number; z: number; radius: number }
/** Fase 12: la partida dura como máximo 15 minutos (sin contar el lobby). */
export const ROUND_SECONDS = 900;
/** Mapa para el que están escritos los radios (WORLD.size); otros tamaños escalan proporcionalmente. */
export const ZONE_REFERENCE_SIZE = 120;
export interface ZonePhaseDef {
  /** Inicio de la fase (s). */
  readonly start: number;
  /** Radio objetivo (m, mapa de referencia). */
  readonly radius: number;
  /** Daño por segundo fuera de la zona durante la fase. */
  readonly damage: number;
  /** Segundos que tarda en cerrarse desde el radio anterior (0 = ya está). */
  readonly close: number;
}
/** Las 5 fases (1-5 en el HUD = índices 0-4). La última se cierra después de 5 m a 0 m. */
export const ZONE_PHASES: readonly ZonePhaseDef[] = [
  { start: 0, radius: 85, damage: 1, close: 0 },
  { start: 240, radius: 60, damage: 2, close: 60 },
  { start: 420, radius: 40, damage: 4, close: 60 },
  { start: 600, radius: 20, damage: 7, close: 60 },
  { start: 780, radius: 5, damage: 12, close: 45 },
];
/** Cierre final de la fase 5: de 5 m a 0 m en el último minuto. */
export const FINAL_COLLAPSE_START = 840;
/** Aviso previo antes de cada cierre (s). */
export const ZONE_WARNING_SECONDS = 30;
export const LAST_ZONE_PHASE = ZONE_PHASES.length - 1;
export const MAX_ZONE_DAMAGE = Math.max(...ZONE_PHASES.map(p => p.damage));
export interface ZoneState {
  current: Circle; next: Circle; phase: number; damage: number;
  closing: boolean; warning: boolean;
  /** Segundos hasta el próximo cierre (o hasta el final, si ya no hay más). */
  changesIn: number;
}
export function contains(c: Circle, p: Pick<Vec3, 'x' | 'z'>, inset = 0): boolean {
  return c.radius > inset && Math.hypot(p.x - c.x, p.z - c.z) <= c.radius - inset;
}
export function constrain(c: Circle, p: Pick<Vec3, 'x' | 'z'>, inset = 0): { x: number; z: number } {
  const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz);
  const r = Math.max(0, c.radius - inset);
  return d > r && d > 0 ? { x: c.x + dx / d * r, z: c.z + dz / d * r } : { x: p.x, z: p.z };
}
/**
 * RNG independiente del botín/mapa. Cada círculo queda contenido en el anterior
 * (el centro siguiente siempre cae dentro de la zona previa). El último elemento es
 * el colapso final (radio 0, mismo centro que la fase 5).
 */
export function zonePlan(size: number, seed: number): Circle[] {
  const rng = createRng((seed ^ 0x870a) >>> 0), half = size / 2 - 2;
  const scale = size / ZONE_REFERENCE_SIZE;
  const circles: Circle[] = [{ x: 0, z: 0, radius: ZONE_PHASES[0]!.radius * scale }];
  for (let i = 1; i < ZONE_PHASES.length; i++) {
    const before = circles[i - 1]!, radius = ZONE_PHASES[i]!.radius * scale;
    const angle = rng() * Math.PI * 2, distance = (before.radius - radius) * .6 * rng();
    const bound = Math.max(0, half - radius);
    // Proyectar sobre el cuadrado no aleja del centro anterior (que ya está dentro): sigue anidado.
    circles.push({ x: Math.max(-bound, Math.min(bound, before.x + Math.cos(angle) * distance)), z: Math.max(-bound, Math.min(bound, before.z + Math.sin(angle) * distance)), radius });
  }
  const last = circles[circles.length - 1]!;
  circles.push({ x: last.x, z: last.z, radius: 0 });
  return circles;
}
const lerpCircle = (a: Circle, b: Circle, f: number): Circle => ({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, radius: a.radius + (b.radius - a.radius) * f });
/** Índice de fase (0-4) en el instante t. */
export function zonePhaseAt(elapsed: number): number {
  let phase = 0;
  for (let i = 1; i < ZONE_PHASES.length; i++) if (elapsed >= ZONE_PHASES[i]!.start) phase = i;
  return phase;
}
export function zoneAt(plan: readonly Circle[], elapsed: number): ZoneState {
  const t = Math.max(0, Math.min(ROUND_SECONDS, elapsed));
  const phase = zonePhaseAt(t);
  const def = ZONE_PHASES[phase]!;
  const target = plan[phase]!, from = plan[Math.max(0, phase - 1)]!, collapse = plan[ZONE_PHASES.length]!;
  const fraction = def.close > 0 ? Math.min(1, (t - def.start) / def.close) : 1;
  let current = lerpCircle(from, target, fraction);
  let closing = fraction < 1;
  let next: Circle = closing ? { ...target } : { ...(plan[phase + 1] ?? target) };
  let deadline = ZONE_PHASES[phase + 1]?.start ?? FINAL_COLLAPSE_START;
  if (phase === LAST_ZONE_PHASE && t >= FINAL_COLLAPSE_START) {
    // Último minuto: de 5 m a 0 m; al terminar se decide por desempate.
    const f = Math.min(1, (t - FINAL_COLLAPSE_START) / (ROUND_SECONDS - FINAL_COLLAPSE_START));
    current = lerpCircle(target, collapse, f);
    closing = f < 1; next = { ...collapse }; deadline = ROUND_SECONDS;
  }
  const changesIn = Math.max(0, deadline - t);
  return { phase, damage: def.damage, closing, current, next,
    warning: !closing && deadline < ROUND_SECONDS && changesIn <= ZONE_WARNING_SECONDS, changesIn };
}
