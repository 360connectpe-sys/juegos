import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addItem, AXE_SLOT, canTake, createInventory, droppableItems, INVENTORY_SLOTS, isValidInventory, selectSlot } from '@shared/inventory';
import { ITEM_KINDS, ITEMS, itemName } from '@shared/items';
import { rollChestLoot } from '@shared/match/loot';
import { findTarget, MatchState } from '@shared/match/MatchState';
import { Buttons, emptyInput } from '@shared/types';
import { generateWorldLayout, MAP } from '@shared/world/layout';
import { insideState } from '@shared/world/prefab';
import { SMALL_HOUSE_PALETTES } from '@shared/world/structures';
import { terrainHeight, villageHeight } from '@shared/world/terrain';
import { ServerWorld } from '../server/ServerWorld';

describe('mapa ampliado', () => {
  const layout = generateWorldLayout();
  it('conserva el pueblo y añade 8-12 casas pequeñas variadas en las cuatro zonas', () => {
    expect(layout.structures.slice(0, 4).map((s) => s.def.id)).toEqual(['house', 'tower', 'crates', 'crates']);
    for (const seed of [1337, 1, 7, 42, 555]) {
      const l = generateWorldLayout({ seed });
      expect(l.houses.length).toBeGreaterThanOrEqual(MAP.minHouses);
      expect(l.houses.length).toBeLessThanOrEqual(MAP.maxHouses);
      const quadrants = new Set(l.houses.map((h) => `${h.x > 0}${h.z > 0}`));
      expect(quadrants.size).toBe(4);
      expect(new Set(l.houses.map((h) => h.def.id)).size).toBeGreaterThanOrEqual(3);
    }
    expect(SMALL_HOUSE_PALETTES.length).toBeGreaterThanOrEqual(4);
  });
  it('cada casa se asienta plana en su colina, lejos de las demás y con la puerta hacia el pueblo', () => {
    for (const h of layout.houses) {
      for (const [dx, dz] of [[0, 0], [1.5, 1], [-1.5, -1]] as const) expect(terrainHeight(h.x + dx, h.z + dz, layout.terrain)).toBeCloseTo(h.y, 5);
      expect(Math.hypot(h.x, h.z)).toBeGreaterThan(20);
      // La puerta (+Z local) mira hacia el centro.
      const door = { x: Math.sin(h.rotationY), z: Math.cos(h.rotationY) };
      expect(door.x * -h.x + door.z * -h.z).toBeGreaterThan(0);
    }
    // El pueblo no cambia.
    expect(terrainHeight(3, 2, layout.terrain)).toBeCloseTo(villageHeight(3, 2, layout.terrain), 9);
  });
  it('cofres deterministas: dentro de cada casa, en la casa grande, el mirador y fuera', () => {
    expect(generateWorldLayout().chests).toEqual(layout.chests);
    const by = (w: string) => layout.chests.filter((c) => c.where === w).length;
    expect(by('small-house')).toBe(layout.houses.length);
    expect(by('house') + by('loft') + by('tower')).toBe(3);
    expect(by('outside')).toBe(MAP.outsideChests);
    layout.chests.forEach((c, i) => expect(c.id).toBe(i));
    for (const c of layout.chests.filter((c) => c.where === 'small-house')) {
      const house = layout.houses.find((h) => insideState(h, c.x, c.y + 0.1, c.z) !== 'outside');
      expect(house).toBeDefined();
    }
  });
  it('hay árboles de sobra y ninguno pisa casas ni cofres', () => {
    expect(layout.trees.length).toBe(140);
    for (const t of layout.trees) for (const s of layout.structures) expect(Math.hypot(t.x - s.x, t.z - s.z)).toBeGreaterThan(s.def.clearRadius);
  });
});

