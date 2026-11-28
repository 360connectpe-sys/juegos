import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { createServer } from '../server/index';
import type { BrothersRoom } from '../server/BrothersRoom';
import { BUILD_KINDS, type BuildingSnapshot, type BuildRequest } from '@shared/building/BuildingState';
import { PROTOCOL_VERSION, ROOM_NAME } from '@shared/protocol';
import { Buttons, emptyInput } from '@shared/types';
import { terrainHeight } from '@shared/world/terrain';
import type { WebSocketClient } from '@colyseus/ws-transport';
import { BattleRound } from '@shared/battle/BattleRound';
// Estas pruebas cubren sistemas ajenos al avión (fase 12): la ronda empieza en tierra como antes.
BattleRound.defaultTransport = false;
const port = 33000 + Math.floor(Math.random() * 1000);
let server: ReturnType<typeof createServer>;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
beforeAll(async () => { server = createServer();await server.listen(port, '127.0.0.1'); });
afterAll(async () => { await server.gracefullyShutdown(false); });
it('ocho jugadores recolectan, construyen, disparan y destruyen, y reconectan conservando madera', async () => {
  const clients: { sdk: Room; snapshot: BuildingSnapshot | null }[] = [];
  const timings: number[] = [];
  const placements: number[] = [];
  try {
    for (let i = 0; i < 8; i++) {
      const sdk = await new Client(`ws://127.0.0.1:${port}`).joinOrCreate(ROOM_NAME, { protocol: PROTOCOL_VERSION, name: 'Constructor'+i, code: 'BUILD8' });
      const record = { sdk, snapshot: null as BuildingSnapshot | null };
      sdk.onMessage('building', (s: BuildingSnapshot) => { record.snapshot = s; });
      sdk.onMessage('welcome', (m: { building: BuildingSnapshot }) => { record.snapshot = m.building; });
      sdk.reconnection.minUptime = 0; // Fixture corta: no depender de los 5 s mínimos del SDK.
      sdk.onMessage('*', () => undefined); sdk.send('ready');clients.push(record);
    }
    const room = matchMaker.getLocalRoomById(clients[0]!.sdk.roomId) as BrothersRoom;
    const world = room.world;
    world.round.start();await wait(80);
    const place = world.building.state.place.bind(world.building.state);
    vi.spyOn(world.building.state, 'place').mockImplementation((...args) => {
      const start = performance.now(); const result = place(...args); placements.push(performance.now() - start); return result;
    });
    const original = world.step.bind(world);
    vi.spyOn(world, 'step').mockImplementation(() => { const t = performance.now();original();timings.push(performance.now()-t); });
    for (let i = 0; i < 8; i++) {
      const t = world.layout.trees[i]!;
      world.players.get(clients[i]!.sdk.sessionId)!.body.teleport({ x: t.x, y: t.y, z: t.z+1 });
    }
    let seq = 0;
    const run = async (ticks: number, pitch: (i: number) => number = () => 0) => {
      for (let tick = 0; tick < ticks; tick++) {
        seq++;
        clients.forEach((c,i) => c.sdk.send('input', { ...emptyInput(seq), buttons: Buttons.FIRE | Buttons.AIM, aimYaw: Math.PI, aimPitch: pitch(i) }));
        await wait(1000/30);
      }
    };
    await run(145);
    for (const c of clients) expect(world.building.state.wood.get(c.sdk.sessionId)).toBe(30);
    expect(world.building.state.trees.slice(0,8)).toEqual(Array(8).fill(0));
    const placed: BuildRequest[] = [];
    for (let i = 0; i < 8; i++) {
      const c = clients[i]!, p = world.players.get(c.sdk.sessionId)!;
      let candidate: BuildRequest | null = null;
      for (let z = -24; z <= 24 && !candidate; z+=3) for (let x = -24; x<=24 && !candidate; x+=3) {
        if (placed.some(r => Math.hypot(r.x-x,r.z-z)<7.5)) continue;
        const r: BuildRequest = { kind: BUILD_KINDS[i%4]!, x, z, y: terrainHeight(x,z,world.layout.terrain), rotation: 0 };
        if (world.building.state.canPlace(p.id,r,{ x,y:r.y,z:z+5 })) candidate=r;
      }
      expect(candidate, 'Debe haber suelo libre para la fixture').not.toBeNull();
      const r=candidate!;
      p.body.teleport({ x:r.x,y:r.y+0.02,z:r.z+5 });
      placed.push(r);
    }
    clients.forEach((c, i) => c.sdk.send('build', placed[i]!));
    for (let tick = 0; tick < 100 && world.building.state.pieces.size !== 8; tick++) await wait(10);
    expect(world.building.state.pieces.size).toBe(8);
    for (const c of clients) expect(world.building.state.wood.get(c.sdk.sessionId)).toBe(20);
    // Campos añadidos por el cliente no editan ni regalan madera.
    clients[0]!.sdk.send('build',{ ...placed[0], wood:999, hp:999, id:1, owner:'otro' });
    await wait(80);
    expect(world.building.state.wood.get(clients[0]!.sdk.sessionId)).toBe(20);
    const reconnecting = clients[7]!;
    let recovered = false;
    reconnecting.sdk.onReconnect(() => { recovered = true; reconnecting.sdk.send('ready'); });
    (room.clients.find(c=>c.sessionId===reconnecting.sdk.sessionId) as WebSocketClient).ref.terminate();
    for(let i=0;i<500 && !recovered;i++)await wait(10);
    expect(recovered).toBe(true);
    expect(world.players.get(reconnecting.sdk.sessionId)?.connected).toBe(true);
    await wait(100);
    expect(world.building.state.wood.get(reconnecting.sdk.sessionId)).toBe(20);
    for(const c of clients)world.giveBenchLoadout(c.sdk.sessionId,0);
    await run(170, i => Math.atan2((placed[i]!.kind==='floor'?0.1:placed[i]!.kind==='roof'?0.9:1.5)-1.4,5));
    expect(world.building.state.pieces.size).toBe(0);
    await wait(100);
    for(const c of clients)expect(c.snapshot?.pieces).toHaveLength(0);
    const sorted=timings.sort((a,b)=>a-b);
    console.log('PHASE7_8',JSON.stringify({ticks:timings.length,p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:sorted.at(-1),remainingPieces:world.building.state.pieces.size,maxPlacementMs:Math.max(...placements),players:world.players.size}));
  } finally { vi.restoreAllMocks();await Promise.all(clients.map(c=>c.sdk.leave(true))); }
}, 25000);
