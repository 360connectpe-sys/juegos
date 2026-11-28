/** Fase 12 — zombis del servidor: aparición, persecución, ataque, navegación, daño, botín y red. */
import { describe, expect, it } from 'vitest';
import { ServerWorld } from '../server/ServerWorld';
import { BattleRound } from '@shared/battle/BattleRound';
import { contains } from '@shared/battle/zone';
import { addItem } from '@shared/inventory';
import { rotateXZ } from '@shared/math';
import { Buttons, emptyInput } from '@shared/types';
import { variantOf } from '@shared/world/layout';
import { chooseTarget, ZOMBIE } from '@shared/zombies/zombieAi';
import { unpackZombies, ZOMBIE_STRIDE } from '@/physics/ZombieDirector';
import { EYE_HEIGHT } from '@shared/combat/weapons';
import { isValidCombatEvent, isValidDamageEvent } from '@/net/CombatView';

async function setup(n: number, transport = false) {
  BattleRound.defaultTransport = transport;
  const w = await ServerWorld.create(undefined, 11);
  BattleRound.defaultTransport = true;
  const ids = Array.from({ length: n }, (_, i) => w.addPlayer(`p${i}`, `P${i}`).id);
  const seq = new Map(ids.map((id) => [id, 0]));
  const tick = (inputs: Record<string, Partial<ReturnType<typeof emptyInput>>> = {}) => {
    for (const id of ids) { const s = seq.get(id)! + 1; seq.set(id, s); w.queueInput(id, { ...emptyInput(s), ...inputs[id] }); }
    w.step();
  };
  const place = (id: string, x: number, z: number, y?: number) => {
    const p = w.players.get(id)!; p.body.teleport({ x, y: y ?? (w.physics.groundHeightAt(x, z, 120) ?? 0) + 0.05, z }); p.correctionDirty = true;
  };
  return { w, ids, tick, place };
}
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe('fase 12: decisiones de los zombis (puras)', () => {
  it('persiguen al jugador vivo y alcanzable más cercano, con histéresis; ignoran a quien está en el aire', () => {
    const from = { x: 0, y: 0, z: 0 };
    const c = [
      { id: 'a', feet: { x: 10, y: 0, z: 0 }, targetable: true },
      { id: 'b', feet: { x: 6, y: 0, z: 0 }, targetable: true },
      { id: 'c', feet: { x: 2, y: 40, z: 0 }, targetable: false },
    ];
    expect(chooseTarget(from, c, null)).toBe('b');
    expect(chooseTarget(from, c, 'a')).toBe('a'); // 10 ≤ 6 + 4: mantiene
    expect(chooseTarget(from, [{ ...c[0]!, feet: { x: 20, y: 0, z: 0 } }, c[1]!], 'a')).toBe('b');
    expect(chooseTarget(from, [c[2]!], null)).toBeNull();
    expect(chooseTarget(from, [{ id: 'far', feet: { x: 80, y: 0, z: 0 }, targetable: true }], null)).toBeNull();
    expect(ZOMBIE).toMatchObject({ hp: 40, damage: 5, spawnEvery: 30, attackInterval: 0.8, maxActive: 8 });
  });
});

