/**
 * Estado de la partida que NO es física: cofres, objetos en el suelo e
 * inventarios. Puro y determinista; lo ejecuta el servidor (autoridad) y,
 * sin conexión, OfflineSession. Un único hilo procesa las interacciones en
 * orden, así que dos jugadores no pueden abrir el mismo cofre ni recoger el
 * mismo objeto: el primero gana y el segundo recibe un aviso.
 */
import { addItem, createInventory, droppableItems, selectSlot, type Inventory } from '../inventory';
import { ITEMS, type ItemStack } from '../items';
import type { Vec3 } from '../types';
import type { ChestPlacement } from '../world/layout';
import { rollChestLoot } from './loot';

export const INTERACT = {
  /** Distancia horizontal máxima a un cofre (m). */
  chestRange: 2,
  pickupRange: 1.8,
  /** Altura de los ojos para la línea de visión. */
  eye: 1.4,
} as const;

export interface Pickup {
  id: number;
  item: ItemStack;
  x: number;
  y: number;
  z: number;
}

export type InteractTarget = { type: 'chest'; id: number; distance: number } | { type: 'pickup'; id: number; distance: number };

export type NoticeCode = 'full' | 'opened' | 'gone';

export type MatchEvent =
  | { type: 'chestOpened'; chestId: number; by: string }
  | { type: 'pickupAdded'; pickup: Pickup }
  | { type: 'pickupRemoved'; id: number }
  | { type: 'pickupUpdated'; pickup: Pickup }
  | { type: 'inventory'; playerId: string; inventory: Inventory }
  | { type: 'notice'; playerId: string; code: NoticeCode };

/** ¿Hay línea de visión entre dos puntos? (el servidor usa un rayo de Rapier). */
export type LineOfSight = (from: Vec3, to: Vec3) => boolean;

/** Estado público serializable (bienvenida). */
export interface MatchSnapshot {
  opened: number[];
  pickups: Pickup[];
}

/** Objetivo de interacción más cercano (puro: lo usa también el cliente para el botón). */
export function findTarget(
  chests: readonly ChestPlacement[],
  opened: readonly boolean[],
  pickups: Iterable<Pickup>,
  feet: Vec3,
  los: LineOfSight | null = null,
): InteractTarget | null {
  let best: InteractTarget | null = null;
  const eye = { x: feet.x, y: feet.y + INTERACT.eye, z: feet.z };
  const consider = (t: InteractTarget, at: Vec3) => {
    if (best && best.distance <= t.distance) return;
    if (los && !los(eye, at)) return;
    best = t;
  };
  for (const c of chests) {
    if (opened[c.id]) continue;
    const dy = c.y - feet.y;
    if (dy < -0.7 || dy > 1.1) continue;
    const d = Math.hypot(c.x - feet.x, c.z - feet.z);
    if (d <= INTERACT.chestRange) consider({ type: 'chest', id: c.id, distance: d }, { x: c.x, y: c.y + 0.4, z: c.z });
  }
  for (const p of pickups) {
    const dy = p.y - feet.y;
    if (dy < -0.8 || dy > 1.2) continue;
    const d = Math.hypot(p.x - feet.x, p.z - feet.z);
    if (d <= INTERACT.pickupRange) consider({ type: 'pickup', id: p.id, distance: d }, { x: p.x, y: p.y + 0.3, z: p.z });
  }
  return best;
}

export class MatchState {
  readonly opened: boolean[];
  readonly pickups = new Map<number, Pickup>();
  readonly inventories = new Map<string, Inventory>();
  /** Eventos pendientes de difundir (el llamador los vacía con `drain`). */
  private events: MatchEvent[] = [];
  private nextPickupId = 1;

  constructor(
    readonly chests: readonly ChestPlacement[],
    readonly matchSeed: number,
  ) {
    this.opened = chests.map(() => false);
  }

  drain(): MatchEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  snapshot(): MatchSnapshot {
    return {
      opened: this.opened.flatMap((o, i) => (o ? [i] : [])),
      pickups: [...this.pickups.values()].map((p) => ({ ...p, item: { ...p.item } })),
    };
  }

  /** Todos empiezan con el hacha permanente en el hueco 1. */
  addPlayer(id: string): Inventory {
    const existing = this.inventories.get(id);
    if (existing) return existing;
    const inv = createInventory();
    this.inventories.set(id, inv);
    this.events.push({ type: 'inventory', playerId: id, inventory: inv });
    return inv;
  }