describe('objetos e inventario', () => {
  it('sin escudos; armas, munición, botiquines y el hacha', () => {
    expect(ITEM_KINDS.some((k) => k.includes('shield') || k.includes('escudo'))).toBe(false);
    expect(new Set(ITEM_KINDS.map((k) => ITEMS[k].category))).toEqual(new Set(['tool', 'weapon', 'ammo', 'heal', 'attachment'])); // fase 14: mira x2
    expect(itemName({ kind: 'shotgun', qty: 1, rarity: 'epic' })).toBe('Escopeta épica');
  });
  it('5 huecos con el hacha permanente en el primero', () => {
    const inv = createInventory();
    expect(inv.slots).toHaveLength(INVENTORY_SLOTS);
    expect(inv.slots[AXE_SLOT]).toEqual({ kind: 'axe', qty: 1 });
    expect(inv.slots.slice(1).every((s) => s === null)).toBe(true);
    expect(droppableItems(inv)).toEqual([]);
    expect(isValidInventory(inv)).toBe(true);
    expect(isValidInventory({ ...inv, slots: [null, null, null, null, null] })).toBe(false);
  });
  it('apila botiquines, limita munición, llena huecos y al llenarse intercambia (nunca el hacha)', () => {
    let inv = createInventory();
    inv = addItem(inv, { kind: 'medkit', qty: 2 }).inventory;
    inv = addItem(inv, { kind: 'medkit', qty: 2 }).inventory;
    expect(inv.slots[1]).toEqual({ kind: 'medkit', qty: 3 });
    expect(inv.slots[2]).toEqual({ kind: 'medkit', qty: 1 });
    const a = addItem(inv, { kind: 'ammo_shells', qty: 50 });
    expect(a.inventory.ammo.ammo_shells).toBe(30);
    expect(a.leftover).toEqual({ kind: 'ammo_shells', qty: 20 });
    inv = addItem(a.inventory, { kind: 'rifle', qty: 1, rarity: 'rare' }).inventory;
    inv = addItem(inv, { kind: 'pistol', qty: 1, rarity: 'common' }).inventory;
    expect(canTake(inv, { kind: 'smg', qty: 1 })).toBe(false);
    // Con el hacha en la mano no se intercambia.
    const refused = addItem(inv, { kind: 'smg', qty: 1, rarity: 'epic' });
    expect(refused.taken).toBe(0);
    // Con el rifle en la mano, se cambia por el subfusil y el rifle cae.
    const swapped = addItem(selectSlot(inv, 3), { kind: 'smg', qty: 1, rarity: 'epic' });
    expect(swapped.inventory.slots[3]).toEqual({ kind: 'smg', qty: 1, rarity: 'epic' });
    expect(swapped.dropped).toEqual({ kind: 'rifle', qty: 1, rarity: 'rare' });
    expect(selectSlot(inv, 9)).toBe(inv);
    expect(selectSlot(inv, 1.5)).toBe(inv);
  });
});

describe('botín', () => {
  it('determinista por (partida, cofre), distinto entre partidas, siempre un arma y su munición', () => {
    expect(rollChestLoot(123, 4)).toEqual(rollChestLoot(123, 4));
    const games = new Set(Array.from({ length: 20 }, (_, s) => JSON.stringify(rollChestLoot(s, 4))));
    expect(games.size).toBeGreaterThan(10);
    for (let s = 0; s < 200; s++) {
      const loot = rollChestLoot(s, s % 17);
      const weapon = loot[0]!;
      expect(ITEMS[weapon.kind].category).toBe('weapon');
      expect(loot[1]!.kind).toBe(ITEMS[weapon.kind].ammo);
      for (const it of loot) expect(['weapon', 'ammo', 'heal', 'attachment']).toContain(ITEMS[it.kind].category);
    }
  });
});

describe('reglas de cofres (MatchState)', () => {
  const layout = generateWorldLayout();
  const chest = layout.chests.find((c) => c.where === 'outside')!;
  const near = { x: chest.x + Math.sin(chest.yaw) * 1.4, y: chest.y, z: chest.z + Math.cos(chest.yaw) * 1.4 };
  it('se abre una vez, suelta el botín y no se puede abrir de lejos', () => {
    const m = new MatchState(layout.chests, 99);
    m.addPlayer('a');
    m.addPlayer('b');
    m.drain();
    expect(m.interact('a', { x: chest.x + 5, y: chest.y, z: chest.z })).toBeNull();
    expect(m.interact('a', near)?.type).toBe('chest');
    expect(m.opened[chest.id]).toBe(true);
    const ev = m.drain();
    expect(ev.filter((e) => e.type === 'chestOpened')).toHaveLength(1);
    expect(m.pickups.size).toBe(rollChestLoot(99, chest.id).length);
    // El segundo jugador ya no ve el cofre como objetivo: recoge lo que salió.
    expect(findTarget(layout.chests, m.opened, m.pickups.values(), near)?.type).toBe('pickup');
  });
  it('recoger no duplica: lo que hay en el mundo se conserva', () => {
    const m = new MatchState(layout.chests, 5);
    for (const id of ['a', 'b', 'c']) m.addPlayer(id);
    m.interact('a', near);
    const total = m.totals();
    for (let i = 0; i < 12; i++) for (const id of ['a', 'b', 'c']) m.interact(id, near);
    expect(m.totals()).toEqual(total);
    expect(m.pickups.size).toBeLessThan(rollChestLoot(5, chest.id).length);
    // Al salir, lo suyo cae al suelo (sin perder ni duplicar).
    m.removePlayer('a', near);
    expect(m.totals()).toEqual(total);
  });
  it('la línea de visión bloquea interacciones a través de paredes', () => {
    const m = new MatchState(layout.chests, 1);
    m.addPlayer('a');
    expect(m.interact('a', near, () => false)).toBeNull();
    expect(m.opened[chest.id]).toBe(false);
  });
});

