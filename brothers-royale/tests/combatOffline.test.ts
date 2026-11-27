import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OfflineSession } from '@/net/OfflineSession';
import type { ClientCombatEvent } from '@/net/CombatView';
import { loadRapier, PhysicsWorld } from '@/physics/PhysicsWorld';
import { SIMULATION } from '@shared/constants';
import { unpackGear } from '@shared/combat/gear';
import { DEATH, EYE_HEIGHT } from '@shared/combat/weapons';
import { addItem } from '@shared/inventory';
import { Buttons, emptyInput, type PlayerInput } from '@shared/types';
import { worldColliders } from '@shared/world/colliders';
import { generateWorldLayout } from '@shared/world/layout';
import { terrainHeight } from '@shared/world/terrain';

const layout = generateWorldLayout();
let physics: PhysicsWorld;
beforeEach(async () => {
  physics = new PhysicsWorld(await loadRapier());
  physics.addTerrain(layout.terrain);
  worldColliders(layout).forEach((c) => physics.addStatic(c));
});
afterEach(() => physics.dispose());

const at = (x: number, z: number) => ({ x, y: terrainHeight(x, z, layout.terrain), z });

describe('sin conexión: mismas reglas de combate y muñecos de práctica', () => {
  it('los muñecos aparecen como jugadores, reciben daño, caen y vuelven', () => {
    const spawn = { ...at(layout.spawn.x, layout.spawn.z), y: at(layout.spawn.x, layout.spawn.z).y + 0.1 };
    const dummy = at(layout.spawn.x + 7, layout.spawn.z + 4);
    const s = new OfflineSession(physics, spawn, 'Jugador', layout.chests, 11, [dummy]);
    const events: ClientCombatEvent[] = [];
    s.onCombatEvent = (e) => events.push(e);
    expect(s.players()).toHaveLength(2);
    expect(s.identity('dummy-1').name).toBe('Muñeco 1');
    let inv = s.state.inventory('local')!;
    inv = addItem(inv, { kind: 'shotgun', qty: 1, rarity: 'epic' }).inventory;
    inv = addItem(inv, { kind: 'ammo_shells', qty: 20 }).inventory;
    s.state.setInventory('local', inv);
    s.selectSlot(1);
    let seq = 0;
    const aim = (buttons: number): PlayerInput => {
      const me = s.localPlayer().position;
      const dx = dummy.x - me.x;
      const dz = dummy.z - me.z;
      // Se acerca al muñeco mientras dispara (la escopeta es de corta distancia).
      const len = Math.hypot(dx, dz);
      const walk = len > 2.5 ? 1 : 0;
      return { ...emptyInput(++seq), moveX: (dx / len) * walk, moveZ: (dz / len) * walk, buttons, aimYaw: Math.atan2(dx, dz), aimPitch: Math.atan2(dummy.y + 1 - (me.y + EYE_HEIGHT), len) };
    };
    for (let i = 0; i < 60; i++) s.tick(aim(0), SIMULATION.fixedDt);
    expect(unpackGear(s.localPlayer().gear).held).toBe('shotgun');
    for (let i = 0; i < 150 && !s.fight.isDead('dummy-1'); i++) s.tick(aim(Buttons.FIRE | Buttons.AIM), SIMULATION.fixedDt);
    expect(s.fight.isDead('dummy-1')).toBe(true);
    expect(events.some((e) => e.type === 'death' && e.victim === 'dummy-1' && e.killer === 'local')).toBe(true);
    expect(events.some((e) => e.type === 'damage' && e.by === 'local')).toBe(true);
    expect(unpackGear(s.players()[1]!.gear).dead).toBe(true);
    for (let i = 0; i < Math.ceil(DEATH.respawnSeconds * 30) + 2; i++) s.tick(aim(0), SIMULATION.fixedDt);
    expect(s.fight.isDead('dummy-1')).toBe(false);
    expect(s.fight.hp('dummy-1')).toBe(100);
    s.dispose();
  });
});
