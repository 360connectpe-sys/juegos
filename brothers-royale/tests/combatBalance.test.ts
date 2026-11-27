import { describe, expect, it } from 'vitest';
import {
  expectedTimeToKill,
  HEALTH,
  maxShotDamage,
  RARITY_DAMAGE,
  shotsToKill,
  timeToKill,
  WEAPON_STATS,
} from '@shared/combat/weapons';
import { RARITIES, WEAPONS, type WeaponKind } from '@shared/items';

/** Mejor arma (menor tiempo esperado para eliminar) a una distancia. */
const best = (d: number): WeaponKind =>
  [...WEAPONS].sort((a, b) => expectedTimeToKill(a, 'common', d, d >= 8) - expectedTimeToKill(b, 'common', d, d >= 8))[0]!;

describe('balance de armas (decisiones documentadas en PROJECT.md)', () => {
  it('valores de partida pedidos', () => {
    expect(WEAPON_STATS.pistol).toMatchObject({ damage: 20, fireRate: 3, magazine: 12 });
    expect(WEAPON_STATS.smg).toMatchObject({ damage: 12, fireRate: 8, magazine: 30 });
    expect(WEAPON_STATS.rifle).toMatchObject({ damage: 24, magazine: 30 });
    expect(WEAPON_STATS.shotgun).toMatchObject({ fireRate: 1, magazine: 5 });
    expect(maxShotDamage('shotgun', 'epic')).toBe(65);
  });

  it('ajuste probado: el rifle baja de 4 a 3,5 disparos/s para no dominar a corta distancia', () => {
    expect(WEAPON_STATS.rifle.fireRate).toBe(3.5);
    expect(expectedTimeToKill('rifle', 'common', 5, false)).toBeGreaterThan(expectedTimeToKill('smg', 'common', 5, false));
  });

  it('ningún disparo elimina con salud completa (todas las armas, rarezas y distancias)', () => {
    for (const w of WEAPONS) for (const r of RARITIES) {
      expect(maxShotDamage(w, r)).toBeLessThan(HEALTH.max);
      expect(shotsToKill(w, r)).toBeGreaterThanOrEqual(2);
    }
  });

  it('cada arma tiene su distancia: escopeta/subfusil cerca, subfusil a media, rifle lejos', () => {
    expect(['shotgun', 'smg']).toContain(best(2));
    expect(best(10)).toBe('smg');
    expect(best(30)).toBe('rifle');
    expect(best(60)).toBe('rifle');
    // La escopeta pierde mucho a media distancia y la pistola gana al subfusil lejos.
    expect(expectedTimeToKill('shotgun', 'common', 16, true)).toBeGreaterThan(3 * expectedTimeToKill('smg', 'common', 16, true));
    expect(expectedTimeToKill('pistol', 'common', 30, true)).toBeLessThan(expectedTimeToKill('smg', 'common', 30, true));
  });

  it('ninguna arma domina en todas las distancias', () => {
    const winners = new Set([2, 5, 10, 16, 30, 60].map(best));
    expect(winners.size).toBeGreaterThanOrEqual(2);
    // A su mejor distancia, todas eliminan en 1,0-1,4 s (sin ventajas excesivas).
    for (const [w, d] of [['shotgun', 2], ['smg', 5], ['rifle', 30], ['pistol', 12]] as const) {
      const t = expectedTimeToKill(w, 'common', d, d >= 8);
      expect(t).toBeGreaterThanOrEqual(0.99);
      expect(t).toBeLessThanOrEqual(1.4);
    }
  });

  it('la rareza ayuda poco: mismos disparos a quemarropa y de media ≤ 12 % más rápida en su alcance útil', () => {
    for (const w of WEAPONS) {
      expect(shotsToKill(w, 'epic')).toBe(shotsToKill(w, 'common'));
      expect(timeToKill(w, 'epic')).toBe(timeToKill(w, 'common'));
      expect(RARITY_DAMAGE[w].epic / RARITY_DAMAGE[w].common).toBeLessThanOrEqual(1.11);
      // Con daño discreto siempre hay una distancia umbral donde la épica ahorra un
      // disparo; lo que cuenta es la ventaja MEDIA donde el arma se usa (≤ 2 s).
      const ratios: number[] = [];
      for (let d = 2; d <= 60; d += 1) {
        const common = expectedTimeToKill(w, 'common', d, d >= 8);
        if (common > 2) continue;
        ratios.push(expectedTimeToKill(w, 'epic', d, d >= 8) / common);
      }
      const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      expect(mean).toBeGreaterThanOrEqual(0.88);
    }
  });
});
