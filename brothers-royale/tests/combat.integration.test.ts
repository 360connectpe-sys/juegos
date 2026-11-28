import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchMaker } from '@colyseus/core';
import type { Room } from '@colyseus/sdk';
import { createServer } from '../server/index';
import type { BrothersRoom } from '../server/BrothersRoom';
import { OnlineSession } from '@/net/OnlineSession';
import type { ClientCombatEvent } from '@/net/CombatView';
import { loadRapier, PhysicsWorld } from '@/physics/PhysicsWorld';
import { SIMULATION } from '@shared/constants';
import { unpackGear } from '@shared/combat/gear';
import { EYE_HEIGHT, HEALTH } from '@shared/combat/weapons';
import { addItem, magOf } from '@shared/inventory';
import { Buttons, emptyInput, type PlayerInput } from '@shared/types';
import { worldColliders } from '@shared/world/colliders';
import { generateWorldLayout } from '@shared/world/layout';
import { terrainHeight } from '@shared/world/terrain';

const PORT = 32070 + Math.floor(Math.random() * 300);
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
  events: ClientCombatEvent[];
  seq: number;
}

/**
 * Latencia simulada en lo que envía el cliente: retardo base + jitter,
 * conservando el orden (WebSocket/TCP nunca reordena).
 */
function addLatency(session: OnlineSession, baseMs: number, jitterMs: number, seed: number) {
  const room = (session as unknown as { room: Room }).room;
  const send = room.send.bind(room);
  let last = 0;
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  (room as unknown as { send: Room['send'] }).send = ((type: string, msg?: unknown) => {
    const at = Math.max(last, Date.now() + baseMs + (rnd() * 2 - 1) * jitterMs);
    last = at;
    setTimeout(() => send(type, msg), at - Date.now());
  }) as Room['send'];
}

async function makeClient(name: string, code: string): Promise<TestClient> {
  const physics = new PhysicsWorld(await loadRapier());
  physics.addTerrain(layout.terrain);
  worldColliders(layout).forEach((c) => physics.addStatic(c));
  const session = await OnlineSession.connect({ url: URL, name, code, physics, seed: layout.seed, chests: layout.chests });
  const c: TestClient = { session, physics, events: [], seq: 0 };
  session.onCombatEvent = (e) => c.events.push(e);
  return c;
}

/** Un claro sin árboles ni edificios en `radius` metros (determinista para el mapa de prueba). */
function clearing(radius: number): { x: number; z: number } {
  // Fase 12: edificios más grandes → se usa el radio libre real de cada prefab y una rejilla más fina.
  const blocked = [...layout.trees.map((t) => ({ x: t.x, z: t.z, r: 1.5 })), ...layout.structures.map((p) => ({ x: p.x, z: p.z, r: Math.min(7, p.def.clearRadius) }))];
  for (let x = -48; x <= 48; x += 1.5)
    for (let z = -48; z <= 48; z += 1.5) {
      if (blocked.every((b) => Math.hypot(b.x - x, b.z - z) > radius + b.r) && Math.abs(terrainHeight(x, z, layout.terrain) - terrainHeight(x + radius, z, layout.terrain)) < 0.6 && terrainHeight(x, z, layout.terrain) > 0)
        return { x, z };
    }
  throw new Error('Sin claro en el mapa de prueba');
}

const roomOf = (c: TestClient) => matchMaker.getLocalRoomById((c.session as unknown as { room: Room }).room.roomId) as BrothersRoom;

function arm(room: BrothersRoom, id: string) {
  let inv = room.world.match.inventory(id)!;
  inv = addItem(inv, { kind: 'rifle', qty: 1, rarity: 'common' }).inventory;
  inv = addItem(inv, { kind: 'ammo_medium', qty: 60 }).inventory;
  room.world.match.setInventory(id, inv);
  room.world.selectSlot(id, 1);
}

/** Apunta desde los ojos PREDICHOS del cliente al pecho del objetivo tal como lo ve (interpolado). */
function aimAt(c: TestClient, targetId: string, input: PlayerInput): void {
  const me = c.session.localPlayer().position;
  const t = c.session.players().find((p) => p.id === targetId);
  if (!t) return;
  const dx = t.position.x - me.x;
  const dy = t.position.y + 1.0 - (me.y + EYE_HEIGHT);
  const dz = t.position.z - me.z;
  input.aimYaw = Math.atan2(dx, dz);
  input.aimPitch = Math.atan2(dy, Math.hypot(dx, dz));
}

