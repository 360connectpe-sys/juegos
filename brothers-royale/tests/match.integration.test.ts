import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchMaker } from '@colyseus/core';
import type { Room } from '@colyseus/sdk';
import { createServer } from '../server/index';
import type { WebSocketClient } from '@colyseus/ws-transport';
import type { BrothersRoom } from '../server/BrothersRoom';
import { OnlineSession } from '@/net/OnlineSession';
import type { ClientMatchEvent } from '@/net/MatchView';
import { loadRapier, PhysicsWorld } from '@/physics/PhysicsWorld';
import { SIMULATION } from '@shared/constants';
import { Buttons, emptyInput } from '@shared/types';
import { worldColliders } from '@shared/world/colliders';
import { generateWorldLayout } from '@shared/world/layout';
import { rollChestLoot } from '@shared/match/loot';

const PORT = 31670 + Math.floor(Math.random() * 300);
const URL = `ws://127.0.0.1:${PORT}`;
let server: ReturnType<typeof createServer>;
const layout = generateWorldLayout();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  server = createServer();
  await server.listen(PORT, '127.0.0.1');
});
afterAll(async () => {
  await server.gracefullyShutdown(false).catch(() => undefined);
});

interface TestClient {
  session: OnlineSession;
  physics: PhysicsWorld;
  events: ClientMatchEvent[];
  seq: number;
}

async function makeClient(name: string): Promise<TestClient> {
  const physics = new PhysicsWorld(await loadRapier());
  physics.addTerrain(layout.terrain);
  worldColliders(layout).forEach((c) => physics.addStatic(c));
  const session = await OnlineSession.connect({ url: URL, name, code: 'COFRE6', physics, seed: layout.seed, chests: layout.chests });
  const c: TestClient = { session, physics, events: [], seq: 0 };
  session.onMatchEvent = (e) => c.events.push(e);
  return c;
}

/** Bucle a 30 Hz: cada cliente envía su entrada (con o sin INTERACT). */
async function play(clients: TestClient[], ticks: number, interact: (i: number, t: number) => boolean) {
  for (let t = 0; t < ticks; t++) {
    clients.forEach((c, i) => c.session.tick({ ...emptyInput(++c.seq), buttons: interact(i, t) ? Buttons.INTERACT : 0 }, SIMULATION.fixedDt));
    await wait(1000 / 30);
  }
}

describe('partida con 6 jugadores: cofres, botín e inventarios sincronizados', () => {
  it('reconectar conserva el inventario autoritativo sin generar copias en el suelo', async () => {
    const client = await makeClient('Reconectar inventario');
    try {
      const sdk = (client.session as unknown as { room: Room }).room;
      const room = matchMaker.getLocalRoomById(sdk.roomId) as BrothersRoom;
      const inv = room.world.match.inventory(client.session.localPlayerId)!;
      inv.ammo.ammo_light = 17;
      const totals = room.world.match.totals();
      (room.clients.find((c) => c.sessionId === sdk.sessionId) as WebSocketClient).ref.terminate();
      await wait(50);
      for (let i = 0; i < 300 && (client.session.status !== 'connected' || client.session.match.inventory?.ammo.ammo_light !== 17); i++) await wait(10);
      expect(client.session.status).toBe('connected');
      expect(client.session.match.inventory!.ammo.ammo_light).toBe(17);
      expect(room.world.match.inventory(sdk.sessionId)).toBe(inv);
      expect(room.world.match.totals()).toEqual(totals);
    } finally { client.session.dispose(); client.physics.dispose(); }
  }, 10000);

  it('un único ganador por cofre, sin duplicados, inventarios privados y objetos que caen al salir', async () => {
    const clients: TestClient[] = [];
    for (let i = 0; i < 6; i++) clients.push(await makeClient(`J${i}`));
    const sdk = (clients[0]!.session as unknown as { room: Room }).room;
    const room = matchMaker.getLocalRoomById(sdk.roomId) as BrothersRoom;
    expect(room.world.players.size).toBe(6);
    room.world.round.start();await wait(80);
    // Todos empiezan con el hacha (inventario recibido en la bienvenida).
    for (const c of clients) expect(c.session.match.inventory?.slots[0]?.kind).toBe('axe');

    // Los 6 alrededor del mismo cofre exterior (el servidor manda: los clientes se corrigen solos).
    const chest = layout.chests.find((c) => c.where === 'outside')!;
    clients.forEach((c, i) => {
      const a = (i / 6) * Math.PI * 2;
      room.world.players.get(c.session.localPlayerId)!.body.teleport({ x: chest.x + Math.cos(a) * 1.3, y: chest.y + 0.05, z: chest.z + Math.sin(a) * 1.3 });
    });
    await play(clients, 12, () => false);

    // Todos pulsan Abrir en el mismo tick.
    await play(clients, 3, (_, t) => t === 0);
    await play(clients, 6, () => false);
    for (const c of clients) {
      expect(c.session.match.opened[chest.id]).toBe(true);
      expect(c.events.filter((e) => e.type === 'chestOpened')).toHaveLength(1);
    }
    // Quien pulsó en ese mismo tick pudo recoger ya algo: lo que cuenta es que
    // suelo + inventarios sumen EXACTAMENTE el botín del cofre.
    const lootIds = [...clients[0]!.session.match.pickups.keys()].sort();
    for (const c of clients) expect([...c.session.match.pickups.keys()].sort()).toEqual(lootIds);
    const expected: Record<string, number> = {};
    for (const it of rollChestLoot(room.world.match.matchSeed, chest.id)) expected[it.kind] = (expected[it.kind] ?? 0) + it.qty;
    const totalLoot = room.world.match.totals();
    expect(totalLoot).toEqual(expected);

    // Todos intentan recoger una y otra vez a la vez: nadie duplica nada.
    await play(clients, 40, (_, t) => t % 2 === 0);
    await play(clients, 6, () => false);
    expect(room.world.match.totals()).toEqual(totalLoot);
    for (const c of clients) {
      // Cada cliente ve exactamente lo que queda en el suelo…
      expect([...c.session.match.pickups.keys()].sort()).toEqual([...room.world.match.pickups.keys()].sort());
      // …y SU inventario coincide con el del servidor (los demás no lo reciben).
      expect(c.session.match.inventory).toEqual(room.world.match.inventory(c.session.localPlayerId));
    }
    const holders = clients.filter((c) => c.session.match.inventory!.slots.some((s, i) => i > 0 && s) || Object.values(c.session.match.inventory!.ammo).some((n) => n > 0));
    expect(holders.length).toBeGreaterThan(0);

    // El que se va suelta lo suyo: los demás lo ven aparecer en el suelo.
    const leaver = holders[0]!;
    const before = clients[1 === clients.indexOf(leaver) ? 0 : 1]!;
    const pickupsBefore = before.session.match.pickups.size;
    leaver.session.dispose();
    for (let i = 0; i < 60 && before.session.match.pickups.size === pickupsBefore; i++) await play(clients.filter((c) => c !== leaver), 1, () => false);
    expect(before.session.match.pickups.size).toBeGreaterThan(pickupsBefore);
    expect(room.world.match.totals()).toEqual(totalLoot);

    // Elegir hueco: lo valida el servidor y solo cambia el inventario propio.
    const chooser = clients.find((c) => c !== leaver)!;
    chooser.session.selectSlot(3);
    await play(clients.filter((c) => c !== leaver), 6, () => false);
    expect(chooser.session.match.inventory?.selected).toBe(3);

    for (const c of clients) {
      if (c !== leaver) c.session.dispose();
      c.physics.dispose();
    }
  }, 60000);
});
