import { isValidInventory, type Inventory } from '@shared/inventory';
import { isItemKind } from '@shared/items';
import type { MatchSnapshot, NoticeCode, Pickup } from '@shared/match/MatchState';
import type { PublicMatchEvent } from '@shared/protocol';
import type { ChestPlacement } from '@shared/world/layout';

/** Lo que el cliente sabe de la partida (para dibujar y para el botón Abrir/Recoger). */
export interface MatchView {
  readonly chests: readonly ChestPlacement[];
  readonly opened: readonly boolean[];
  readonly pickups: ReadonlyMap<number, Pickup>;
  readonly inventory: Inventory | null;
}

/** Cambios que la vista comunica al juego (cofres, objetos, inventario, avisos). */
export type ClientMatchEvent =
  | PublicMatchEvent
  | { type: 'inventory'; inventory: Inventory }
  | { type: 'notice'; code: NoticeCode }
  | { type: 'reset' };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Valida un objeto en el suelo recibido por red. */
export function isValidPickup(p: unknown): p is Pickup {
  const o = p as Pickup;
  return (
    typeof o === 'object' &&
    o !== null &&
    Number.isInteger(o.id) &&
    isNum(o.x) &&
    isNum(o.y) &&
    isNum(o.z) &&
    typeof o.item === 'object' &&
    o.item !== null &&
    isItemKind(o.item.kind) &&
    Number.isInteger(o.item.qty) &&
    o.item.qty > 0
  );
}

/**
 * Réplica en el cliente del estado público de la partida + inventario propio.
 * Solo aplica lo que manda el servidor (nunca lo inventa) y descarta datos
 * mal formados.
 */
export class ReplicatedMatch implements MatchView {
  opened: boolean[];
  readonly pickups = new Map<number, Pickup>();
  inventory: Inventory | null = null;

  constructor(readonly chests: readonly ChestPlacement[]) {
    this.opened = chests.map(() => false);
  }

  /** Estado completo (bienvenida). */
  load(snap: MatchSnapshot | undefined, inventory: Inventory | undefined): void {
    this.opened = this.chests.map(() => false);
    this.pickups.clear();
    if (snap && Array.isArray(snap.opened)) for (const id of snap.opened) if (Number.isInteger(id) && id >= 0 && id < this.opened.length) this.opened[id] = true;
    if (snap && Array.isArray(snap.pickups)) for (const p of snap.pickups) if (isValidPickup(p)) this.pickups.set(p.id, p);
    if (isValidInventory(inventory)) this.inventory = inventory;
  }

  /** Aplica un cambio público. Devuelve el evento si era válido. */
  apply(e: PublicMatchEvent): PublicMatchEvent | null {
    switch (e?.type) {
      case 'chestOpened':
        if (!Number.isInteger(e.chestId) || e.chestId < 0 || e.chestId >= this.opened.length) return null;
        this.opened[e.chestId] = true;
        return e;
      case 'pickupAdded':
      case 'pickupUpdated':
        if (!isValidPickup(e.pickup)) return null;
        this.pickups.set(e.pickup.id, e.pickup);
        return e;
      case 'pickupRemoved':
        return this.pickups.delete(e.id) ? e : null;
      default:
        return null;
    }
  }

  setInventory(inv: unknown): Inventory | null {
    if (!isValidInventory(inv)) return null;
    this.inventory = inv;
    return inv;
  }
}