describe('servidor autoritativo: cofres con 6 jugadores', () => {
  let world: ServerWorld;
  beforeEach(async () => {
    world = await ServerWorld.create(undefined, 2024);
  });
  afterEach(() => world.dispose());

  it('6 jugadores pulsan Abrir en el mismo tick: uno lo abre y nadie duplica nada', () => {
    const chest = world.layout.chests.find((c) => c.where === 'outside')!;
    const ids = Array.from({ length: 6 }, (_, i) => `p${i}`);
    ids.forEach((id, i) => {
      const p = world.addPlayer(id, id);
      const a = (i / 6) * Math.PI * 2;
      p.body.teleport({ x: chest.x + Math.cos(a) * 1.3, y: chest.y + 0.05, z: chest.z + Math.sin(a) * 1.3 });
    });
    for (let t = 0; t < 10; t++) world.step(); // se posan en el suelo
    world.drainMatchEvents();
    ids.forEach((id, i) => world.queueInput(id, { ...emptyInput(1), buttons: Buttons.INTERACT, aimYaw: i }));
    world.step();
    const events = world.drainMatchEvents();
    expect(events.filter((e) => e.type === 'chestOpened')).toHaveLength(1);
    // Mantener pulsado no repite la interacción (flanco).
    ids.forEach((id) => world.queueInput(id, { ...emptyInput(2), buttons: Buttons.INTERACT }));
    world.step();
    expect(world.drainMatchEvents().filter((e) => e.type === 'pickupRemoved')).toHaveLength(0);
    // Todos sueltan y vuelven a pulsar: recogen sin duplicar.
    const total = world.match.totals();
    for (let s = 3; s < 20; s++) {
      ids.forEach((id) => world.queueInput(id, { ...emptyInput(s), buttons: s % 2 ? Buttons.INTERACT : 0 }));
      world.step();
    }
    expect(world.match.totals()).toEqual(total);
    const inInventories = ids.reduce((n, id) => n + world.match.inventory(id)!.slots.filter((x) => x && x.kind !== 'axe').length, 0);
    expect(inInventories).toBeGreaterThan(0);
  });

  it('no se abre a través de la pared de una casa (rayo de Rapier)', () => {
    const c = world.layout.chests.find((ch) => ch.where === 'small-house')!;
    const house = world.layout.houses.find((h) => insideState(h, c.x, c.y + 0.1, c.z) !== 'outside')!;
    // Fuera de la casa, pegado a la pared más cercana al cofre (dentro del alcance de 2 m).
    const dirX = c.x - house.x;
    const dirZ = c.z - house.z;
    const len = Math.hypot(dirX, dirZ);
    const p = world.addPlayer('x', 'x');
    let outside = { x: c.x, y: c.y + 0.05, z: c.z };
    for (let d = 0.5; d < 2; d += 0.1) {
      const q = { x: c.x + (dirX / len) * d, y: c.y + 0.05, z: c.z + (dirZ / len) * d };
      if (insideState(house, q.x, q.y + 0.1, q.z) === 'outside') {
        outside = { ...q, x: q.x + (dirX / len) * 0.4, z: q.z + (dirZ / len) * 0.4 };
        break;
      }
    }
    p.body.teleport(outside);
    for (let t = 0; t < 5; t++) world.step();
    world.queueInput('x', { ...emptyInput(1), buttons: Buttons.INTERACT });
    world.step();
    expect(world.match.opened[c.id]).toBe(false);
  });

  it('todos empiezan con el hacha; elegir hueco se valida', () => {
    world.addPlayer('a', 'a');
    expect(world.match.inventory('a')!.slots[0]!.kind).toBe('axe');
    expect(world.selectSlot('a', 2)).toBe(true);
    expect(world.selectSlot('a', 7)).toBe(false);
    expect(world.selectSlot('a', '1')).toBe(false);
    expect(world.match.inventory('a')!.selected).toBe(2);
  });
});
