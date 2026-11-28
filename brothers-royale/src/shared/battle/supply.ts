/**
 * Fase 16 — suministros aéreos. Lógica PURA (servidor y práctica offline): cada `SUPPLY.every`
 * segundos un avión de carga (distinto del de los jugadores: más alto y con id ≥ 1000) cruza la
 * isla y suelta una caja sobre un punto válido de la zona segura. La caja baja en paracaídas a
 * velocidad fija: su altura se deduce del instante de la suelta, así el cliente la anima sin
 * sincronización por tick. La primera interacción válida la abre (sin duplicados).
 */
import type { ItemStack } from '../items';
import { createRng, type Rng } from '../random';
import type { Vec3 } from '../types';
import { contains, type Circle } from './zone';
import type { PlaneRoute } from './flight';

export const SUPPLY = {
  every: 120,
  maxActive: 3,
  altitude: 72,
  planeSpeed: 16,
  /** Velocidad de bajada con paracaídas (m/s). */
  fallSpeed: 4,
  /** Distancia máxima para abrir (m). */
  reach: 2.3,
  /** Mitad del recorrido del avión: empieza y termina fuera de la isla. */
  halfRoute: 75,
  /** Primer id de avión de carga (los de jugadores usan 0..). */
  planeBase: 1000,
} as const;

export interface SupplyDrop {
  id: number;
  x: number;
  z: number;
  /** Altura del suelo donde aterriza. */
  ground: number;
  /** Segundo de ronda en que sale del avión (a `SUPPLY.altitude - 3`). */
  dropAt: number;
}

/** Altura actual de una caja y si ya aterrizó. */
export function supplyHeight(d: SupplyDrop, elapsed: number): { y: number; landed: boolean } {
  const top = SUPPLY.altitude - 3;
  const y = Math.max(d.ground, top - Math.max(0, elapsed - d.dropAt) * SUPPLY.fallSpeed);
  return { y, landed: y <= d.ground + 1e-6 };
}

export interface SupplyContents { wood: number; items: ItemStack[] }

/** Contenido determinista por (semilla de ronda, caja): madera, munición común, especial y quizá botiquín. */
export function supplyContents(seed: number, id: number): SupplyContents {
  const rng = createRng((seed ^ Math.imul(id + 7, 0x2c1b3c6d)) >>> 0);
  const wood = 30 + Math.floor(rng() * 21);
  const common = rng() < 0.5 ? 'ammo_light' : 'ammo_medium';
  const items: ItemStack[] = [{ kind: common, qty: 40 + Math.floor(rng() * 21) }];
  // Especial: cantidades pequeñas (escopeta 6-10 cartuchos o 10-15 balas medias, que usa el francotirador).
  if (rng() < 0.5) items.push({ kind: 'ammo_shells', qty: 6 + Math.floor(rng() * 5) });
  else items.push({ kind: common === 'ammo_light' ? 'ammo_medium' : 'ammo_light', qty: 10 + Math.floor(rng() * 6) });
  if (rng() < 0.5) items.push({ kind: 'medkit', qty: 1 });
  return { wood, items };
}

/** Busca un punto de aterrizaje: lo decide el mundo (terreno firme, fuera de agua, edificios y tejados). */
export type SupplySpot = (x: number, z: number) => number | null;

export class SupplyDrops {
  drops: SupplyDrop[] = [];
  planes: PlaneRoute[] = [];
  private nextAt: number = SUPPLY.every;
  private serial = 0;
  private rng: Rng;
  private pending: { plane: number; drop: SupplyDrop }[] = [];
  constructor(private seed: number, private readonly size: number) { this.rng = createRng((seed ^ 0x5a99) >>> 0); }

  reset(seed: number): void {
    this.seed = seed; this.rng = createRng((seed ^ 0x5a99) >>> 0);
    this.drops = []; this.planes = []; this.pending = []; this.nextAt = SUPPLY.every; this.serial = 0;
  }

