import { sanitizeName } from '../session';
/** Solo cambia el polo. Geometría, hitbox y movimiento idénticos para los doce colores. */
export const SHIRTS = [
  ['Mandarina','#ff8c1a'],['Menta','#3ddc97'],['Cielo','#5bc0eb'],['Coral','#ff5a5f'],
  ['Violeta','#9b5de5'],['Marfil','#f5f7ff'],['Sol','#ffd166'],['Turquesa','#06d6a0'],
  ['Rosa','#ed79b6'],['Cobalto','#4f74dc'],['Lima','#b7d85c'],['Terracota','#bd795c'],
] as const;
export interface Profile { name: string; skin: number }
export const isSkin = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < SHIRTS.length;
export function validProfile(raw: unknown): raw is Profile {
  if (!raw || typeof raw !== 'object') return false;
  const p=raw as Profile;
  return typeof p.name==='string' && p.name.length<=64 && sanitizeName(p.name).length>0 && isSkin(p.skin);
}