describe('fase 12: zombis autoritativos', () => {
  it('aparece uno cada 30 s, nunca más de 8, en la zona, lejos de los jugadores y fuera de los edificios', async () => {
    const { w, ids, tick } = await setup(8);
    try {
      w.round.start();
      const counts: number[] = [];
      for (let s = 1; s <= 300; s++) {
        for (let t = 0; t < 30; t++) tick();
        for (const id of ids) w.combat.setHp(id, 100); // la prueba mide apariciones, no supervivencia
        if (s % 30 === 0) counts.push(w.zombies.alive);
        for (const z of w.zombies.zombies.values()) {
          if (z.deadT >= 0) continue;
          expect(contains(w.round.zone.current, z.body.state.position, -1)).toBe(true);
        }
      }
      expect(counts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 8, 8]);
      expect(w.round.phase).toBe('running');
    } finally { w.dispose(); }
  }, 90000);

  it('la aparición respeta la distancia mínima a todos los jugadores y no cae dentro de estructuras', async () => {
    const { w, tick } = await setup(2);
    try {
      w.round.start();
      for (let t = 0; t < 30 * 30 * 8; t++) { tick(); w.combat.setHp('p0', 100); w.combat.setHp('p1', 100); }
      expect(w.round.phase).toBe('running');
      for (const z of w.zombies.zombies.values()) {
        const p = z.body.state.position;
        expect(w.layout.structures.every((s) => s.def.id === 'chest' || dist(s, p) >= s.def.clearRadius - 6)).toBe(true);
      }
      expect(w.zombies.zombies.size).toBeGreaterThan(0);
    } finally { w.dispose(); }
  });

  it('persigue, golpea cuerpo a cuerpo 5 HP cada 0,8 s y no persigue a quien está en el avión', async () => {
    const { w, tick, place } = await setup(2);
    try {
      w.round.start();
      for (let t = 0; t < 100; t++) tick(); // fin de la protección al empezar
      place('p0', 20, 20); place('p1', -30, -30);
      const zid = w.zombies.spawnAt(26, 20)!;
      expect(zid).toBeTruthy();
      const hps: number[] = [];
      for (let t = 0; t < 30 * 8; t++) { tick(); hps.push(w.combat.hp('p0')); }
      const z = w.zombies.zombies.get(zid)!;
      expect(dist(z.body.state.position, w.players.get('p0')!.body.state.position)).toBeLessThan(ZOMBIE.attackRange + 0.3);
      const hits = hps.filter((h, i) => i > 0 && h < hps[i - 1]!).length;
      const lost = 100 - w.combat.hp('p0');
      expect(lost % ZOMBIE.damage).toBe(0);
      expect(hits).toBeGreaterThan(3);
      expect(hits).toBeLessThanOrEqual(Math.ceil(8 / ZOMBIE.attackInterval));
      // Sin estadísticas de jugador para el zombi; el jugador no "pierde" contra un jugador.
      expect(w.combat.log.stats.has(zid)).toBe(false);
      expect(w.combat.log.of('p0').damageTaken).toBe(0);
    } finally { w.dispose(); }
  });

  it('no persigue a jugadores en el avión ni en el descenso protegido', async () => {
    const { w, tick } = await setup(2, true);
    try {
      w.round.start();
      tick();
      expect(w.round.airMode('p0')).toBe(1);
      const zid = w.zombies.spawnAt(0, 0)!;
      for (let t = 0; t < 60; t++) tick();
      expect(w.zombies.zombies.get(zid)!.target).toBeNull();
      expect(w.combat.hp('p0')).toBe(100);
    } finally { w.dispose(); }
  });

  it('muere con armas (40 HP): sin contar para estadísticas ni ganador; puede soltar munición o madera', async () => {
    const { w, tick, place } = await setup(2);
    try {
      w.round.start();
      for (let t = 0; t < 100; t++) tick();
      w.zombies.dropChance = 1;
      place('p0', 20, 20); place('p1', -30, -30);
      let inv = addItem(w.match.inventory('p0')!, { kind: 'rifle', qty: 1, rarity: 'rare' }).inventory;
      inv = addItem(inv, { kind: 'ammo_medium', qty: 120 }).inventory;
      w.match.setInventory('p0', inv); w.selectSlot('p0', 1);
      const zid = w.zombies.spawnAt(27, 20)!;
      const pickupsBefore = w.match.pickups.size, woodBefore = w.building.state.wood.get('p0') ?? 0;
      let killed = false;
      for (let t = 0; t < 30 * 10 && !killed; t++) {
        const z = w.zombies.zombies.get(zid)!.body.state.position, me = w.players.get('p0')!.body.state.position;
        const dx = z.x - me.x, dz = z.z - me.z, dy = z.y + 1.0 - (me.y + EYE_HEIGHT);
        tick({ p0: { buttons: Buttons.FIRE | Buttons.AIM, aimYaw: Math.atan2(dx, dz), aimPitch: Math.atan2(dy, Math.hypot(dx, dz)) } });
        killed = w.combat.isDead(zid) || !w.combat.has(zid);
      }
      expect(killed).toBe(true);
      expect(w.combat.log.of('p0').kills).toBe(0);
      expect(w.combat.log.of('p0').eliminations).toBe(0);
      expect(w.match.pickups.size > pickupsBefore || (w.building.state.wood.get('p0') ?? 0) > woodBefore).toBe(true);
      // Cadáver visible un momento y después desaparece (cuerpo y combate).
      for (let t = 0; t < 30 * 3; t++) tick();
      expect(w.zombies.zombies.has(zid)).toBe(false);
      expect(w.combat.has(zid)).toBe(false);
    } finally { w.dispose(); }
  });

  it('el hacha también los mata', async () => {
    const { w, tick, place } = await setup(2);
    try {
      w.round.start();
      for (let t = 0; t < 100; t++) tick();
      place('p0', 20, 20); place('p1', -30, -30);
      const zid = w.zombies.spawnAt(21.2, 20)!;
      for (let t = 0; t < 30 * 12 && w.combat.has(zid) && !w.combat.isDead(zid); t++) {
        const z = w.zombies.zombies.get(zid)!.body.state.position, me = w.players.get('p0')!.body.state.position;
        tick({ p0: { buttons: Buttons.FIRE, aimYaw: Math.atan2(z.x - me.x, z.z - me.z) } });
      }
      expect(!w.combat.has(zid) || w.combat.isDead(zid)).toBe(true);
    } finally { w.dispose(); }
  });

  it('la tormenta les hace daño', async () => {
    const { w, tick, place } = await setup(2);
    try {
      w.round.start();
      w.round.elapsed = 700; // fase 4: zona de 20 m
      const c = w.round.zone.current;
      place('p0', c.x, c.z); place('p1', c.x + 1, c.z);
      const zx = Math.max(-50, Math.min(50, c.x + (c.x > 0 ? -35 : 35)));
      const zid = w.zombies.spawnAt(zx, c.z)!;
      for (let t = 0; t < 70; t++) { tick(); w.combat.setHp('p0', 100); w.combat.setHp('p1', 100); }
      expect(w.combat.hp(zid)).toBeLessThan(ZOMBIE.hp);
    } finally { w.dispose(); }
  });

  it('entra en las casas por la puerta y sube escaleras hasta la planta alta (sin atravesar paredes)', async () => {
    const { w, tick, place } = await setup(2);
    try {
      w.round.start();
      for (let t = 0; t < 100; t++) tick();
      const local = (h: { x: number; z: number; rotationY: number }, x: number, z: number) => { const r = rotateXZ(x, z, h.rotationY); return { x: h.x + r.x, z: h.z + r.z }; };
      // Casa de una planta: el jugador dentro; el zombi detrás de la casa (pared del fondo en medio).
      const cabin = w.layout.houses.find((h) => variantOf(h) === 'cabin')!;
      const inside = local(cabin, 0, -0.5), behind = local(cabin, 0, -6);
      place('p0', inside.x, inside.z, cabin.y + 0.05); place('p1', -50, -50);
      const zid = w.zombies.spawnAt(behind.x, behind.z)!;
      let reached = false;
      for (let t = 0; t < 30 * 25 && !reached; t++) {
        tick(); w.combat.setHp('p0', 100);
        reached = dist(w.zombies.zombies.get(zid)!.body.state.position, w.players.get('p0')!.body.state.position) < 1.6;
      }
      expect(reached).toBe(true);
      // Casa con balcón: el jugador en la planta alta; el zombi sube la escalera interior.
      const balcony = w.layout.houses.find((h) => variantOf(h) === 'balcony')!;
      const up = local(balcony, 1.0, 0.3);
      place('p0', up.x, up.z, balcony.y + 2.85);
      const front = local(balcony, 1.2, 6);
      const z2 = w.zombies.spawnAt(front.x, front.z)!;
      let upstairs = false;
      for (let t = 0; t < 30 * 40 && !upstairs; t++) {
        tick(); w.combat.setHp('p0', 100);
        const zp = w.zombies.zombies.get(z2)!.body.state.position;
        upstairs = zp.y - balcony.y > 2.4 && dist(zp, w.players.get('p0')!.body.state.position) < 2;
      }
      expect(upstairs).toBe(true);
    } finally { w.dispose(); }
  });

  it('no aparecen tras terminar la partida, no cuentan para el ganador y viajan validados en el snapshot', async () => {
    const { w, tick } = await setup(2);
    try {
      w.round.start();
      const zid = w.zombies.spawnAt(30, -30)!;
      const snap = w.snapshot();
      expect(snap.z).toHaveLength(ZOMBIE_STRIDE);
      const [pub] = unpackZombies(snap.z);
      expect(pub).toMatchObject({ hp: 40 });
      expect(unpackZombies([...snap.z!.slice(0, 6), 999])).toEqual([]);
      expect(unpackZombies(new Array(17 * ZOMBIE_STRIDE).fill(1))).toEqual([]);
      expect(isValidDamageEvent({ type: 'damage', victim: 'p0', by: zid, weapon: 'zombie', amount: 5, hp: 95, at: { x: 0, y: 0, z: 0 } })).toBe(true);
      expect(isValidCombatEvent({ type: 'death', victim: zid, killer: 'p0', weapon: 'rifle', tick: 1, at: { x: 0, y: 0, z: 0 } })).toBe(true);
      // p1 cae (definitivamente): gana p0 aunque haya un zombi vivo.
      for (let i = 0; i < 3; i++) {
        w.combat.environmentalDamage('p1', 100, w.players.get('p1')!.body.state.position, w.tick);
        for (let t = 0; t < 30 * 20 && i < 2 && (w.combat.isDead('p1') || (w.combat.vitals('p1')?.descending ?? false) || (w.combat.vitals('p1')?.protection ?? 0) > 0); t++) { tick(); w.combat.setHp('p0', 100); }
      }
      tick();
      expect(w.round.phase).toBe('finished');
      expect(w.round.snapshot().result?.winners).toEqual(['p0']);
      const before = w.zombies.zombies.size;
      for (let t = 0; t < 30 * 40; t++) w.step();
      expect(w.zombies.zombies.size).toBeLessThanOrEqual(before);
    } finally { w.dispose(); }
  });
});
