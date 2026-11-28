/**
 * Fase 12 — prueba de estabilidad del escenario máximo (solo con BR_SOAK12_SECONDS, p. ej. 1800):
 * la de la fase 10 + avión de transporte en cada ronda, 8 zombis activos y tormenta de 15 min.
 * Base (fase 10):
 * 8 clientes SDK reales en la misma sala: lobby → partida; combate continuo, hasta 128
 * estructuras (se reconstruyen al destruirse), tormenta y ciclo de ronda real con
 * revanchas. Mide cada segundo: frecuencia de simulación, coste del paso, latencia
 * (ping/pong), memoria y CPU del proceso, desconexiones y piezas. Guarda el resultado en
 * BR_SOAK12_OUT (JSON). Una desconexión programada comprueba que no afecta a los demás.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { Client, type Room } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { createServer } from '../server/index';
import type { BrothersRoom } from '../server/BrothersRoom';
import { PROTOCOL_VERSION, ROOM_NAME } from '@shared/protocol';
import { BUILD, BUILD_KINDS, groundRange, rotationForYaw, type BuildRequest } from '@shared/building/BuildingState';
import { addItem } from '@shared/inventory';
import { Buttons } from '@shared/types';
import { terrainHeight } from '@shared/world/terrain';

const SECONDS = Number(process.env.BR_SOAK12_SECONDS ?? 0);
const port = 35000 + Math.floor(Math.random() * 1000);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let server: ReturnType<typeof createServer>;

interface Bot { room: Room; id: string; seq: number; rtt: number[]; closed: number; snapshots: number; i: number; pos: { x: number; y: number; z: number } | null }

async function join(code: string, i: number): Promise<Bot> {
  const room = await new Client(`ws://127.0.0.1:${port}`).joinOrCreate(ROOM_NAME, { protocol: PROTOCOL_VERSION, name: `Soak${i}`, code, skin: i });
  const bot: Bot = { room, id: room.sessionId, seq: 0, rtt: [], closed: 0, snapshots: 0, i, pos: null };
  room.onMessage('welcome', (w: { state: { position: Bot['pos'] } }) => { bot.pos = w.state.position; });
  room.onMessage('correction', (c: { state: { position: Bot['pos'] } }) => { bot.pos = c.state.position; });
  room.onMessage('snapshot', () => { bot.snapshots++; });
  room.onMessage('pong', (m: { t: number }) => { bot.rtt.push(performance.now() - m.t); });
  room.onMessage('*', () => undefined);
  room.onLeave((c) => { bot.closed = c; });
  room.send('ready');
  return bot;
}

const pct = (a: number[], p: number) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]!; };

beforeAll(async () => {
  if (!SECONDS) return;
  server = createServer({ port, host: '127.0.0.1', allowedOrigins: null, maxRooms: 8 });
  await server.listen(port, '127.0.0.1');
});
afterAll(async () => { if (SECONDS) await server.gracefullyShutdown(false).catch(() => undefined); });

describe.skipIf(!SECONDS)('fase 12: estabilidad con 8 clientes, avión y 8 zombis', () => {
  it(`sostiene ${SECONDS} s con combate, 128 estructuras, tormenta y revanchas`, async () => {
    const bots: Bot[] = [];
    for (let i = 0; i < 8; i++) bots.push(await join('SOAK12', i));
    await wait(500);
    const room = matchMaker.getLocalRoomById(bots[0]!.room.roomId) as BrothersRoom;
    const world = room.world;
    expect(world.players.size).toBe(8);
    // Paso de simulación instrumentado.
    const steps: number[] = [];
    const origStep = world.step.bind(world);
    world.step = (dt?: number) => { const t0 = performance.now(); origStep(dt); steps.push(performance.now() - t0); };

    const layout = world.layout;
    const ground = (x: number, z: number) => terrainHeight(x, z, layout.terrain);
    /** Prepara una ronda: armas, madera y posiciones en anillo alrededor del centro. */
    const arm = () => {
      for (const [n, p] of [...world.players.values()].entries()) {
        let inv = world.match.inventory(p.id);
        if (inv) {
          inv = addItem(inv, { kind: n % 2 ? 'smg' : 'rifle', qty: 1, rarity: 'rare' }).inventory;
          inv = addItem(inv, { kind: 'ammo_light', qty: 360 }).inventory;
          inv = addItem(inv, { kind: 'ammo_medium', qty: 180 }).inventory;
          world.match.setInventory(p.id, inv);
          world.selectSlot(p.id, 1);
        }
        world.building.state.wood.set(p.id, BUILD.woodCap);
      }
    };
    const startRound = async () => {
      for (let t = 0; t < 40 && world.round.phase !== 'running'; t++) {
        for (const b of bots) if (b.closed === 0) b.room.send('lobbyReady', { ready: true });
        for (const b of bots) if (b.closed === 0) b.room.send('start', {});
        await wait(500);
      }
      expect(world.round.phase).toBe('running');
      arm();
    };
    await startRound();

    const samples: Record<string, number>[] = [];
    let lastTick = world.tick;
    let rounds = 1;
    let rematches = 0;
    let disconnectTest = { done: false, othersKept: false };
    const cpu0 = process.cpuUsage();
    let cpuPrev = process.cpuUsage();
    const t0 = performance.now();
    let tick = 0;
    // Entradas a 30 Hz: caminan en círculo, disparan a estructuras y al aire; construyen.
    const input = setInterval(() => {
      tick++;
      for (const b of bots) {
        if (b.closed !== 0 || !b.pos) continue;
        const a = (b.i / 8) * Math.PI * 2 + tick * 0.004;
        const yaw = a + Math.PI / 2;
        const fire = tick % 90 < 60;
        // En el avión, cada bot salta en un momento distinto; cayendo, se dirige.
        const air = world.round.airMode(b.room.sessionId);
        const jump = air === 1 && tick % 240 === b.i * 20 ? Buttons.JUMP : 0;
        b.room.send('input', { seq: ++b.seq, moveX: Math.cos(yaw) * 0.6, moveZ: Math.sin(yaw) * 0.6, buttons: (fire ? Buttons.FIRE | Buttons.AIM : 0) | jump, aimYaw: Math.atan2(Math.cos(yaw), Math.sin(yaw)) + 0.5, aimPitch: 0.25 });
        // Construir cada ~0,5 s mientras haya menos de 128 piezas (16 por jugador).
        if (tick % 15 === b.i && world.building.state.pieces.size < BUILD.maxPieces && world.round.phase === 'running') {
          const kind = BUILD_KINDS[(tick / 15 + b.i) % 3 | 0]!;
          const fx = Math.round(b.pos.x / 3) * 3 + Math.round(Math.sin(yaw)) * 3;
          const fz = Math.round(b.pos.z / 3) * 3 + Math.round(Math.cos(yaw)) * 3;
          const req: BuildRequest = { kind, x: fx + 0, z: fz + 0, y: groundRange(ground, fx, fz)[1], rotation: rotationForYaw(kind, yaw) };
          b.room.send('build', req);
        }
      }
    }, 1000 / 30);
    const ping = setInterval(() => { for (const b of bots) if (b.closed === 0) b.room.send('ping', { t: performance.now() }); }, 1000);

    try {
      for (let s = 1; s <= SECONDS; s++) {
        await wait(1000);
        // Escenario máximo: mantener 8 zombis activos junto a los jugadores en tierra.
        if (world.round.phase === 'running' && s % 5 === 0) {
          const grounded = [...world.players.values()].filter((p) => world.round.airMode(p.id) === 0);
          for (let k = 0; k < 8 && world.zombies.alive < 8 && grounded.length; k++) {
            const p = grounded[k % grounded.length]!.body.state.position, a = Math.random() * Math.PI * 2;
            world.zombies.spawnAt(p.x + Math.cos(a) * 9, p.z + Math.sin(a) * 9);
          }
        }
        // Revancha automática al terminar una ronda (tormenta/eliminaciones/límite).
        if (world.round.phase === 'finished') {
          for (const b of bots) if (b.closed === 0) b.room.send('rematch', {});
          await wait(1500);
          rematches++;
          await startRound();
          rounds++;
        }
        // Desconexión a los 60 s: el resto debe seguir recibiendo snapshots.
        if (s === Math.min(60, SECONDS - 5) && !disconnectTest.done) {
          const before = bots.slice(1).map((b) => b.snapshots);
          await bots[7]!.room.leave(true);
          bots[7]!.closed = 1000;
          await wait(2000);
          disconnectTest = { done: true, othersKept: bots.slice(1, 7).every((b, i) => b.snapshots > before[i]! + 30 && b.closed === 0) };
        }
        const now = world.tick;
        const cpu = process.cpuUsage(cpuPrev);
        cpuPrev = process.cpuUsage();
        const mem = process.memoryUsage();
        const rtts = bots.flatMap((b) => b.rtt.splice(0));
        samples.push({
          s, hz: now - lastTick, rssMB: +(mem.rss / 1e6).toFixed(1), heapMB: +(mem.heapUsed / 1e6).toFixed(1),
          cpuPct: +(((cpu.user + cpu.system) / 1e6) * 100).toFixed(1),
          stepP95: +pct(steps.splice(0), 0.95).toFixed(3), rttP50: +pct(rtts, 0.5).toFixed(1), rttP95: +pct(rtts, 0.95).toFixed(1),
          pieces: world.building.state.pieces.size, players: world.players.size, zombies: world.zombies.alive, planes: world.round.snapshot().planes.length, air: [...world.players.values()].filter((p) => world.round.airMode(p.id) !== 0).length, phase: ['waiting', 'countdown', 'running', 'finished'].indexOf(world.round.phase),
        });
        lastTick = now;
      }
    } finally {
      clearInterval(input);
      clearInterval(ping);
    }
    const disconnects = bots.filter((b) => b.closed !== 0 && b.i !== 7).length;
    const hz = samples.map((x) => x.hz!);
    const heap = samples.map((x) => x.heapMB!);
    const minute = (m: number) => samples.filter((x) => x.s! > (m - 1) * 60 && x.s! <= m * 60);
    const avg = (a: number[]) => a.reduce((p, c) => p + c, 0) / Math.max(1, a.length);
    const report = {
      seconds: SECONDS, rounds, rematches, disconnects, disconnectTest,
      hzAvg: +avg(hz).toFixed(2), hzMin: Math.min(...hz), stepP95Max: Math.max(...samples.map((x) => x.stepP95!)),
      rttP50: +avg(samples.map((x) => x.rttP50!)).toFixed(1), rttP95Max: Math.max(...samples.map((x) => x.rttP95!)),
      cpuPctAvg: +avg(samples.map((x) => x.cpuPct!)).toFixed(1), cpuTotalS: +((process.cpuUsage(cpu0).user + process.cpuUsage(cpu0).system) / 1e6).toFixed(1),
      rssStartMB: samples[0]?.rssMB, rssEndMB: samples.at(-1)?.rssMB, rssMaxMB: Math.max(...samples.map((x) => x.rssMB!)),
      heapFirstMinMB: +avg(minute(2).map((x) => x.heapMB!)).toFixed(1), heapLastMinMB: +avg(samples.slice(-60).map((x) => x.heapMB!)).toFixed(1), heapMaxMB: Math.max(...heap),
      zombiesMax: Math.max(...samples.map((x) => x.zombies!)), zombiesAt8: samples.filter((x) => x.zombies === 8).length, secondsWithPlanes: samples.filter((x) => x.planes! > 0).length,
      piecesMax: Math.max(...samples.map((x) => x.pieces!)), piecesAt128: samples.filter((x) => x.pieces === 128).length,
      wallSeconds: +((performance.now() - t0) / 1000).toFixed(1),
    };
    if (process.env.BR_SOAK12_OUT) writeFileSync(process.env.BR_SOAK12_OUT, JSON.stringify({ report, samples }, null, 1));
    console.log('SOAK12', JSON.stringify(report));
    expect(disconnects).toBe(0);
    expect(report.hzAvg).toBeGreaterThan(29.5);
    expect(report.piecesMax).toBeGreaterThanOrEqual(64);
    expect(report.zombiesMax).toBe(8);
    if (disconnectTest.done) expect(disconnectTest.othersKept).toBe(true);
    for (const b of bots) if (b.closed === 0) await b.room.leave(true).catch(() => undefined);
  }, (SECONDS + 120) * 1000);
});