describe('combate en línea con 8 jugadores y latencia simulada', () => {
  it('8 clientes se disparan en anillo: daño autoritativo coherente en todos los clientes', async () => {
    const clients: TestClient[] = [];
    for (let i = 0; i < 8; i++) clients.push(await makeClient(`P${i}`, 'PVP8'));
    clients.forEach((c, i) => addLatency(c.session, 60 + (i % 4) * 25, 25, i + 1));
    const room = roomOf(clients[0]!);
    room.world.round.start();await wait(80);
    expect(room.world.players.size).toBe(8);
    const center = clearing(6.5);
    const ids = clients.map((c) => c.session.localPlayerId);
    ids.forEach((id, i) => {
      const a = (i / 8) * Math.PI * 2;
      const x = center.x + Math.cos(a) * 6;
      const z = center.z + Math.sin(a) * 6;
      room.world.players.get(id)!.body.teleport({ x, y: terrainHeight(x, z, layout.terrain) + 0.1, z });
      room.world.players.get(id)!.correctionDirty = true;
      arm(room, id);
    });
    // Asentarse: correcciones, inventarios y desenfundado.
    for (let t = 0; t < 30; t++) {
      clients.forEach((c) => c.session.tick(emptyInput(++c.seq), SIMULATION.fixedDt));
      await wait(1000 / 30);
    }
    // Todos ven el rifle en la mano de los demás (snapshot público).
    const remote = clients[0]!.session.players().find((p) => p.id === ids[3]);
    expect(unpackGear(remote?.gear).held).toBe('rifle');
    // 3 s de fuego: cada uno al siguiente del anillo.
    for (let t = 0; t < 90; t++) {
      clients.forEach((c, i) => {
        const input: PlayerInput = { ...emptyInput(++c.seq), buttons: Buttons.FIRE | Buttons.AIM };
        aimAt(c, ids[(i + 1) % 8]!, input);
        c.session.tick(input, SIMULATION.fixedDt);
      });
      await wait(1000 / 30);
    }
    for (let t = 0; t < 20; t++) {
      clients.forEach((c) => c.session.tick(emptyInput(++c.seq), SIMULATION.fixedDt));
      await wait(1000 / 30);
    }
    const log = room.world.combat.log;
    let dealt = 0;
    let taken = 0;
    for (const id of ids) {
      const s = log.of(id);
      dealt += s.damageDealt;
      taken += s.damageTaken;
      expect(s.hits).toBeGreaterThan(0); // todos aciertan con latencia de 60-135 ms
      // Sin munición infinita: disparos = balas gastadas del cargador + recargas.
      const inv = room.world.match.inventory(id)!;
      expect(s.shots).toBe(30 - magOf(inv.slots[1]!) + (60 - inv.ammo.ammo_medium));
    }
    expect(Math.abs(dealt - taken)).toBeLessThan(1e-6);
    // Ningún impacto supera el máximo por disparo.
    for (const e of log.entries) expect(e.amount).toBeLessThanOrEqual(HEALTH.maxShotDamage);
    // Bajas: cada cliente recibió los mismos eventos de muerte (en el mismo orden).
    const deaths = log.deaths().length;
    expect(deaths).toBeGreaterThan(0);
    for (const c of clients) {
      const seen = c.events.filter((e) => e.type === 'death').map((e) => (e as { victim: string }).victim);
      expect(seen).toEqual(log.deaths().map((d) => d.victim));
      // La salud que muestra cada cliente es la del servidor.
      expect(c.session.combat.vitals.hp).toBe(room.world.combat.hp(c.session.localPlayerId));
      // Daños recibidos: solo los propios (como atacante o víctima).
      for (const e of c.events) if (e.type === 'damage') expect([e.by, e.victim]).toContain(c.session.localPlayerId);
    }
    for (const c of clients) {
      c.session.dispose();
      c.physics.dispose();
    }
  }, 30000);

  it('compensación de latencia: con 150 ms se acierta a un objetivo en movimiento', async () => {
    const shooter = await makeClient('Tirador', 'LAG');
    const target = await makeClient('Blanco', 'LAG');
    addLatency(shooter.session, 150, 20, 7);
    const room = roomOf(shooter);
    room.world.round.start();await wait(80);
    const center = clearing(6.5);
    const place = (c: TestClient, x: number, z: number) => {
      const p = room.world.players.get(c.session.localPlayerId)!;
      p.body.teleport({ x, y: terrainHeight(x, z, layout.terrain) + 0.1, z });
      p.correctionDirty = true;
    };
    place(shooter, center.x - 4, center.z);
    place(target, center.x + 4, center.z);
    arm(room, shooter.session.localPlayerId);
    for (let t = 0; t < 30; t++) {
      for (const c of [shooter, target]) c.session.tick(emptyInput(++c.seq), SIMULATION.fixedDt);
      await wait(1000 / 30);
    }
    // El blanco camina de lado a lado (perpendicular a la línea de tiro) a 5 m/s.
    for (let t = 0; t < 75; t++) {
      target.session.tick({ ...emptyInput(++target.seq), moveZ: Math.floor(t / 20) % 2 ? -1 : 1 }, SIMULATION.fixedDt);
      const input: PlayerInput = { ...emptyInput(++shooter.seq), buttons: t % 9 === 0 ? Buttons.FIRE | Buttons.AIM : Buttons.AIM };
      aimAt(shooter, target.session.localPlayerId, input);
      shooter.session.tick(input, SIMULATION.fixedDt);
      room.world.combat.setHp(target.session.localPlayerId, HEALTH.max); // que no caiga: se mide la puntería
      await wait(1000 / 30);
    }
    await wait(400);
    const s = room.world.combat.log.of(shooter.session.localPlayerId);
    expect(s.shots).toBeGreaterThanOrEqual(6);
    // Sin rebobinado, a 5 m/s y ~250 ms de retraso total el blanco se desplaza >1 m: fallaría casi todo.
    expect(s.hits / s.shots).toBeGreaterThanOrEqual(0.8);
    for (const c of [shooter, target]) {
      c.session.dispose();
      c.physics.dispose();
    }
  }, 20000);
});
