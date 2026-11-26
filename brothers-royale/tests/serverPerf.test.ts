import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client } from '@colyseus/sdk';
import { createServer } from '../server/index';
import { ServerWorld } from '../server/ServerWorld';
import { PROTOCOL_VERSION, ROOM_NAME } from '@shared/protocol';
import { toPlayerState, unpackPlayers, writePlayerState, packPlayer } from '@shared/netcodec';
import type { PlayerState } from '@shared/types';

const PORT = 29670 + Math.floor(Math.random() * 300);
let server: ReturnType<typeof createServer>;
beforeAll(async () => {
  server = createServer();
  await server.listen(PORT, '127.0.0.1');
});
afterAll(async () => {
  await server.gracefullyShutdown(false).catch(() => undefined);
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('servidor: snapshot codificado una vez por tick', () => {
  it('con 3 clientes listos se genera 1 snapshot por tick (no 1 por cliente)', async () => {
    const spy = vi.spyOn(ServerWorld.prototype, 'snapshot');
    const rooms = await Promise.all(
      ['A', 'B', 'C'].map(async (name) => {
        const room = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate(ROOM_NAME, { protocol: PROTOCOL_VERSION, name, code: 'PERF' });
        let snaps = 0;
        for (const t of ['welcome', 'correction', 'join', 'leave', 'pong']) room.onMessage(t, () => undefined);
        room.onMessage('snapshot', () => snaps++);
        room.send('ready');
        return { room, snaps: () => snaps };
      }),
    );
    await wait(300);
    spy.mockClear();
    const before = rooms.map((r) => r.snaps());
    await wait(500);
    const calls = spy.mock.calls.length;
    const received = rooms.map((r, i) => r.snaps() - before[i]!);
    expect(calls).toBeGreaterThanOrEqual(10);
    // Cada cliente recibe ~1 snapshot por tick, pero el servidor solo lo genera una vez.
    for (const n of received) expect(Math.abs(n - calls)).toBeLessThanOrEqual(2);
    await Promise.all(rooms.map((r) => r.room.leave(true)));
    spy.mockRestore();
  }, 15000);
});

describe('códec sin asignaciones', () => {
  it('writePlayerState reutiliza el objeto y equivale a toPlayerState', () => {
    const s: PlayerState = { id: 'a', name: 'A', position: { x: 1.23, y: 2, z: -3 }, velocity: { x: 1, y: 0, z: 0 }, yaw: 1, grounded: true, locomotion: 'walk', lastProcessedSeq: 7 };
    const packed: number[] = [];
    packPlayer(packed, 2, s);
    const p = unpackPlayers(packed)[0]!;
    const out = toPlayerState(p, 'z', 'Z');
    const pos = out.position;
    const again = writePlayerState(out, p, 'a', 'A');
    expect(again).toBe(out);
    expect(again.position).toBe(pos);
    expect(again).toEqual(toPlayerState(p, 'a', 'A'));
  });
});