  /** Un tick de la ronda en marcha. */
  step(elapsed: number, zone: Circle, spot: SupplySpot): void {
    // La tormenta se lleva las cajas que quedan fuera de la zona segura.
    this.drops = this.drops.filter((d) => contains(zone, d));
    // Suelta cuando el avión pasa por encima del punto (mitad de la ruta).
    for (const p of [...this.pending]) {
      const route = this.planes.find((r) => r.id === p.plane);
      if (route && elapsed >= route.start + route.duration / 2) {
        this.pending.splice(this.pending.indexOf(p), 1);
        if (contains(zone, p.drop)) this.drops.push({ ...p.drop, dropAt: elapsed });
      }
    }
    this.planes = this.planes.filter((r) => elapsed < r.start + r.duration + 1);
    if (elapsed < this.nextAt) return;
    this.nextAt += SUPPLY.every;
    if (this.drops.length + this.pending.length >= SUPPLY.maxActive) return;
    const target = this.pickSpot(zone, spot);
    if (!target) return;
    const id = ++this.serial;
    const a = this.rng() * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a), L = SUPPLY.halfRoute;
    const route: PlaneRoute = { id: SUPPLY.planeBase + id, ax: target.x - dx * L, az: target.z - dz * L, bx: target.x + dx * L, bz: target.z + dz * L,
      y: SUPPLY.altitude, start: elapsed, duration: (2 * L) / SUPPLY.planeSpeed, supply: true };
    this.planes.push(route);
    this.pending.push({ plane: route.id, drop: { id, x: target.x, z: target.z, ground: target.y, dropAt: Infinity } });
  }

  private pickSpot(zone: Circle, spot: SupplySpot): Vec3 | null {
    const half = this.size / 2 - 8, r = Math.max(0, zone.radius - 6);
    for (let k = 0; k < 24; k++) {
      const a = this.rng() * Math.PI * 2, d = Math.sqrt(this.rng()) * r;
      const x = zone.x + Math.cos(a) * d, z = zone.z + Math.sin(a) * d;
      if (Math.abs(x) > half || Math.abs(z) > half) continue;
      const y = spot(x, z);
      if (y !== null) return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, z: Math.round(z * 100) / 100 };
    }
    return null;
  }

  /** Abre la caja aterrizada más cercana a `feet` (alcance y altura). Primera petición gana. */
  open(feet: Vec3, elapsed: number): { drop: SupplyDrop; contents: SupplyContents } | null {
    let best: SupplyDrop | null = null, bestD: number = SUPPLY.reach;
    for (const d of this.drops) {
      const h = supplyHeight(d, elapsed);
      if (!h.landed || Math.abs(feet.y - d.ground) > 1.6) continue;
      const dist = Math.hypot(feet.x - d.x, feet.z - d.z);
      if (dist <= bestD) { bestD = dist; best = d; }
    }
    if (!best) return null;
    this.drops.splice(this.drops.indexOf(best), 1);
    return { drop: best, contents: supplyContents(this.seed, best.id) };
  }
}

/** Entrega una caja abierta: madera a quien la abre y el resto en abanico en el suelo (sin duplicar). */
export function grantSupply(by: string, opened: { drop: SupplyDrop; contents: SupplyContents }, giveWood: (id: string, n: number) => void, drop: (item: ItemStack, at: Vec3) => void): void {
  giveWood(by, opened.contents.wood);
  const { x, z, ground } = opened.drop;
  opened.contents.items.forEach((item, i) => {
    const a = (i / Math.max(1, opened.contents.items.length)) * Math.PI * 2;
    drop(item, { x: x + Math.cos(a) * 0.8, y: ground, z: z + Math.sin(a) * 0.8 });
  });
}

/** Punto de aterrizaje válido: terreno firme sobre el agua, fuera de edificios y árboles, y sin nada encima. */
export function supplySpotFor(terrain: (x: number, z: number) => number, clear: (x: number, z: number) => boolean, ground: (x: number, z: number) => number | null): SupplySpot {
  return (x, z) => {
    const t = terrain(x, z);
    if (t < 0.3 || !clear(x, z)) return null;
    const g = ground(x, z);
    return g === null || Math.abs(g - t) > 0.4 ? null : t;
  };
}
