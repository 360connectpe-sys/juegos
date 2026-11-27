import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ServerWorld, type ServerPlayer } from '../server/ServerWorld';
import { unpackGear } from '@shared/combat/gear';
import { EQUIP_SECONDS, LAG_COMPENSATION, WEAPON_STATS } from '@shared/combat/weapons';
import type { CombatEvent } from '@shared/combat/CombatState';
import { addItem } from '@shared/inventory';
import { quatFromEuler } from '@shared/math';
import { unpackPlayers } from '@shared/netcodec';
import { NET } from '@shared/protocol';
import { Buttons, emptyInput, type PlayerInput, type Vec3 } from '@shared/types';

let world: ServerWorld;
beforeEach(async () => {
  world = await ServerWorld.create(undefined, 99);
});
afterEach(() => world.dispose());

/** Lejos del pueblo y en el aire (sin árboles ni casas en medio), a 1 m del suelo de una caja. */
const SKY = 30;
function place(p: ServerPlayer, x: number, z: number) {
  p.body.teleport({ x, y: SKY, z });
  // Plataforma bajo los pies para que esté en el suelo.
  world.physics.addStatic({ kind: 'box', center: { x, y: SKY - 0.25, z }, halfExtents: { x: 1.2, y: 0.25, z: 1.2 }, rotation: quatFromEuler(0, 0, 0), layer: 'structure' });
}

function arm(p: ServerPlayer, kind: 'rifle' | 'smg' | 'pistol' | 'shotgun', ammo: number) {
  const bag = kind === 'rifle' ? 'ammo_medium' : kind === 'shotgun' ? 'ammo_shells' : 'ammo_light';
  let inv = world.match.inventory(p.id)!;
  inv = addItem(inv, { kind, qty: 1, rarity: 'common' }).inventory;
  inv = addItem(inv, { kind: bag, qty: ammo }).inventory;
  world.match.setInventory(p.id, inv);
  world.selectSlot(p.id, 1);
}

const seqs = new Map<string, number>();
const input = (p: ServerPlayer, buttons: number, yaw: number, extra: Partial<PlayerInput> = {}): PlayerInput => {
  const seq = (seqs.get(p.id) ?? 0) + 1;
  seqs.set(p.id, seq);
  return { ...emptyInput(seq), buttons, aimYaw: yaw, aimPitch: 0, ...extra };
};

/** Avanza `ticks` ticks con una entrada por tick para cada jugador indicado. */
function run(ticks: number, plan: Map<ServerPlayer, () => PlayerInput>): CombatEvent[] {
  const out: CombatEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    for (const [p, make] of plan) world.queueInput(p.id, make());
    world.step();
    out.push(...world.drainCombatEvents());
    world.drainMatchEvents();
  }
  return out;
}

const dmg = (ev: CombatEvent[]) => ev.filter((e) => e.type === 'damage');
const EAST = Math.PI / 2; // +X

