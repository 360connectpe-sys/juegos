import { describe, expect, it } from 'vitest';
import { CombatState, type AttackContext, type CombatEvent, type TargetPose } from '@shared/combat/CombatState';
import { packGear, unpackGear } from '@shared/combat/gear';
import { applySpread, rayHitbox } from '@shared/combat/hitscan';
import { PoseHistory } from '@shared/combat/lagcomp';
import {
  DEATH,
  directionFromAim,
  EQUIP_SECONDS,
  HEAL,
  HEALTH,
  LAG_COMPENSATION,
  MELEE,
  reloadSeconds,
  WEAPON_STATS,
} from '@shared/combat/weapons';
import { addItem, createInventory, magOf, reloadWeapon, withMag } from '@shared/inventory';
import { MatchState } from '@shared/match/MatchState';
import { createRng } from '@shared/random';
import { Buttons, type PlayerInput, type Vec3 } from '@shared/types';

const DT = 1 / 30;

/** Mundo de prueba: objetivos en posiciones fijas y una pared opcional en x = wallX. */
function setup(opts: { wallX?: number } = {}) {
  const match = new MatchState([], 7);
  const combat = new CombatState(match, 7);
  const poses = new Map<string, Vec3>();
  const add = (id: string, feet: Vec3) => {
    match.addPlayer(id);
    combat.addFighter(id);
    poses.set(id, feet);
  };
  const give = (id: string, ...items: Parameters<typeof addItem>[1][]) => {
    let inv = match.inventory(id)!;
    for (const it of items) inv = addItem(inv, it).inventory;
    match.setInventory(id, inv);
  };
  const select = (id: string, slot: number) => match.selectSlot(id, slot);
  const ctxOf = (id: string, tick = 0): AttackContext => ({
    feet: poses.get(id)!,
    grounded: true,
    speed: 0,
    dt: DT,
    tick,
    targets: (): Iterable<TargetPose> => [...poses].map(([pid, feet]) => ({ id: pid, feet })),
    castStatic: (o, d, max) => {
      if (opts.wallX === undefined || Math.abs(d.x) < 1e-9) return null;
      const t = (opts.wallX - o.x) / d.x;
      return t >= 0 && t <= max ? t : null;
    },
  });
  let seq = 0;
  const input = (buttons: number, yaw = Math.PI / 2, pitch = 0): PlayerInput => ({ seq: ++seq, moveX: 0, moveZ: 0, buttons, aimYaw: yaw, aimPitch: pitch });
  /** Simula `ticks` ticks del atacante con estos botones; los demás solo avanzan tiempos. */
  const run = (id: string, ticks: number, buttons: number, yaw?: number, pitch?: number) => {
    const events: CombatEvent[] = [];
    for (let i = 0; i < ticks; i++) {
      combat.step(id, input(buttons, yaw, pitch), ctxOf(id, i));
      for (const other of poses.keys()) if (other !== id) combat.idle(other, DT);
      events.push(...combat.drain());
    }
    match.drain();
    return events;
  };
  return { match, combat, poses, add, give, select, run };
}

const shots = (ev: CombatEvent[]) => ev.filter((e) => e.type === 'shot').length;
const damage = (ev: CombatEvent[]) => ev.filter((e): e is Extract<CombatEvent, { type: 'damage' }> => e.type === 'damage');

