import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { createServer } from '../server/index';
import { unpackPlayers } from '@shared/netcodec';
import { CloseCodes, PROTOCOL_VERSION, ROOM_NAME, type CorrectionMessage, type RosterEntry, type SnapshotMessage, type WelcomeMessage } from '@shared/protocol';
import { screenToWorld } from '@shared/movement';
import { Buttons, emptyInput } from '@shared/types';

const PORT = 25670 + Math.floor(Math.random() * 1000);
let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  server = createServer();
  await server.listen(PORT, '127.0.0.1');
});
afterAll(async () => {
  await server.gracefullyShutdown(false);
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 4000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout esperando condición');
    await wait(15);
  }
}

/** Cliente de prueba que registra todo lo que recibe. */
async function connect(name: string, code = '') {
  const client = new Client(`ws://127.0.0.1:${PORT}`);
  const room: Room = await client.joinOrCreate(ROOM_NAME, { protocol: PROTOCOL_VERSION, name, code });
  const log = {
    room,
    welcome: null as WelcomeMessage | null,
    snapshots: [] as SnapshotMessage[],
    corrections: [] as CorrectionMessage[],
    joins: [] as RosterEntry[],
    leaves: [] as { id: string }[],
    left: null as number | null,
  };
  room.onMessage('welcome', (m: WelcomeMessage) => (log.welcome = m));
  room.onMessage('snapshot', (m: SnapshotMessage) => log.snapshots.push(m));
  room.onMessage('correction', (m: CorrectionMessage) => log.corrections.push(m));
  room.onMessage('join', (m: RosterEntry) => log.joins.push(m));
  room.onMessage('leave', (m: { id: string }) => log.leaves.push(m));
  room.onMessage('pong', () => undefined);
  room.onLeave((code) => (log.left = code));
  room.send('ready');
  await until(() => log.welcome !== null);
  return log;
}

describe('servidor autoritativo (Colyseus) con dos clientes', () => {
  it('identifica, sincroniza, valida, reconcilia y gestiona desconexiones', async () => {
    const a = await connect('Ana');
    const b = await connect('Ana'); // mismo nombre → se desambigua
    expect(a.room.roomId).toBe(b.room.roomId);
    expect(a.welcome!.protocol).toBe(PROTOCOL_VERSION);
    expect(a.welcome!.tickRate).toBe(30);
    expect(b.welcome!.roster.map((r) => r.name).sort()).toEqual(['Ana', 'Ana 2']);
    expect(a.welcome!.netId).not.toBe(b.welcome!.netId);
    await until(() => a.joins.some((j) => j.id === b.room.sessionId));

    // Ambos reciben snapshots a ~30 Hz con los dos jugadores.
    a.snapshots.length = 0;
    await wait(500);
    expect(a.snapshots.length).toBeGreaterThanOrEqual(10);
    expect(a.snapshots.length).toBeLessThanOrEqual(20);
    const last = unpackPlayers(a.snapshots.at(-1)!.p);
    expect(last.map((p) => p.netId).sort()).toEqual([a.welcome!.netId, b.welcome!.netId].sort());

    // B camina "a la derecha" de la pantalla durante 30 entradas.
    const dir = screenToWorld(1, 0);
    const start = unpackPlayers(b.snapshots.at(-1)!.p).find((p) => p.netId === b.welcome!.netId)!;
    for (let seq = 1; seq <= 30; seq++) {
      b.room.send('input', { ...emptyInput(seq), moveX: dir.x, moveZ: dir.y, buttons: seq === 5 ? Buttons.JUMP : 0 });
      await wait(33);
    }
    await until(() => b.corrections.some((c) => c.state.lastProcessedSeq === 30));
    await wait(100);
    // A ve moverse a B (estado autoritativo) y B recibe su corrección privada.
    const seenByA = unpackPlayers(a.snapshots.at(-1)!.p).find((p) => p.netId === b.welcome!.netId)!;
    const moved = Math.hypot(seenByA.x - start.x, seenByA.z - start.z);
    expect(moved).toBeGreaterThan(3);
    expect(seenByA.lastSeq).toBe(30);
    expect(a.corrections.every((c) => c.state.lastProcessedSeq === 0)).toBe(true);

    // Entradas inválidas o repetidas se ignoran sin mover al jugador.
    // Sin entradas el servidor sigue simulando "en reposo": esperamos a que frene.
    await wait(400);
    const before = unpackPlayers(a.snapshots.at(-1)!.p).find((p) => p.netId === b.welcome!.netId)!;
    b.room.send('input', { ...emptyInput(31), moveX: Number.NaN });
    b.room.send('input', { ...emptyInput(30), moveX: 1 });
    b.room.send('input', { ...emptyInput(32), moveX: 50 });
    b.room.send('input', { seq: 33, moveX: '1' });
    await wait(150);
    const after = unpackPlayers(a.snapshots.at(-1)!.p).find((p) => p.netId === b.welcome!.netId)!;
    expect(after.lastSeq).toBe(30);
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.02);

    // Desconexión voluntaria de B: A recibe "leave" y deja de verlo.
    await b.room.leave(true);
    await until(() => a.leaves.some((l) => l.id === b.room.sessionId));
    await wait(100);
    expect(unpackPlayers(a.snapshots.at(-1)!.p).map((p) => p.netId)).toEqual([a.welcome!.netId]);
    await a.room.leave(true);
  }, 20000);

  it('salas por código, versión de protocolo y expulsión por entradas inválidas', async () => {
    const pub = await connect('Pública');
    const priv = await connect('Privada', 'abc-123');
    expect(priv.welcome!.code).toBe('ABC123');
    expect(priv.room.roomId).not.toBe(pub.room.roomId);

    const bad = new Client(`ws://127.0.0.1:${PORT}`);
    await expect(bad.joinOrCreate(ROOM_NAME, { protocol: 1, name: 'Viejo' })).rejects.toThrow(/protocolo/);

    for (let i = 0; i < 40; i++) priv.room.send('input', { seq: -1 });
    await until(() => priv.left !== null);
    expect(priv.left).toBe(CloseCodes.INVALID_INPUT);
    await pub.room.leave(true);
  }, 20000);
});
