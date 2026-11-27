import { EQUIP_SECONDS, MELEE, MOVE_SPREAD, rarityOf, spreadOf, WEAPON_STATS } from '@shared/combat/weapons';
import { magOf, type Inventory } from '@shared/inventory';
import { isWeapon, type WeaponKind } from '@shared/items';
import type { Vitals } from '@shared/combat/CombatState';
import { Buttons, hasButton, type PlayerInput } from '@shared/types';

export type LocalAttack = { type: 'shot'; weapon: WeaponKind } | { type: 'melee' } | null;

/**
 * Predicción SOLO VISUAL del arma propia: decide cuándo mostrar el fogonazo,
 * la trazadora, el sonido y el retroceso sin esperar al servidor. Usa la
 * misma cadencia, desenfundado y cargador que la autoridad, pero no decide
 * impactos, daño ni munición: el cargador se re-sincroniza con cada
 * inventario recibido.
 */
export class LocalWeapon {
  private cooldown = 0;
  private equip = 0;
  private slot = -1;
  private mag = -1;
  bloom = 0;
  private bloomRecovery = 1;

  /** Inventario autoritativo recibido: vuelve a contar desde su cargador. */
  sync(inv: Inventory | null): void {
    const item = inv?.slots[inv.selected];
    this.mag = item && isWeapon(item.kind) ? magOf(item) : -1;
  }

  /** Dispersión actual estimada (para el tamaño de la mira). */
  spread(inv: Inventory | null, aiming: boolean, speed: number, grounded: boolean): number {
    const item = inv?.slots[inv.selected];
    if (!item || !isWeapon(item.kind)) return 0;
    let s = spreadOf(item.kind, rarityOf(item.rarity), aiming) + this.bloom;
    if (!grounded) s *= MOVE_SPREAD.airborne;
    else if (speed > MOVE_SPREAD.movingSpeed) s *= MOVE_SPREAD.moving;
    return s;
  }

  tick(input: PlayerInput, inv: Inventory | null, vitals: Vitals, dt: number): LocalAttack {
    this.cooldown -= dt;
    this.equip = Math.max(0, this.equip - dt);
    this.bloom = Math.max(0, this.bloom - this.bloomRecovery * dt);
    if (!inv || vitals.dead) return null;
    if (inv.selected !== this.slot) {
      if (this.slot !== -1) this.equip = EQUIP_SECONDS;
      this.slot = inv.selected;
      this.sync(inv);
    }
    const item = inv.slots[inv.selected];
    const fire = hasButton(input.buttons, Buttons.FIRE);
    let attack: LocalAttack = null;
    if (fire && item && this.equip <= 0 && this.cooldown <= 0) {
      if (item.kind === 'axe') {
        attack = { type: 'melee' };
        this.cooldown += 1 / MELEE.rate;
      } else if (isWeapon(item.kind) && vitals.reload <= 0 && this.mag > 0) {
        const s = WEAPON_STATS[item.kind];
        attack = { type: 'shot', weapon: item.kind };
        this.mag--;
        this.cooldown += 1 / s.fireRate;
        this.bloom = Math.min(s.bloomMax, this.bloom + s.bloomPerShot);
        this.bloomRecovery = s.bloomRecovery;
      }
    }
    if (!attack && this.cooldown < 0) this.cooldown = 0;
    return attack;
  }
}
