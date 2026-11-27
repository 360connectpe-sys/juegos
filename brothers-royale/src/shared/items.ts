/**
 * Objetos del juego (datos puros, compartidos con el servidor).
 * Fase 6: las armas disparan (shared/combat), la munición se recarga y los
 * botiquines curan. NO hay escudos.
 */
export type WeaponKind = 'pistol' | 'smg' | 'shotgun' | 'rifle';
export type AmmoKind = 'ammo_light' | 'ammo_medium' | 'ammo_shells';
export type ItemKind = 'axe' | WeaponKind | AmmoKind | 'medkit';
export type Rarity = 'common' | 'rare' | 'epic';
export type ItemCategory = 'tool' | 'weapon' | 'ammo' | 'heal';

export interface ItemDef {
  label: string;
  category: ItemCategory;
  /** Máximo por hueco (armas 1, botiquines 3) o por bolsa (munición). */
  stack: number;
  /** Munición que usa (armas). */
  ammo?: AmmoKind;
}

export const ITEMS: Readonly<Record<ItemKind, ItemDef>> = {
  axe: { label: 'Hacha', category: 'tool', stack: 1 },
  pistol: { label: 'Pistola', category: 'weapon', stack: 1, ammo: 'ammo_light' },
  smg: { label: 'Subfusil', category: 'weapon', stack: 1, ammo: 'ammo_light' },
  shotgun: { label: 'Escopeta', category: 'weapon', stack: 1, ammo: 'ammo_shells' },
  rifle: { label: 'Rifle', category: 'weapon', stack: 1, ammo: 'ammo_medium' },
  ammo_light: { label: 'Munición ligera', category: 'ammo', stack: 360 },
  ammo_medium: { label: 'Munición media', category: 'ammo', stack: 180 },
  ammo_shells: { label: 'Cartuchos', category: 'ammo', stack: 30 },
  medkit: { label: 'Botiquín', category: 'heal', stack: 3 },
};

export const ITEM_KINDS = Object.keys(ITEMS) as ItemKind[];
export const WEAPONS: readonly WeaponKind[] = ['pistol', 'smg', 'shotgun', 'rifle'];
export const AMMO: readonly AmmoKind[] = ['ammo_light', 'ammo_medium', 'ammo_shells'];
export const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic'];
export const RARITY_LABEL: Record<Rarity, string> = { common: 'común', rare: 'rara', epic: 'épica' };

export const isItemKind = (v: unknown): v is ItemKind => typeof v === 'string' && Object.prototype.hasOwnProperty.call(ITEMS, v);
export const isAmmo = (k: ItemKind): k is AmmoKind => ITEMS[k].category === 'ammo';
export const isWeapon = (k: ItemKind): k is WeaponKind => ITEMS[k].category === 'weapon';

/** Un objeto concreto (en el inventario o en el suelo). */
export interface ItemStack {
  kind: ItemKind;
  qty: number;
  /** Solo armas. */
  rarity?: Rarity;
  /**
   * Solo armas: balas en el cargador. Sin definir = cargador lleno (arma nueva
   * de un cofre). Se conserva al soltar y recoger: no hay recarga gratis.
   */
  mag?: number;
}

export function itemName(s: ItemStack): string {
  const def = ITEMS[s.kind];
  if (s.rarity) return `${def.label} ${RARITY_LABEL[s.rarity]}`;
  return s.qty > 1 ? `${def.label} ×${s.qty}` : def.label;
}
