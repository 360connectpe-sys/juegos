import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Room } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import type { BrothersRoom } from '../server/BrothersRoom';
import type { WebSocketClient } from '@colyseus/ws-transport';
import { createServer } from '../server/index';
import { OnlineSession, type OnlineInfo } from '@/net/OnlineSession';
import { loadRapier, PhysicsWorld } from '@/physics/PhysicsWorld';
import { SIMULATION } from '@shared/constants';
import { screenToWorld } from '@shared/movement';
import { CloseCodes, NET, PROTOCOL_VERSION } from '@shared/protocol';
import type { RosterEntry, CorrectionMessage, WelcomeMessage } from '@shared/protocol';
import { emptyInput } from '@shared/types';
import { worldColliders } from '@shared/world/colliders';
import { generateWorldLayout } from '@shared/world/layout';

const PORT = 27670 + Math.floor(Math.random() * 1000);
const URL = `ws://127.0.0.1:${PORT}`;
let server: ReturnType<typeof createServer>;
const layout = generateWorldLayout();

beforeAll(async () => {
  server = createServer();
  await server.listen(PORT, '127.0.0.1');
});
afterAll(async () => {
  await server.gracefullyShutdown(false).catch(() => undefined);
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function makeClient(name: string, code = '') {
  const R = await loadRapier();
  const physics = new PhysicsWorld(R);
  physics.addTerrain(layout.terrain);
  worldColliders(layout).forEach((c) => physics.addStatic(c));
  const infos: OnlineInfo[] = [];
  const session = await OnlineSession.connect({ url: URL, name, code, physics, seed: layout.seed, onInfo: (i) => infos.push(i) });
  return { session, physics, infos };
}

/** Bucle de juego a 30 Hz en tiempo real, como el navegador. */
async function play(clients: { session: OnlineSession }[], ticks: number, inputFor: (i: number, tick: number) => { x: number; y: number }, seqStart: number) {
  for (let t = 0; t < ticks; t++) {
    clients.forEach((c, i) => {
      const v = screenToWorld(inputFor(i, t).x, inputFor(i, t).y);
      c.session.tick({ ...emptyInput(seqStart + t), moveX: v.x, moveZ: v.y }, SIMULATION.fixedDt);
    });
    await wait(1000 / 30);
  }
}

describe('OnlineSession: dos clientes simultáneos contra el servidor', () => {
  it('se ven, se mueven, el servidor confirma la predicción y gestiona la salida', async () => {
    const a = await makeClient('Ana', 'E2E1');
    const b = await makeClient('Beto', 'E2E1');
    expect(a.session.info.roomId).toBe(b.session.info.roomId);
    (matchMaker.getLocalRoomById(a.session.info.roomId) as BrothersRoom).world.round.start();await wait(80);
    await play([a, b], 15, () => ({ x: 0, y: 0 }), 1);
    expect(a.session.players().map((p) => p.id).sort()).toEqual([a.session.localPlayerId, b.session.localPlayerId].sort());
    expect(a.session.identity(b.session.localPlayerId).name).toBe('Beto');

    // A camina a la derecha y B hacia arriba durante 2 s, a la vez.
    const a0 = { ...a.session.localPlayer().position };
    const b0 = { ...b.session.localPlayer().position };
    await play([a, b], 60, (i) => (i === 0 ? { x: 1, y: 0 } : { x: 0, y: 1 }), 100);
    await play([a, b], 20, () => ({ x: 0, y: 0 }), 200); // se detienen y llegan las correcciones
    const aLocal = a.session.localPlayer().position;
    expect(Math.hypot(aLocal.x - a0.x, aLocal.z - a0.z)).toBeGreaterThan(5);
    expect(a.session.pendingInputs).toBeLessThan(8);
    // B ve a A (interpolado, en el pasado reciente) cerca de donde A se ve a sí mismo.
    const aSeenByB = b.session.players().find((p) => p.id === a.session.localPlayerId)!;
    expect(Math.hypot(aSeenByB.position.x - aLocal.x, aSeenByB.position.z - aLocal.z)).toBeLessThan(0.5);
    const bSeenByA = a.session.players().find((p) => p.id === b.session.localPlayerId)!;
    expect(Math.hypot(bSeenByA.position.x - b0.x, bSeenByA.position.z - b0.z)).toBeGreaterThan(5);
    // La predicción casi no necesitó correcciones (sin pérdidas ni lag).
    expect(a.session.info.correction).toBeLessThan(0.01);
    expect(a.infos.at(-1)!.rtt).toBeGreaterThanOrEqual(0);

    // B se va: A deja de verlo.
    b.session.dispose();
    for (let i = 0; i < 40 && a.session.players().length > 1; i++) await play([a], 1, () => ({ x: 0, y: 0 }), 300 + i);
    expect(a.session.players()).toHaveLength(1);
    expect(a.session.info.players).toBe(1);

    a.session.dispose();
    a.physics.dispose();
    b.physics.dispose();
  }, 30000);

  it('reconecta una caída temprana conservando identidad y vuelve a confirmar entradas', async () => {
    const c = await makeClient('Reconectar', 'RECON');
    try {
      const id = c.session.localPlayerId;
      const sdk = (c.session as unknown as { room: Room }).room;
      const room = matchMaker.getLocalRoomById(sdk.roomId) as BrothersRoom;
      (room.clients[0] as WebSocketClient).ref.terminate();
      for (let i = 0; i < 150 && !c.infos.some((info) => info.status === 'reconnecting'); i++) await wait(10);
      expect(c.infos.some((info) => info.status === 'reconnecting')).toBe(true);
      for (let i = 0; i < 300 && c.session.status !== 'connected'; i++) await wait(10);
      expect(c.session.status).toBe('connected');
      expect(c.session.localPlayerId).toBe(id);
      expect(room.world.players.size).toBe(1);
      await play([c], 20, () => ({ x: 1, y: 0 }), 1);
      await play([c], 15, () => ({ x: 0, y: 0 }), 21);
      expect(c.session.localPlayer().lastProcessedSeq).toBeGreaterThanOrEqual(30);
      expect(c.session.pendingInputs).toBeLessThan(5);
    } finally {
      c.session.dispose();
      c.physics.dispose();
    }
  }, 15000);

  it('descarta correcciones antiguas y limpia el estado anterior al recibir otra bienvenida', async () => {
    const c = await makeClient('Corrección', 'CORRECT');
    try {
      const sdk = (c.session as unknown as { room: Room }).room;
      const room = matchMaker.getLocalRoomById(sdk.roomId) as BrothersRoom;
      const player = room.world.players.get(c.session.localPlayerId)!;
      const internals = c.session as unknown as {
        onCorrection(message: CorrectionMessage): void;
        onWelcome(message: WelcomeMessage): void;
        pendingCorrection: CorrectionMessage | null;
      };
      const state = player.body.snapshot();
      const tick = room.world.tick + 100;
      internals.onCorrection({ tick, state });
      c.session.tick(emptyInput(1), SIMULATION.fixedDt);
      internals.onCorrection({ tick: tick - 1, state });
      expect(internals.pendingCorrection).toBeNull();
      internals.onCorrection({ tick: tick + 1, state });
      expect(internals.pendingCorrection).not.toBeNull();
      internals.onWelcome({
        protocol: 3, playerId: player.id, netId: player.netId, roomId: room.roomId,
        code: room.code, seed: room.world.seed, tick: tick + 2, tickRate: 30,
        roster: room.world.roster(), state,
      });
      expect(internals.pendingCorrection).toBeNull();
      expect(c.session.pendingInputs).toBe(0);
      expect(c.session.status).toBe('connected');
    } finally {
      c.session.dispose();
      c.physics.dispose();
    }
  });

  it('cancelar durante la conexión evita crear un personaje en física liberada', async () => {
    const physics = new PhysicsWorld(await loadRapier());
    const abort = new AbortController();
    const connecting = OnlineSession.connect({ url: URL, name: 'Cancelar', code: 'CANCEL', physics, seed: layout.seed, signal: abort.signal });
    abort.abort();
    physics.dispose();
    await expect(connecting).rejects.toThrow();
  });

  it.each(['join', 'welcome'] as const)('el cliente rechaza más de ocho jugadores mediante %s', async (message) => {
    const c = await makeClient('Capacidad', 'CAP' + message);
    try {
      const sdk = (c.session as unknown as { room: Room }).room;
      const room = matchMaker.getLocalRoomById(sdk.roomId) as BrothersRoom;
      const local = room.world.players.get(c.session.localPlayerId)!;
      const roster = [room.world.rosterEntry(local)];
      for (let i = 1; i <= NET.maxPlayersPerRoom; i++) roster.push({ id: 'extra' + i, netId: i, name: 'Extra', color: 0 });
      const internals = c.session as unknown as {
        onJoin(entry: RosterEntry): void;
        onWelcome(message: WelcomeMessage): void;
      };
      if (message === 'join') {
        for (const entry of roster.slice(1, 8)) internals.onJoin(entry);
        expect(c.session.info.players).toBe(8);
        internals.onJoin(roster[8]!);
      } else {
        internals.onWelcome({
          protocol: PROTOCOL_VERSION, playerId: local.id, netId: local.netId,
          roomId: room.roomId, code: room.code, seed: room.world.seed,
          tick: room.world.tick, tickRate: 30, roster, state: local.body.snapshot(),
        });
      }
      expect(c.session.status).toBe('disconnected');
      expect(c.session.info.players).toBeLessThanOrEqual(8);
      expect(c.session.info.reason).toContain('8 jugadores');
      expect(CloseCodes.ROOM_CAPACITY).toBe(4104);
    } finally {
      c.session.dispose();
      c.physics.dispose();
    }
  });

  it('rechaza un servidor con otro mapa y avisa si el servidor cae', async () => {
    const R = await loadRapier();
    const physics = new PhysicsWorld(R);
    await expect(OnlineSession.connect({ url: URL, name: 'X', physics, seed: 999, code: 'MAPA' })).rejects.toThrow(/otro mapa/);
    await expect(OnlineSession.connect({ url: 'ws://127.0.0.1:1', name: 'X', physics, seed: layout.seed, timeoutMs: 1500 })).rejects.toThrow();
    const c = await makeClient('Caída', 'CAIDA');
    await server.gracefullyShutdown(false);
    for (let i = 0; i < 100 && c.session.status !== 'disconnected'; i++) await wait(30);
    expect(c.session.status).toBe('disconnected');
    expect(c.infos.at(-1)!.status).toBe('disconnected');
    c.session.dispose();
    c.physics.dispose();
    physics.dispose();
  }, 30000);
});
