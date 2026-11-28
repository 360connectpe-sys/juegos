/**
 * Fase 12 — transporte aéreo. Datos y matemática pura (servidor y offline):
 * rutas del avión, posición en el tiempo y constantes de caída libre/paracaídas.
 * El servidor decide TODO (embarque, salto, apertura y aterrizaje); el cliente solo dibuja.
 */
import { createRng } from '../random';
import type { Circle } from './zone';

export const FLIGHT = {
  /** Altura de vuelo sobre el nivel del mar (m). */
  altitude: 62,
  /** Velocidad del avión inicial y de los de reaparición (m/s). */
  speed: 10.5,
  respawnSpeed: 14,
  /** Caída libre: velocidad vertical normal / en picado (botón correr) y control horizontal. */
  fallSpeed: 16,
  diveSpeed: 26,
  fallControl: 10,
  /** Paracaídas: descenso normal / rápido y control horizontal. */
  chuteSpeed: 3.6,
  chuteFastSpeed: 6.4,
  chuteControl: 6.5,
  /** Se abre solo por debajo de esta altura sobre el suelo (o antes, con saltar). */
  chuteHeight: 24,
  /** No se puede abrir antes de caer al menos esto desde el avión (evita flotar sobre el mapa). */
  minFallBeforeChute: 6,
  /** Aceleración horizontal en el aire (m/s²). */
  airAccel: 24,
  /** Margen dentro del mapa para el salto automático y el límite de la caída. */
  edgeInset: 6,
  /** Tope de duración de una ruta (s): las reapariciones no alargan la partida. */
  maxRouteSeconds: 12,
} as const;

/** Modo aéreo de un jugador: 0 en tierra, 1 en el avión, 2 caída libre, 3 paracaídas. */
export type AirMode = 0 | 1 | 2 | 3;

export interface PlaneRoute {
  /** Identificador estable en la ronda (0 = avión inicial). */
  id: number;
  ax: number; az: number; bx: number; bz: number;
  y: number;
  /** Segundo de ronda en que despega y duración hasta el salto automático. */
  start: number;
  duration: number;
}

export interface PlanePose { x: number; y: number; z: number; yaw: number; progress: number }

export function planeAt(r: PlaneRoute, elapsed: number, out: PlanePose = { x: 0, y: 0, z: 0, yaw: 0, progress: 0 }): PlanePose {
  const t = r.duration > 0 ? Math.max(0, Math.min(1, (elapsed - r.start) / r.duration)) : 1;
  out.x = r.ax + (r.bx - r.ax) * t;
  out.z = r.az + (r.bz - r.az) * t;
  out.y = r.y;
  out.yaw = Math.atan2(r.bx - r.ax, r.bz - r.az);
  out.progress = t;
  return out;
}

/** Círculo en el que se puede caer en la ruta inicial: todo el mapa jugable. */
export const mapCircle = (size: number): Circle => ({ x: 0, z: 0, radius: size / 2 - FLIGHT.edgeInset });

/**
 * Ruta inicial: cruza el mapa en una dirección aleatoria (semilla de la ronda) pasando cerca
 * del centro. Empieza fuera del mapa y termina dentro (el salto automático cae en tierra).
 */
export function startRoute(size: number, seed: number, start = 0): PlaneRoute {
  const rng = createRng((seed ^ 0xa1e7) >>> 0);
  const half = size / 2, angle = rng() * Math.PI * 2, offset = (rng() * 2 - 1) * half * 0.3;
  const dx = Math.cos(angle), dz = Math.sin(angle), nx = -dz, nz = dx;
  const cx = nx * offset, cz = nz * offset;
  const back = half + 12, ahead = half - FLIGHT.edgeInset - 4;
  const route = { id: 0, ax: cx - dx * back, az: cz - dz * back, bx: cx + dx * ahead, bz: cz + dz * ahead, y: FLIGHT.altitude, start, duration: 0 };
  route.duration = Math.min(FLIGHT.maxRouteSeconds * 1.5, Math.hypot(route.bx - route.ax, route.bz - route.az) / FLIGHT.speed);
  return route;
}

/**
 * Ruta de reaparición: entra desde fuera de la zona segura y termina DENTRO de ella, así
 * el salto (también el automático) aterriza en la zona. Se adapta a zonas pequeñas:
 * cuanto menor el círculo, más corta la ruta.
 */
export function respawnRoute(zone: Circle, size: number, seed: number, id: number, start: number): PlaneRoute {
  const rng = createRng((seed ^ Math.imul(id + 1, 0x9e3779b1)) >>> 0);
  const angle = rng() * Math.PI * 2, dx = Math.cos(angle), dz = Math.sin(angle);
  const r = Math.max(0, zone.radius);
  const inner = Math.min(r * 0.5, size / 2 - FLIGHT.edgeInset);
  const lead = Math.min(r + 14, FLIGHT.respawnSpeed * FLIGHT.maxRouteSeconds - inner);
  const route = { id, ax: zone.x - dx * lead, az: zone.z - dz * lead, bx: zone.x + dx * inner, bz: zone.z + dz * inner, y: FLIGHT.altitude, start, duration: 0 };
  route.duration = Math.max(1.5, Math.hypot(route.bx - route.ax, route.bz - route.az) / FLIGHT.respawnSpeed);
  return route;
}
