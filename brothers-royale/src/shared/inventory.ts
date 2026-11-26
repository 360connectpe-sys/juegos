/**
 * Inventario del jugador (puro, inmutable). Lo calcula SIEMPRE el servidor;
 * el cliente solo lo muestra.
 *  - 5 huecos. El hueco 1 (índice 0) es el hacha, permanente: no se suelta
 *    ni se reemplaza.
 *  - Armas: 1 por hueco. Botiquines: hasta 3 por hueco.
 *  - Munición: en una bolsa aparte por tipo (no ocupa huecos), con tope.
 */
import { AMMO, isAmmo, ITEMS, type AmmoKind, type ItemStack } from './items';

export const INVENTORY_SLOTS = 5;
export const AXE_SLOT = 0;

export interface Inventory {
  slots: (ItemStack | null)[];
  ammo: Record<AmmoKind, number>;
  /** Hueco seleccionado (0..4). */
  selected: number;
}

export function createInventory(): Inventory {
  const slots: (ItemStack | null)[] = Array.from({ length: INVENTORY_SLOTS }, () => null);
  slots[AXE_SLOT] = { kind: 'axe', qty: 1 };
  return { slots, ammo: { ammo_light: 0, ammo_medium: 0, ammo_shells: 0 }, selected: AXE_SLOT };
}

export interface AddResult {
  inventory: Inventory;
  /** Lo que no cupo (queda en el suelo) o null. */
  leftover: ItemStack | null;
  /** Objeto que salió del inventario al intercambiar (cae al suelo) o null. */
  dropped: ItemStack | null;
  /** Cuánto se guardó. */
  taken: number;
}

const clone = (inv: Inventory): Inventory => ({ slots: inv.slots.map((s) => (s ? { ...s } : null)), ammo: { ...inv.ammo }, selected: inv.selected });

/**
 * Añade un objeto. Munición → bolsa (hasta el tope; el resto se queda).
 * Botiquín → apila en un hueco con botiquines, o en uno libre. Arma → hueco
 * libre; si no hay, se intercambia por el objeto seleccionado (salvo el hacha).
 */
export function addItem(inv: Inventory, item: ItemStack): AddResult {
  const out = clone(inv);
  if (!(item.qty > 0)) return { inventory: inv, leftover: null, dropped: null, taken: 0 };
  if (isAmmo(item.kind)) {
    const cap = ITEMS[item.kind].stack;
    const taken = Math.max(0, Math.min(item.qty, cap - out.ammo[item.kind]));
    out.ammo[item.kind] += taken;
    return { inventory: out, leftover: taken < item.qty ? { ...item, qty: item.qty - taken } : null, dropped: null, taken };
  }
  let left = item.qty;
  const max = ITEMS[item.kind].stack;
  if (max > 1)
    for (const s of out.slots)
      if (s && s.kind === item.kind && s.qty < max && left > 0) {
        const n = Math.min(max - s.qty, left);
        s.qty += n;
        left -= n;
      }
  while (left > 0) {
    const free = out.slots.findIndex((s, i) => i !== AXE_SLOT && s === null);
    if (free < 0) break;
    const n = Math.min(max, left);
    out.slots[free] = { ...item, qty: n };
    left -= n;
  }
  if (left > 0 && left === item.qty && out.selected !== AXE_SLOT && out.slots[out.selected]) {
    // Lleno: se cambia por lo que se tiene en la mano.
    const dropped = out.slots[out.selected]!;
    out.slots[out.selected] = { ...item, qty: Math.min(max, left) };
    left -= Math.min(max, left);
    return { inventory: out, leftover: left > 0 ? { ...item, qty: left } : null, dropped, taken: item.qty - left };
  }
  return { inventory: out, leftover: left > 0 ? { ...item, qty: left } : null, dropped: null, taken: item.qty - left };
}

/** ¿Cabe algo de este objeto (sin necesidad de intercambiar)? */
export function canTake(inv: Inventory, item: ItemStack): boolean {
  if (isAmmo(item.kind)) return inv.ammo[item.kind] < ITEMS[item.kind].stack;
  const max = ITEMS[item.kind].stack;
  return inv.slots.some((s, i) => i !== AXE_SLOT && (s === null || (s.kind === item.kind && s.qty < max)));
}

export function selectSlot(inv: Inventory, slot: number): Inventory {
  if (!Number.isInteger(slot) || slot < 0 || slot >= INVENTORY_SLOTS) return inv;
  return { ...clone(inv), selected: slot };
}

/** Todo lo que se puede soltar (al salir de la partida): nunca el hacha. */
export function droppableItems(inv: Inventory): ItemStack[] {
  const items: ItemStack[] = inv.slots.filter((s, i): s is ItemStack => i !== AXE_SLOT && s !== null).map((s) => ({ ...s }));
  for (const a of AMMO) if (inv.ammo[a] > 0) items.push({ kind: a, qty: inv.ammo[a] });
  return items;
}

/** Valida un inventario recibido por red (el cliente nunca confía a ciegas). */
export function isValidInventory(v: unknown): v is Inventory {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Inventory;
  return (
    Array.isArray(o.slots) &&
    o.slots.length === INVENTORY_SLOTS &&
    o.slots.every((s) => s === null || (typeof s === 'object' && typeof s.kind === 'string' && s.kind in ITEMS && Number.isInteger(s.qty) && s.qty > 0)) &&
    o.slots[AXE_SLOT]?.kind === 'axe' &&
    typeof o.ammo === 'object' &&
    o.ammo !== null &&
    AMMO.every((a) => Number.isInteger(o.ammo[a]) && o.ammo[a] >= 0) &&
    Number.isInteger(o.selected) &&
    o.selected >= 0 &&
    o.selected < INVENTORY_SLOTS
  );
}
