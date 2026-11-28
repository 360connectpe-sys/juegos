/**
 * Botín de cofres: aleatorio en cada partida pero DETERMINISTA dado
 * (semilla de partida, id de cofre). Solo lo calcula el servidor (u
 * OfflineSession): el cliente nunca decide qué sale de un cofre.
 */
import { ITEMS, WEAPONS, type AmmoKind, type ItemStack, type Rarity } from '../items';
import { createRng, hash2 } from '../random';

const AMMO_RANGE: Record<AmmoKind, [number, number]> = {
  // Fase 16: +50 % (antes 30-60 / 20-40 / 6-12).
  ammo_light: [45, 90],
  ammo_medium: [30, 60],
  ammo_shells: [9, 18],
};

const int = (rng: () => number, [a, b]: [number, number]) => a + Math.floor(rng() * (b - a + 1));

/** Semilla del cofre: mezcla estable de la semilla de partida y el id. */
export const chestSeed = (matchSeed: number, chestId: number): number => Math.floor(hash2(matchSeed | 0, chestId, 0x10a7) * 0xffffffff);

/**
 * Siempre: 1 arma (rareza común 60 %, rara 30 %, épica 10 %) y munición para
 * ella. A veces: botiquines (45 %) y munición extra (30 %). Nunca escudos.
 */
export function rollChestLoot(matchSeed: number, chestId: number): ItemStack[] {
  const rng = createRng(chestSeed(matchSeed, chestId));
  const weapon = WEAPONS[Math.floor(rng() * WEAPONS.length)]!;
  const r = rng();
  const rarity: Rarity = r < 0.6 ? 'common' : r < 0.9 ? 'rare' : 'epic';
  const ammo = ITEMS[weapon].ammo!;
  const loot: ItemStack[] = [
    { kind: weapon, qty: 1, rarity },
    { kind: ammo, qty: int(rng, AMMO_RANGE[ammo]) },
  ];
  if (rng() < 0.35) loot.push({ kind: 'scope2', qty: 1 });
  // Fase 15: un tercio de los cofres (repartidos por el mapa y distintos en cada partida) lleva
  // botiquín seguro; el resto, con la probabilidad de antes. Mismos sorteos: no cambia lo demás.
  const heal = rng() < 0.45;
  const qty = rng() < 0.33 ? 2 : 1;
  if (heal || ((chestId + (matchSeed >>> 0)) % 3) === 0) loot.push({ kind: 'medkit', qty });
  if (rng() < 0.3) {
    const extra = (['ammo_light', 'ammo_medium', 'ammo_shells'] as const)[Math.floor(rng() * 3)]!;
    loot.push({ kind: extra, qty: int(rng, AMMO_RANGE[extra]) });
  }
  return loot;
}

/** Fase 16: madera de un cofre normal (10-20), determinista por (partida, cofre). */
export function chestWood(matchSeed: number, chestId: number): number {
  const rng = createRng((chestSeed(matchSeed, chestId) ^ 0x3d00d) >>> 0);
  return 10 + Math.floor(rng() * 11);
}