  /** Al salir, sus objetos (salvo el hacha) caen al suelo: ni se pierden ni se duplican. */
  removePlayer(id: string, at: Vec3): void {
    const inv = this.inventories.get(id);
    if (!inv) return;
    droppableItems(inv).forEach((item, i) => this.spawn(item, at, i));
    this.inventories.delete(id);
  }

  inventory(id: string): Inventory | undefined {
    return this.inventories.get(id);
  }

  /** Sustituye el inventario (combate: cargador, recarga, botiquín usado). Solo la autoridad. */
  setInventory(id: string, inv: Inventory): void {
    if (!this.inventories.has(id)) return;
    this.inventories.set(id, inv);
    this.events.push({ type: 'inventory', playerId: id, inventory: inv });
  }

  selectSlot(id: string, slot: unknown): boolean {
    const inv = this.inventories.get(id);
    if (!inv || typeof slot !== 'number') return false;
    const next = selectSlot(inv, slot);
    if (next === inv) return false;
    this.inventories.set(id, next);
    this.events.push({ type: 'inventory', playerId: id, inventory: next });
    return true;
  }

  target(feet: Vec3, los: LineOfSight | null = null): InteractTarget | null {
    return findTarget(this.chests, this.opened, this.pickups.values(), feet, los);
  }

  /** Interactúa con lo más cercano (abrir cofre o recoger). Devuelve lo que ocurrió. */
  interact(id: string, feet: Vec3, los: LineOfSight | null = null): InteractTarget | null {
    if (!this.inventories.has(id)) return null;
    const t = this.target(feet, los);
    if (!t) return null;
    if (t.type === 'chest') this.openChest(id, t.id);
    else this.take(id, t.id, feet);
    return t;
  }

  private openChest(by: string, chestId: number): void {
    if (this.opened[chestId]) {
      this.events.push({ type: 'notice', playerId: by, code: 'opened' });
      return;
    }
    this.opened[chestId] = true;
    this.events.push({ type: 'chestOpened', chestId, by });
    const c = this.chests[chestId]!;
    // El botín sale delante del cofre, en abanico.
    const fx = Math.sin(c.yaw);
    const fz = Math.cos(c.yaw);
    rollChestLoot(this.matchSeed, chestId).forEach((item, i, all) => {
      const lateral = (i - (all.length - 1) / 2) * 0.55;
      this.addPickup(item, { x: c.x + fx * 0.95 + fz * lateral, y: c.y, z: c.z + fz * 0.95 - fx * lateral });
    });
  }

  private take(by: string, pickupId: number, feet: Vec3): void {
    const p = this.pickups.get(pickupId);
    const inv = this.inventories.get(by);
    if (!p || !inv) {
      this.events.push({ type: 'notice', playerId: by, code: 'gone' });
      return;
    }
    const r = addItem(inv, p.item);
    if (r.taken === 0) {
      this.events.push({ type: 'notice', playerId: by, code: 'full' });
      return;
    }
    this.inventories.set(by, r.inventory);
    this.events.push({ type: 'inventory', playerId: by, inventory: r.inventory });
    if (r.leftover) {
      p.item = r.leftover;
      this.events.push({ type: 'pickupUpdated', pickup: { ...p, item: { ...p.item } } });
    } else {
      this.pickups.delete(pickupId);
      this.events.push({ type: 'pickupRemoved', id: pickupId });
    }
    if (r.dropped) this.spawn(r.dropped, feet, 0);
  }

  private spawn(item: ItemStack, at: Vec3, i: number): void {
    const a = i * 2.4;
    this.addPickup(item, { x: at.x + Math.cos(a) * 0.6, y: at.y, z: at.z + Math.sin(a) * 0.6 });
  }

  private addPickup(item: ItemStack, at: Vec3): void {
    const pickup: Pickup = { id: this.nextPickupId++, item: { ...item }, x: round(at.x), y: round(at.y), z: round(at.z) };
    this.pickups.set(pickup.id, pickup);
    this.events.push({ type: 'pickupAdded', pickup: { ...pickup, item: { ...pickup.item } } });
  }

  /** Total de unidades por tipo en el mundo (suelo + inventarios), para pruebas de no duplicación. */
  totals(): Record<string, number> {
    const t: Record<string, number> = {};
    const add = (k: string, n: number) => (t[k] = (t[k] ?? 0) + n);
    for (const p of this.pickups.values()) add(p.item.kind, p.item.qty);
    for (const inv of this.inventories.values()) {
      for (const s of inv.slots) if (s && ITEMS[s.kind].category !== 'tool') add(s.kind, s.qty);
      for (const [k, n] of Object.entries(inv.ammo)) if (n) add(k, n);
    }
    return t;
  }
}

const round = (v: number) => Math.round(v * 100) / 100;