describe('geometría de disparo', () => {
  it('el rayo toca la cápsula de impacto y no lo que está por encima', () => {
    const o = { x: 0, y: 1, z: 0 };
    expect(rayHitbox(o, { x: 1, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 100)).toBeCloseTo(10 - 0.42, 5);
    expect(rayHitbox({ x: 0, y: 3, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 100)).toBeNull();
    expect(rayHitbox(o, { x: 1, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 5)).toBeNull(); // fuera de alcance
    expect(rayHitbox(o, { x: 0, y: 0, z: 1 }, { x: 10, y: 0, z: 0 }, 100)).toBeNull();
  });

  it('la dispersión queda dentro del cono y es determinista', () => {
    const d = directionFromAim(0.3, 0.1);
    const a = createRng(5);
    const b = createRng(5);
    for (let i = 0; i < 200; i++) {
      const p = applySpread(d, 0.05, a);
      const q = applySpread(d, 0.05, b);
      expect(p).toEqual(q);
      expect(Math.acos(Math.min(1, p.x * d.x + p.y * d.y + p.z * d.z))).toBeLessThanOrEqual(0.05 + 1e-9);
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1, 9);
    }
  });

  it('el estado visible cabe en 10 bits y vuelve igual', () => {
    const g = { held: 'shotgun', rarity: 'epic', action: 'reload', dead: true } as const;
    expect(packGear(g)).toBeLessThan(1 << 10);
    expect(unpackGear(packGear(g))).toEqual(g);
    expect(unpackGear(-3)).toEqual({ held: null, rarity: 'common', action: 'none', dead: false });
  });
});

describe('armas, cadencia y munición (autoridad)', () => {
  it('la pistola dispara a 3/s aunque se mantenga pulsado', () => {
    const w = setup();
    w.add('a', { x: 0, y: 0, z: 0 });
    w.give('a', { kind: 'pistol', qty: 1, rarity: 'common' }, { kind: 'ammo_light', qty: 60 });
    w.select('a', 1);
    w.run('a', Math.ceil(EQUIP_SECONDS / DT), 0);
    const ev = w.run('a', 90, Buttons.FIRE); // 3 s
    expect(shots(ev)).toBeGreaterThanOrEqual(9);
    expect(shots(ev)).toBeLessThanOrEqual(10);
  });

  it('el subfusil a 8/s: no se pueden acumular disparos esperando', () => {
    const w = setup();
    w.add('a', { x: 0, y: 0, z: 0 });
    w.give('a', { kind: 'smg', qty: 1 }, { kind: 'ammo_light', qty: 200 });
    w.select('a', 1);
    w.run('a', 60, 0); // 2 s sin disparar
    const ev = w.run('a', 30, Buttons.FIRE); // 1 s
    expect(shots(ev)).toBeLessThanOrEqual(9);
    expect(shots(ev)).toBeGreaterThanOrEqual(8);
  });

  it('sin munición infinita: dispara el cargador, recarga sola desde la bolsa y se detiene al agotarla', () => {
    const w = setup();
    w.add('a', { x: 0, y: 0, z: 0 });
    w.give('a', { kind: 'pistol', qty: 1 }, { kind: 'ammo_light', qty: 5 });
    w.select('a', 1);
    const ev = w.run('a', 30 * 20, Buttons.FIRE);
    expect(shots(ev)).toBe(WEAPON_STATS.pistol.magazine + 5);
    const inv = w.match.inventory('a')!;
    expect(magOf(inv.slots[1]!)).toBe(0);
    expect(inv.ammo.ammo_light).toBe(0);
    expect(ev.filter((e) => e.type === 'empty').length).toBeLessThanOrEqual(1); // un clic al pulsar, no cada tick
  });

  it('recargar tarda lo que dice la tabla y mueve balas de la bolsa al cargador', () => {
    const w = setup();
    w.add('a', { x: 0, y: 0, z: 0 });
    w.give('a', { kind: 'rifle', qty: 1, rarity: 'epic', mag: 3 }, { kind: 'ammo_medium', qty: 40 });
    w.select('a', 1);
    w.run('a', 1, Buttons.RELOAD);
    const ticks = Math.ceil(reloadSeconds('rifle', 'epic') / DT);
    w.run('a', ticks - 3, 0);
    expect(magOf(w.match.inventory('a')!.slots[1]!)).toBe(3);
    w.run('a', 4, 0);
    const inv = w.match.inventory('a')!;
    expect(magOf(inv.slots[1]!)).toBe(30);
    expect(inv.ammo.ammo_medium).toBe(40 - 27);
  });

  it('cambiar de arma cancela la recarga y exige desenfundar', () => {
    const w = setup();
    w.add('a', { x: 0, y: 0, z: 0 });
    w.give('a', { kind: 'pistol', qty: 1, mag: 0 }, { kind: 'smg', qty: 1 }, { kind: 'ammo_light', qty: 50 });
    w.select('a', 1);
    w.run('a', 2, Buttons.RELOAD);
    expect(w.combat.vitals('a')!.reload).toBeGreaterThan(0);
    w.select('a', 2);
    expect(shots(w.run('a', Math.floor(EQUIP_SECONDS / DT) - 1, Buttons.FIRE))).toBe(0);
    expect(w.combat.vitals('a')!.reload).toBe(0);
    expect(shots(w.run('a', 3, Buttons.FIRE))).toBe(1);
    expect(magOf(w.match.inventory('a')!.slots[1]!)).toBe(0); // la recarga cancelada no dio balas
  });
});

describe('daño, salud y muertes', () => {
  it('ningún disparo elimina con salud completa, en ninguna rareza ni distancia', () => {
    for (const kind of ['pistol', 'smg', 'rifle', 'shotgun'] as const)
      for (const rarity of ['common', 'rare', 'epic'] as const)
        for (const dist of [0.6, 1, 2, 4]) {
          const w = setup();
          w.add('a', { x: 0, y: 0, z: 0 });
          w.add('b', { x: dist, y: 0, z: 0 });
          w.give('a', { kind, qty: 1, rarity }, { kind: WEAPON_STATS[kind] && (kind === 'shotgun' ? 'ammo_shells' : kind === 'rifle' ? 'ammo_medium' : 'ammo_light'), qty: 10 });
          w.select('a', 1);
          w.run('a', 10, 0);
          const ev = w.run('a', 1, Buttons.FIRE | Buttons.AIM);
          const hits = damage(ev);
          expect(hits.length).toBe(1);
          expect(hits[0]!.amount).toBeLessThanOrEqual(HEALTH.maxShotDamage);
          expect(w.combat.hp('b')).toBeGreaterThan(0);
        }
  });

  it('la escopeta épica a quemarropa hace como máximo 65', () => {
    const w = setup();
    w.add('a', { x: 0, y: 0, z: 0 });
    w.add('b', { x: 1, y: 0, z: 0 });
    w.give('a', { kind: 'shotgun', qty: 1, rarity: 'epic' }, { kind: 'ammo_shells', qty: 5 });
    w.select('a', 1);
    w.run('a', 10, 0);
    const hit = damage(w.run('a', 1, Buttons.FIRE | Buttons.AIM))[0]!;
    expect(hit.amount).toBe(65);
    expect(hit.hp).toBe(35);
  });

  it('la pared detiene las balas (no se dispara a través de paredes)', () => {
    const w = setup({ wallX: 5 });
    w.add('a', { x: 0, y: 0, z: 0 });
    w.add('b', { x: 10, y: 0, z: 0 });
    w.give('a', { kind: 'rifle', qty: 1 }, { kind: 'ammo_medium', qty: 30 });
    w.select('a', 1);
    w.run('a', 10, 0);
    const ev = w.run('a', 60, Buttons.FIRE | Buttons.AIM);
    expect(shots(ev)).toBeGreaterThan(5);
    expect(damage(ev)).toHaveLength(0);
    const shot = ev.find((e) => e.type === 'shot') as Extract<CombatEvent, { type: 'shot' }>;
    expect(shot.ends[0]!.x).toBeLessThanOrEqual(5.01);
  });

  it('elimina, registra la baja, emite el evento de muerte y vuelve (provisional) a los 3 s', () => {
    const w = setup();
    const deaths: unknown[] = [];
    const respawns: string[] = [];
    w.combat.onDeath = (e) => deaths.push(e);
    w.combat.onRespawn = (id) => respawns.push(id);
    w.add('a', { x: 0, y: 0, z: 0 });
    w.add('b', { x: 6, y: 0, z: 0 });
    w.give('a', { kind: 'rifle', qty: 1 }, { kind: 'ammo_medium', qty: 30 });
    w.select('a', 1);
    w.run('a', 10, 0);
    const ev = w.run('a', 45, Buttons.FIRE | Buttons.AIM);
    const death = ev.find((e) => e.type === 'death');
    expect(death).toMatchObject({ type: 'death', victim: 'b', killer: 'a', weapon: 'rifle' });
    expect(deaths).toHaveLength(1);
    expect(damage(ev).length).toBe(5); // 24 × 5 = 120: cinco impactos
    expect(w.combat.isDead('b')).toBe(true);
    expect(w.combat.log.of('a')).toMatchObject({ kills: 1 });
    expect(w.combat.log.of('b')).toMatchObject({ deaths: 1, damageTaken: 100 + 20 });
    expect(w.combat.log.deaths()).toHaveLength(1);
    // Un eliminado no recibe más daño.
    expect(damage(w.run('a', 10, Buttons.FIRE | Buttons.AIM))).toHaveLength(0);
    w.run('a', Math.ceil(DEATH.respawnSeconds / DT), 0);
    expect(w.combat.isDead('b')).toBe(false);
    expect(w.combat.hp('b')).toBe(HEALTH.max);
    expect(respawns).toEqual(['b']);
  });

  it('el hacha golpea a 15 cerca y de frente, nunca por la espalda ni lejos', () => {
    const w = setup();
    w.add('a', { x: 0, y: 0, z: 0 });
    w.add('front', { x: 1.5, y: 0, z: 0 });
    w.add('back', { x: -1.2, y: 0, z: 0 });
    w.add('far', { x: 0, y: 0, z: 4 });
    const ev = w.run('a', 30, Buttons.FIRE); // yaw = +X
    const hits = damage(ev);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.length).toBeLessThanOrEqual(2); // 1,5 golpes/s
    expect(hits.every((h) => h.victim === 'front' && h.amount === MELEE.damage && h.weapon === 'axe')).toBe(true);
  });
});

describe('botiquín', () => {
  it('cura hasta 50 tras 5 s, sin pasar de 100, y gasta uno', () => {
    const w = setup();
    w.add('a', { x: 0, y: 0, z: 0 });
    w.give('a', { kind: 'medkit', qty: 2 });
    w.select('a', 1);
    w.combat.setHp('a', 70);
    w.run('a', 1, Buttons.FIRE);
    w.run('a', Math.ceil(HEAL.seconds / DT) - 3, 0);
    expect(w.combat.hp('a')).toBe(70);
    const ev = w.run('a', 4, 0);
    expect(w.combat.hp('a')).toBe(100);
    expect(ev.find((e) => e.type === 'healed')).toMatchObject({ amount: 30 });
    expect(w.match.inventory('a')!.slots[1]).toMatchObject({ kind: 'medkit', qty: 1 });
  });

  it('recibir daño cancela la curación', () => {
    const w = setup();
    w.add('a', { x: 0, y: 0, z: 0 });
    w.add('b', { x: 5, y: 0, z: 0 });
    w.give('a', { kind: 'medkit', qty: 1 });
    w.give('b', { kind: 'pistol', qty: 1 }, { kind: 'ammo_light', qty: 10 });
    w.select('a', 1);
    w.select('b', 1);
    w.combat.setHp('a', 40);
    w.run('a', 30, Buttons.FIRE);
    expect(w.combat.vitals('a')!.heal).toBeGreaterThan(0);
    w.run('b', 12, 0);
    w.run('b', 1, Buttons.FIRE | Buttons.AIM, -Math.PI / 2);
    expect(w.combat.vitals('a')!.heal).toBe(0);
    w.run('a', 30 * 6, 0);
    expect(w.combat.hp('a')).toBe(20);
    expect(w.match.inventory('a')!.slots[1]).toMatchObject({ kind: 'medkit', qty: 1 });
  });

  it('atacar (cambiar al arma y disparar) cancela la curación y no se cura con la salud llena', () => {
    const w = setup();
    w.add('a', { x: 0, y: 0, z: 0 });
    w.give('a', { kind: 'medkit', qty: 1 });
    w.select('a', 1);
    w.run('a', 1, Buttons.FIRE);
    expect(w.combat.vitals('a')!.heal).toBe(0); // 100 de salud: no empieza
    w.combat.setHp('a', 50);
    w.run('a', 2, 0);
    w.run('a', 1, Buttons.FIRE);
    expect(w.combat.vitals('a')!.heal).toBeGreaterThan(0);
    w.select('a', 0); // hacha
    w.run('a', 20, Buttons.FIRE);
    expect(w.combat.vitals('a')!.heal).toBe(0);
    expect(w.combat.hp('a')).toBe(50);
  });
});

describe('compensación de latencia', () => {
  it('rebobina hasta el tick visto, con límite', () => {
    const h = new PoseHistory();
    for (let t = 0; t <= 30; t++) h.record(t, 'b', { x: t, y: 0, z: 0 });
    expect(PoseHistory.clampTick(30, 25)).toBe(25);
    expect(PoseHistory.clampTick(30, 2)).toBe(30 - LAG_COMPENSATION.maxRewindTicks);
    expect(PoseHistory.clampTick(30, 99)).toBe(30);
    expect(PoseHistory.clampTick(30, undefined)).toBe(30);
    expect([...h.at(30, 25, ['b'])][0]!.feet.x).toBe(25);
    expect([...h.at(30, 0, ['b'])][0]!.feet.x).toBe(30 - LAG_COMPENSATION.maxRewindTicks);
  });

  it('inventario: recargar sin bolsa no hace nada; el cargador está acotado', () => {
    const inv = addItem(createInventory(), { kind: 'smg', qty: 1, mag: 2 }).inventory;
    expect(reloadWeapon(inv, 1)).toBeNull();
    expect(magOf(withMag(inv, 1, 999).slots[1]!)).toBe(30);
    expect(magOf(withMag(inv, 1, -5).slots[1]!)).toBe(0);
  });
});
