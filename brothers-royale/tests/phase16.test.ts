/** Fase 16 — recursos (madera y munición) y suministros aéreos. */
import { describe, expect, it } from 'vitest';
import { chestWood, rollChestLoot } from '@shared/match/loot';
import { zombieLoot } from '@shared/zombies/zombieAi';
import { createRng } from '@shared/random';
import { BUILD, BuildingState } from '@shared/building/BuildingState';

describe('fase 16 B: madera y munición', () => {
  it('cofres: munición +50 % y 10-20 de madera deterministas', () => {
    const qty: Record<string, number[]> = {};
    for (let s = 0; s < 300; s++) for (const it of rollChestLoot(s, s % 23)) if (it.kind.startsWith('ammo_')) (qty[it.kind] ??= []).push(it.qty);
    expect(Math.min(...qty.ammo_light!)).toBeGreaterThanOrEqual(45); expect(Math.max(...qty.ammo_light!)).toBeLessThanOrEqual(90);
    expect(Math.min(...qty.ammo_shells!)).toBeGreaterThanOrEqual(9); expect(Math.max(...qty.ammo_shells!)).toBeLessThanOrEqual(18);
    for (let c = 0; c < 40; c++) { const w = chestWood(7, c); expect(w).toBeGreaterThanOrEqual(10); expect(w).toBeLessThanOrEqual(20); expect(chestWood(7, c)).toBe(w); }
  });
  it('zombis: misma probabilidad munición/curación, munición +50 %', () => {
    const r = createRng(5); let heal = 0; const n = 2000;
    for (let i = 0; i < n; i++) { const it = zombieLoot(r); if (it.kind === 'medkit') heal++; else { expect(it.qty).toBeGreaterThanOrEqual(23); expect(it.qty).toBeLessThanOrEqual(45); } }
    expect(heal / n).toBeGreaterThan(0.45); expect(heal / n).toBeLessThan(0.55);
  });
  it('árbol talado entero: exactamente woodPerTree, con cualquier tamaño de golpe', () => {
    for (const hit of [15, 20, 7, 90]) {
      const s = new BuildingState(1, 120, { ground: () => 0, clear: () => true, changed: () => undefined });
      s.addPlayer('a');
      while (s.trees[0]! > 0) s.hitTree('a', 0, hit, true);
      expect(s.wood.get('a')).toBe(BUILD.woodPerTree);
    }
  });
});