describe('combate autoritativo en ServerWorld (Rapier real)', () => {
  it('impacta, daña y lo publica en el snapshot (arma en mano y disparo)', () => {
    const a = world.addPlayer('a', 'Ana');
    const b = world.addPlayer('b', 'Beto');
    place(a, 0, 50);
    place(b, 6, 50);
    arm(a, 'rifle', 30);
    run(Math.ceil(EQUIP_SECONDS * 30) + 2, new Map([[a, () => input(a, 0, EAST)], [b, () => input(b, 0, -EAST)]]));
    const ev = run(3, new Map([[a, () => input(a, Buttons.FIRE | Buttons.AIM, EAST)], [b, () => input(b, 0, -EAST)]]));
    expect(dmg(ev).length).toBeGreaterThanOrEqual(1);
    expect(world.combat.hp('b')).toBeLessThan(100);
    const snap = unpackPlayers(world.snapshot().p).find((p) => p.netId === a.netId)!;
    expect(unpackGear(snap.gear).held).toBe('rifle');
  });

  it('una pared real de Rapier bloquea los disparos', () => {
    const a = world.addPlayer('a', 'Ana');
    const b = world.addPlayer('b', 'Beto');
    place(a, 0, 50);
    place(b, 6, 50);
    world.physics.addStatic({ kind: 'box', center: { x: 3, y: SKY + 1.5, z: 50 }, halfExtents: { x: 0.1, y: 2, z: 2 }, rotation: quatFromEuler(0, 0, 0), layer: 'structure' });
    arm(a, 'smg', 120);
    const ev = run(60, new Map([[a, () => input(a, Buttons.FIRE | Buttons.AIM, EAST)], [b, () => input(b, 0, -EAST)]]));
    expect(ev.filter((e) => e.type === 'shot').length).toBeGreaterThan(5);
    expect(dmg(ev)).toHaveLength(0);
    expect(world.combat.hp('b')).toBe(100);
  });

  it('compensa la latencia dentro del límite y no más allá', () => {
    const a = world.addPlayer('a', 'Ana');
    const b = world.addPlayer('b', 'Beto');
    place(a, 0, 50);
    place(b, 8, 50);
    arm(a, 'rifle', 60);
    run(12, new Map([[a, () => input(a, 0, EAST)], [b, () => input(b, 0, 0)]]));
    const seen = world.tick; // a ve a b aquí
    // b se aparta 3 m al norte (fuera de la línea de tiro actual).
    place(b, 8, 53);
    for (let i = 0; i < 2; i++) run(1, new Map([[b, () => input(b, 0, 0)]]));
    // Disparo a donde estaba hace 2 ticks: acierta.
    let ev = run(1, new Map([[a, () => input(a, Buttons.FIRE | Buttons.AIM, EAST, { viewTick: seen })]]));
    expect(dmg(ev)).toHaveLength(1);
    // Pasado el límite de rebobinado, el mismo tiro "al pasado" falla.
    run(LAG_COMPENSATION.maxRewindTicks + 6, new Map([[b, () => input(b, 0, 0)]]));
    ev = run(12, new Map([[a, () => input(a, Buttons.FIRE | Buttons.AIM, EAST, { viewTick: seen })]]));
    expect(ev.filter((e) => e.type === 'shot').length).toBeGreaterThan(0);
    expect(dmg(ev)).toHaveLength(0);
  });

  it('ráfagas de entradas no aceleran la cadencia; el daño enviado por el cliente se ignora', () => {
    const a = world.addPlayer('a', 'Ana');
    const b = world.addPlayer('b', 'Beto');
    place(a, 0, 50);
    place(b, 5, 50);
    arm(a, 'pistol', 200);
    run(15, new Map([[a, () => input(a, 0, EAST)]]));
    let shots = 0;
    let damage = 0;
    const ticks = 90; // 3 s
    for (let i = 0; i < ticks; i++) {
      // Un tramposo intenta meter 12 entradas por tick con un campo de daño.
      for (let k = 0; k < NET.maxQueuedInputs; k++) world.queueInput(a.id, { ...input(a, Buttons.FIRE | Buttons.AIM, EAST), damage: 999 } as PlayerInput);
      world.step();
      for (const e of world.drainCombatEvents()) {
        if (e.type === 'shot') shots++;
        if (e.type === 'damage') {
          damage += e.amount;
          expect(e.amount).toBeLessThanOrEqual(WEAPON_STATS.pistol.damage);
        }
      }
    }
    expect(shots).toBeLessThanOrEqual(Math.ceil(3 * WEAPON_STATS.pistol.fireRate) + 1);
    expect(damage).toBeGreaterThan(0);
  });

  it('un eliminado no se mueve ni dispara y vuelve con 100 de salud', () => {
    const a = world.addPlayer('a', 'Ana');
    const b = world.addPlayer('b', 'Beto');
    place(a, 0, 50);
    place(b, 5, 50);
    arm(b, 'pistol', 50);
    world.combat.setHp('a', 5);
    arm(a, 'rifle', 30);
    run(12, new Map([[a, () => input(a, 0, EAST)], [b, () => input(b, 0, -EAST)]]));
    run(3, new Map([[b, () => input(b, Buttons.FIRE | Buttons.AIM, -EAST)], [a, () => input(a, 0, EAST)]]));
    expect(world.combat.isDead('a')).toBe(true);
    const before: Vec3 = { ...a.body.state.position };
    const ev = run(30, new Map([[a, () => ({ ...input(a, Buttons.FIRE, EAST), moveX: 1 })]]));
    expect(ev.filter((e) => e.type === 'shot' && e.by === 'a')).toHaveLength(0);
    expect(Math.abs(a.body.state.position.x - before.x)).toBeLessThan(0.05);
    expect(unpackGear(unpackPlayers(world.snapshot().p).find((p) => p.netId === a.netId)!.gear).dead).toBe(true);
    run(70, new Map([[a, () => input(a, 0, EAST)]]));
    expect(world.combat.isDead('a')).toBe(false);
    expect(world.combat.hp('a')).toBe(100);
  });
});
