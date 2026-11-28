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

import { ServerWorld } from '../server/ServerWorld';
import { BattleRound } from '@shared/battle/BattleRound';
import { SUPPLY, supplyContents, supplyHeight, SupplyDrops } from '@shared/battle/supply';
import { validRound } from '@shared/battle/validation';
import { PROTOCOL_VERSION } from '@shared/protocol';
import { Buttons, emptyInput } from '@shared/types';

describe('fase 16 A: suministros aéreos', () => {
  it('contenido: 30-50 madera, 40-60 munición común, especial pequeña, botiquín a veces', () => {
    let med = 0;
    for (let i = 1; i <= 300; i++) {
      const c = supplyContents(9, i);
      expect(c.wood).toBeGreaterThanOrEqual(30); expect(c.wood).toBeLessThanOrEqual(50);
      const common = c.items[0]!; expect(['ammo_light', 'ammo_medium']).toContain(common.kind);
      expect(common.qty).toBeGreaterThanOrEqual(40); expect(common.qty).toBeLessThanOrEqual(60);
      const special = c.items[1]!; expect(special.qty).toBeLessThanOrEqual(15);
      if (c.items.some((it) => it.kind === 'medkit')) med++;
    }
    expect(med).toBeGreaterThan(100); expect(med).toBeLessThan(200);
  });
  it('avión de carga cada 120 s, máximo 3 cajas, la tormenta se las lleva y se reinicia', () => {
    const s = new SupplyDrops(3, 120);
    const zone = { x: 0, z: 0, radius: 85 };
    for (let t = 0; t <= 600; t += 1 / 30) s.step(t, zone, () => 1);
    expect(s.drops.length).toBe(3);
    expect(s.planes.every((p) => p.supply && p.id >= SUPPLY.planeBase)).toBe(true);
    s.step(601, { x: 500, z: 500, radius: 5 }, () => 1);
    expect(s.drops.length).toBe(0);
    s.reset(4); expect(s.drops.length + s.planes.length).toBe(0);
  });
  it('servidor: aterriza en un sitio válido, dos jugadores a la vez → una sola entrega; protocolo v13', async () => {
    expect(PROTOCOL_VERSION).toBe(13);
    BattleRound.defaultTransport = false;
    const w = await ServerWorld.create(undefined, 21);
    BattleRound.defaultTransport = true;
    try {
      const a = w.addPlayer('a', 'A'), b = w.addPlayer('b', 'B');
      w.round.start(); w.zombies.enabled = false;
      w.round.elapsed = SUPPLY.every - 0.5;
      let seq = 0;
      const tick = (buttons = 0) => { seq++; w.queueInput('a', { ...emptyInput(seq), buttons }); w.queueInput('b', { ...emptyInput(seq), buttons }); w.step(); w.combat.setHp('a', 100); w.combat.setHp('b', 100); };
      for (let t = 0; t < 30 * 30 && !w.round.supplies.drops.some((d) => supplyHeight(d, w.round.elapsed).landed); t++) tick();
      const snap = w.round.snapshot();
      expect(validRound(snap)).toBe(true);
      const d = snap.drops[0]!;
      expect(supplyHeight(d, w.round.elapsed).landed).toBe(true);
      expect(w.layout.structures.every((st) => st.def.id === 'chest' || Math.hypot(st.x - d.x, st.z - d.z) >= st.def.clearRadius)).toBe(true);
      for (const p of [a, b]) { p.body.teleport({ x: d.x + (p === a ? 0.6 : -0.6), y: d.ground + 0.05, z: d.z }); }
      tick(); tick();
      const woodBefore = (w.building.state.wood.get('a') ?? 0) + (w.building.state.wood.get('b') ?? 0);
      const totalsBefore = w.match.totals();
      tick(Buttons.INTERACT);
      const woodAfter = (w.building.state.wood.get('a') ?? 0) + (w.building.state.wood.get('b') ?? 0);
      const c = supplyContents((w.round.seed + w.round.round) >>> 0, d.id);
      expect(woodAfter - woodBefore).toBe(c.wood); // solo uno la abrió
      // Objetos creados = exactamente el contenido (suelo + inventarios: el otro jugador puede recoger uno).
      const totalsAfter = w.match.totals();
      const want: Record<string, number> = {};
      for (const it of c.items) want[it.kind] = (want[it.kind] ?? 0) + it.qty;
      for (const [k, n] of Object.entries(want)) expect((totalsAfter[k] ?? 0) - (totalsBefore[k] ?? 0)).toBe(n);
      expect(w.round.supplies.drops.some((x) => x.id === d.id)).toBe(false);
      w.round.returnToLobby(true);
      expect(w.round.snapshot().drops).toHaveLength(0);
    } finally { w.dispose(); }
  });
});
