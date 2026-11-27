import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import type { WebSocketClient } from '@colyseus/ws-transport';
import { createServer } from '../server/index';
import type { BrothersRoom } from '../server/BrothersRoom';
import { CloseCodes, NET, PROTOCOL_VERSION, ROOM_NAME, type WelcomeMessage } from '@shared/protocol';
import { Buttons, emptyInput } from '@shared/types';

const port = 30000 + Math.floor(Math.random() * 2000);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let server: ReturnType<typeof createServer>;
beforeAll(async () => {
  server = createServer();
  await server.listen(port, '127.0.0.1');
});
afterAll(async () => { await server.gracefullyShutdown(false); });

async function connect(code: string) {
  const room = await new Client(`ws://127.0.0.1:${port}`).joinOrCreate(ROOM_NAME, { protocol: PROTOCOL_VERSION, name: 'Carga', code });
  let welcomes = 0;
  let welcome: WelcomeMessage | null = null;
  let closed = 0;
  let snapshots = 0;
  room.onMessage('welcome', (message: WelcomeMessage) => { welcome = message; welcomes++; });
  room.onMessage('snapshot', () => { snapshots++; });
  for (const type of ['join', 'leave', 'correction', 'pong', 'match', 'inventory', 'notice']) room.onMessage(type, () => undefined);
  room.onLeave((code) => { closed = code; });
  room.send('ready');
  for (let i = 0; i < 200 && !welcome; i++) await wait(10);
  expect(welcome).not.toBeNull();
  return { room, welcomes: () => welcomes, closed: () => closed, snapshots: () => snapshots };
}

