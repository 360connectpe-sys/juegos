/**
 * Geometría pura de disparos (sin Rapier ni Three): rayo contra la cápsula de
 * impacto de un jugador y dispersión determinista dentro de un cono.
 */
import type { Rng } from '../random';
import type { Vec3 } from '../types';
import { HITBOX } from './weapons';

/**
 * Distancia a lo largo del rayo (origen `o`, dirección unitaria `d`) hasta la
 * cápsula vertical de un jugador con los pies en `feet`, o null si no la toca.
 */
export function rayHitbox(o: Vec3, d: Vec3, feet: Vec3, maxDist: number): number | null {
  const r = HITBOX.radius;
  const ay = feet.y + HITBOX.bottom;
  const by = feet.y + HITBOX.top;
  // Cilindro infinito vertical: componentes en XZ.
  const ox = o.x - feet.x;
  const oz = o.z - feet.z;
  const a = d.x * d.x + d.z * d.z;
  let best: number | null = null;
  const consider = (t: number) => {
    if (t >= 0 && t <= maxDist && (best === null || t < best)) best = t;
  };
  if (a > 1e-12) {
    const b = ox * d.x + oz * d.z;
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      for (const t of [(-b - sq) / a, (-b + sq) / a]) {
        const y = o.y + d.y * t;
        if (y >= ay && y <= by) consider(t);
      }
    }
  }
  // Semiesferas de los extremos.
  for (const cy of [ay, by]) {
    const px = ox;
    const py = o.y - cy;
    const pz = oz;
    const b = px * d.x + py * d.y + pz * d.z;
    const c = px * px + py * py + pz * pz - r * r;
    const disc = b * b - c;
    if (disc < 0) continue;
    const sq = Math.sqrt(disc);
    for (const t of [-b - sq, -b + sq]) {
      const y = o.y + d.y * t;
      if ((cy === ay && y <= ay) || (cy === by && y >= by)) consider(t);
    }
  }
  // Origen dentro de la cápsula: impacto inmediato.
  const cy = Math.min(by, Math.max(ay, o.y));
  if (ox * ox + (o.y - cy) ** 2 + oz * oz <= r * r) consider(0);
  return best;
}

/**
 * Desvía la dirección unitaria `d` dentro de un cono de semiángulo `spread`
 * (distribución uniforme en el disco). Determinista dado el generador.
 */
export function applySpread(d: Vec3, spread: number, rng: Rng): Vec3 {
  if (spread <= 0) return { ...d };
  const angle = spread * Math.sqrt(rng());
  const theta = rng() * Math.PI * 2;
  // Base ortonormal (u, v) perpendicular a d.
  const ref = Math.abs(d.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let ux = ref.y * d.z - ref.z * d.y;
  let uy = ref.z * d.x - ref.x * d.z;
  let uz = ref.x * d.y - ref.y * d.x;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const vx = d.y * uz - d.z * uy;
  const vy = d.z * ux - d.x * uz;
  const vz = d.x * uy - d.y * ux;
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  const cs = Math.cos(theta) * s;
  const sn = Math.sin(theta) * s;
  const x = d.x * c + ux * cs + vx * sn;
  const y = d.y * c + uy * cs + vy * sn;
  const z = d.z * c + uz * cs + vz * sn;
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}

/** Punto más cercano del eje de la caja de impacto a `p` (para golpes cuerpo a cuerpo). */
export function hitboxAxisPoint(feet: Vec3, p: Vec3): Vec3 {
  const y = Math.min(feet.y + HITBOX.top, Math.max(feet.y + HITBOX.bottom, p.y));
  return { x: feet.x, y, z: feet.z };
}
