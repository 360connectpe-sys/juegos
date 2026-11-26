import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../server/index';
import { OnlineSession, type OnlineInfo } from '@/net/OnlineSession';
import { loadRapier, PhysicsWorld } from '@/physics/PhysicsWorld';
import { SIMULATION } from '@shared/constants';
import { screenToWorld } from '@shared/movement';
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
