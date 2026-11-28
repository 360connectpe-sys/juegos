/**
 * Estado de combate VISIBLE de un jugador, empaquetado en un entero pequeño
 * para el snapshot público (11 bits): qué lleva en la mano, su rareza, qué
 * está haciendo y si está eliminado. Sirve para animar a los demás.
 */
import type { ItemKind, Rarity } from '../items';

export type GearAction = 'none' | 'fire' | 'reload' | 'melee' | 'heal' | 'aim';

const HELD: readonly (ItemKind | null)[] = [null, 'axe', 'pistol', 'smg', 'shotgun', 'rifle', 'medkit', 'sniper', 'scope2'];
const RARITY: readonly Rarity[] = ['common', 'rare', 'epic'];
const ACTIONS: readonly GearAction[] = ['none', 'fire', 'reload', 'melee', 'heal', 'aim'];

export interface Gear {
  held: ItemKind | null;
  rarity: Rarity;
  action: GearAction;
  dead: boolean;
  scope?: 'x2';
}

export const GEAR_BITS = 11;

export function packGear(g: Gear): number {
  const held = Math.max(0, HELD.indexOf(g.held));
  const rarity = Math.max(0, RARITY.indexOf(g.rarity));
  const action = Math.max(0, ACTIONS.indexOf(g.action));
  return held | (rarity << 4) | (action << 6) | ((g.dead ? 1 : 0) << 9) | ((g.scope === 'x2' ? 1 : 0) << 10);
}

export function unpackGear(v: number | undefined): Gear {
  const n = Number.isInteger(v) && (v as number) >= 0 ? (v as number) : 0;
  return {
    held: HELD[n & 15] ?? null,
    rarity: RARITY[(n >> 4) & 3] ?? 'common',
    action: ACTIONS[(n >> 6) & 7] ?? 'none',
    dead: ((n >> 9) & 1) === 1,
    ...((n & 1024) ? {scope: 'x2' as const} : {}),
  };
}

export const NO_GEAR = 0;
