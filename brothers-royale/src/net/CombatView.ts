import type { Vitals } from '@shared/combat/CombatState';
import { HEALTH } from '@shared/combat/weapons';
import { isWeapon, isItemKind, RARITIES } from '@shared/items';
import type { DamageEvent, PublicCombatEvent } from '@shared/protocol';
import type { Vec3 } from '@shared/types';

/** Lo que el cliente sabe de su propio combate (salud, recarga, curación). */
export interface CombatView {
  readonly vitals: Vitals;
}

/** Cambios de combate que la sesión comunica al juego (FX, HUD, sonido). */
export type ClientCombatEvent =
  | PublicCombatEvent
  | DamageEvent
  | { type: 'vitals'; vitals: Vitals }
  | { type: 'healed'; amount: number }
  | { type: 'empty' };

export const fullVitals = (): Vitals => ({ hp: HEALTH.max, dead: false, respawnIn: 0, reload: 0, reloadTotal: 0, heal: 0, healTotal: 0 });

const num = (v: unknown, min = -Infinity, max = Infinity): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isVec = (v: unknown): v is Vec3 => typeof v === 'object' && v !== null && num((v as Vec3).x) && num((v as Vec3).y) && num((v as Vec3).z);
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;
const isAttack = (v: unknown) => v === 'axe' || v === 'storm' || v === 'fall' || v === 'zombie' || (isItemKind(v) && isWeapon(v));

/** Valida la salud y acciones propias recibidas (nunca confiar a ciegas). */
export function isValidVitals(v: unknown): v is Vitals {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Vitals;
  return (o.lives === undefined || (Number.isInteger(o.lives) && num(o.lives, 0, 3)))
    && (o.descending === undefined || typeof o.descending === 'boolean')
    && (o.protection === undefined || num(o.protection, 0, 3))
    && num(o.hp, 0, HEALTH.max) && typeof o.dead === 'boolean' && num(o.respawnIn, 0, 60)
    && num(o.reload, 0, 10) && num(o.reloadTotal, 0, 10) && num(o.heal, 0, 10) && num(o.healTotal, 0, 10);
}

/** Valida un evento de combate público. Los disparos van acotados (perdigones). */
export function isValidCombatEvent(e: unknown): e is PublicCombatEvent {
  if (typeof e !== 'object' || e === null) return false;
  const o = e as PublicCombatEvent;
  switch (o.type) {
    case 'shot':
      return isId(o.by) && isItemKind(o.weapon) && isWeapon(o.weapon) && RARITIES.includes(o.rarity) && isVec(o.origin)
        && Array.isArray(o.ends) && o.ends.length >= 1 && o.ends.length <= 16 && o.ends.every(isVec)
        && Array.isArray(o.hits) && o.hits.length === o.ends.length && o.hits.every((h) => typeof h === 'boolean');
    case 'melee':
      return isId(o.by) && isVec(o.origin) && isVec(o.end) && typeof o.hit === 'boolean';
    case 'death':
      return isId(o.victim) && isId(o.killer) && isAttack(o.weapon) && Number.isSafeInteger(o.tick) && isVec(o.at);
    case 'respawn':
      return isId(o.id);
    default:
      return false;
  }
}

export function isValidDamageEvent(e: unknown): e is DamageEvent {
  if (typeof e !== 'object' || e === null) return false;
  const o = e as DamageEvent;
  return o.type === 'damage' && isId(o.victim) && isId(o.by) && isAttack(o.weapon)
    && num(o.amount, 0, o.weapon === 'fall' ? HEALTH.max : o.weapon === 'storm' ? 50 : HEALTH.maxShotDamage) && num(o.hp, 0, HEALTH.max) && isVec(o.at);
}