describe('auditoría de carga y límites', () => {
  it('sostiene 8 clientes a 30 Hz y mide coste, cadencia y tráfico real', async () => {
    const clients: Awaited<ReturnType<typeof connect>>[] = [];
    try {
      for (let i = 0; i < NET.maxPlayersPerRoom; i++) clients.push(await connect('AUDIT8'));
      expect(new Set(clients.map((c) => c.room.roomId)).size).toBe(1);
      const room = matchMaker.getLocalRoomById(clients[0]!.room.roomId) as BrothersRoom;
      room.world.round.start();
      const durations: number[] = [];
      const intervals: number[] = [];
      let previous = performance.now();
      const original = room.world.step.bind(room.world);
      const step = vi.spyOn(room.world, 'step').mockImplementation(() => {
        const start = performance.now();
        intervals.push(start - previous);
        previous = start;
        original();
        durations.push(performance.now() - start);
      });
      let bytes = 0;
      const spies = room.clients.map((client) => {
        const socket = (client as WebSocketClient).ref;
        const send = socket.send.bind(socket);
        return vi.spyOn(socket, 'send').mockImplementation((data, ...args) => {
          bytes += (data as Uint8Array).byteLength;
          return send(data, ...args);
        });
      });
      const durationSeconds = Number(process.env.BR_SOAK_SECONDS ?? 5);
      if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 5) throw new Error('BR_SOAK_SECONDS debe ser un entero ≥ 5');
      if (durationSeconds >= 600) {
        const chest = room.world.layout.chests.find((c) => c.where === 'outside')!;
        for (const player of room.world.players.values()) player.body.teleport({ x: chest.x, y: chest.y + 0.05, z: chest.z + 1 });
      }
      const totalInputs = durationSeconds * 30;
      const firstTick = room.world.tick;
      const memory = [{ second: 0, ...process.memoryUsage() }];
      const countsBefore = clients.map((client) => client.snapshots());
      let maxQueue = 0;
      let maxBuffered = 0;
      const start = performance.now();
      for (let seq = 1; seq <= totalInputs; seq++) {
        const deadline = start + seq * 1000 / 30;
        const direction = Math.floor(seq / 90) % 2 === 0 ? 1 : -1;
        for (const c of clients) c.room.send('input', { ...emptyInput(seq), moveX: direction * Math.SQRT1_2, moveZ: direction * Math.SQRT1_2, buttons: seq % 90 === 1 ? Buttons.JUMP | Buttons.INTERACT : 0 });
        maxQueue = Math.max(maxQueue, ...[...room.world.players.values()].map((p) => p.queue.length));
        maxBuffered = Math.max(maxBuffered, ...room.clients.map((c) => (c as WebSocketClient).ref.bufferedAmount));
        expect(room.world.players.size).toBe(8);
        expect(clients.every((c) => c.closed() === 0)).toBe(true);
        if (seq % 1800 === 0) {
          memory.push({ second: seq / 30, ...process.memoryUsage() });
          console.log('SOAK_PROGRESS', JSON.stringify({ seconds: seq / 30, players: room.world.players.size, maxQueue, maxBuffered }));
        }
        // Las métricas se acumulan arriba. No retener copias de los paquetes en los spies.
        step.mockClear();
        spies.forEach((spy) => spy.mockClear());
        await wait(Math.max(0, deadline - performance.now()));
      }
      const seconds = (performance.now() - start) / 1000;
      const hz = (room.world.tick - firstTick) / seconds;
      const percentile = (values: number[], q: number) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * q)]!;
      console.log('AUDIT8', JSON.stringify({
        seconds, hz, ticks: room.world.tick - firstTick,
        stepP50Ms: percentile(durations, 0.5), stepP95Ms: percentile(durations, 0.95), stepMaxMs: Math.max(...durations),
        intervalP95Ms: percentile(intervals.slice(1), 0.95),
        outboundBytesPerSecond: bytes / seconds,
        maxQueue, maxBuffered, memory,
        snapshotsPerClient: clients.map((c, i) => c.snapshots() - countsBefore[i]!),
        players: room.world.players.size,
      }));
      expect(hz).toBeGreaterThan(27);
      expect(hz).toBeLessThan(33);
      expect(percentile(durations, 0.95)).toBeLessThan(1000 / 30);
      expect(room.world.players.size).toBe(8);
      expect(clients.every((c, i) => c.snapshots() - countsBefore[i]! >= durationSeconds * 27)).toBe(true);
      step.mockRestore();
      spies.forEach((spy) => spy.mockRestore());
    } finally {
      await Promise.all(clients.map((c) => c.room.leave(true)));
    }
  }, (Number(process.env.BR_SOAK_SECONDS ?? 5) + 20) * 1000);

  it('rechaza al noveno por roomId, incluso con una plaza reservada para reconexión', async () => {
    const clients: Awaited<ReturnType<typeof connect>>[] = [];
    let replacement: Room | undefined;
    try {
      for (let i = 0; i < 8; i++) clients.push(await connect('FULL8'));
      const id = clients[0]!.room.roomId;
      const ninth = new Client(`ws://127.0.0.1:${port}`);
      await expect(ninth.joinById(id, { protocol: PROTOCOL_VERSION, name: 'Noveno' })).rejects.toThrow(/locked/);
      const room = matchMaker.getLocalRoomById(id) as BrothersRoom;
      expect(room.world.players.size).toBe(8);
      const dropped = clients[7]!;
      dropped.room.reconnection.enabled = false;
      const socket = room.clients.find((c) => c.sessionId === dropped.room.sessionId) as WebSocketClient;
      socket.ref.terminate();
      await wait(100);
      await expect(ninth.joinById(id, { protocol: PROTOCOL_VERSION, name: 'Noveno' })).rejects.toThrow(/locked/);
      expect(room.world.players.size).toBe(8);
      await clients[6]!.room.leave(true);
      for (let i = 0; i < 100 && room.world.players.size !== 7; i++) await wait(10);
      expect(room.world.players.size).toBe(7);
      replacement = await ninth.joinById(id, { protocol: PROTOCOL_VERSION, name: 'Reemplazo', code: room.code });
      replacement.onMessage('*', () => undefined);
      replacement.send('ready');
      expect(room.world.players.size).toBe(8);
    } finally {
      await replacement?.leave(true);
      await Promise.all(clients.map((c) => c.room.leave(true)));
    }
  });

  it('ready es idempotente y también cuenta para expulsar saturación', async () => {
    const c = await connect('FLOOD');
    try {
      for (let window = 0; window < 3 && !c.closed(); window++) {
        for (let i = 0; i < 100; i++) c.room.send('ready');
        await wait(1100);
      }
      expect(c.welcomes()).toBe(1);
      expect(c.closed()).toBe(CloseCodes.FLOODING);
    } finally { await c.room.leave(true); }
  }, 10000);

  it('los tipos desconocidos tampoco evitan la validación del servidor', async () => {
    const c = await connect('UNKNOWN');
    try {
      for (let i = 0; i < 40; i++) c.room.send('inventado', {});
      for (let i = 0; i < 100 && !c.closed(); i++) await wait(10);
      expect(c.closed()).toBe(CloseCodes.INVALID_INPUT);
    } finally { await c.room.leave(true); }
  });

  it('las entradas antes de ready no se simulan', async () => {
    const sdk = await new Client(`ws://127.0.0.1:${port}`).joinOrCreate(ROOM_NAME, { protocol: PROTOCOL_VERSION, name: 'Antes', code: 'BEFORE' });
    for (const type of ['snapshot', 'welcome', 'correction', 'join', 'leave']) sdk.onMessage(type, () => undefined);
    try {
      const room = matchMaker.getLocalRoomById(sdk.roomId) as BrothersRoom;
      sdk.send('input', { ...emptyInput(1), moveX: 1 });
      await wait(100);
      expect(room.world.players.get(sdk.sessionId)!.body.state.lastProcessedSeq).toBe(0);
      expect(room.world.players.get(sdk.sessionId)!.queue).toHaveLength(0);
    } finally { await sdk.leave(true); }
  });

  it('retira el personaje cuando expira la ventana de reconexión de 15 s', async () => {
    const observer = await connect('EXPIRE');
    const dropped = await connect('EXPIRE');
    const room = matchMaker.getLocalRoomById(observer.room.roomId) as BrothersRoom;
    const player = room.clients.find((client) => client.sessionId === dropped.room.sessionId) as WebSocketClient;
    try {
      dropped.room.reconnection.enabled = false;
      player.ref.terminate();
      await wait(100);
      expect(room.world.players.has(dropped.room.sessionId)).toBe(true);
      expect(room.world.players.get(dropped.room.sessionId)!.connected).toBe(false);
      const start = performance.now();
      for (let i = 0; i < 180 && room.world.players.has(dropped.room.sessionId); i++) await wait(100);
      const elapsed = performance.now() - start;
      expect(room.world.players.has(dropped.room.sessionId)).toBe(false);
      expect(elapsed).toBeGreaterThan(14000);
      expect(elapsed).toBeLessThan(17500);
      console.log('AUDIT_EXPIRY_MS', elapsed);
    } finally {
      await observer.room.leave(true);
      await dropped.room.leave(true);
    }
  }, 25000);

  it('cierra consumidores con más de 256 KiB pendientes', async () => {
    const c = await connect('SLOW');
    const room = matchMaker.getLocalRoomById(c.room.roomId) as BrothersRoom;
    const socket = (room.clients[0] as WebSocketClient).ref;
    Object.defineProperty(socket, 'bufferedAmount', { configurable: true, get: () => 300 * 1024 });
    try {
      for (let i = 0; i < 100 && !c.closed(); i++) await wait(10);
      expect(c.closed()).toBe(CloseCodes.SLOW_CONSUMER);
    } finally {
      delete (socket as unknown as Record<string, unknown>).bufferedAmount;
      await c.room.leave(true);
    }
  });
});
