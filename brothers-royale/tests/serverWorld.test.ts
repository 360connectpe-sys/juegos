import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ServerWorld } from '../server/ServerWorld';
import { CharacterBody } from '@/physics/CharacterBody';
import { loadRapier, PhysicsWorld } from '@/physics/PhysicsWorld';
import { PredictionController } from '@/net/Prediction';
import { SIMULATION } from '@shared/constants';
import { unpackPlayers } from '@shared/netcodec';
import { NET } from '@shared/protocol';
import { Buttons, emptyInput, type PlayerInput } from '@shared/types';
import { worldColliders } from '@shared/world/colliders';

let world: ServerWorld;
beforeEach(async () => {
  world = await ServerWorld.create();
});
afterEach(() => world.dispose());

const walk = (seq: number, buttons = 0): PlayerInput => ({ ...emptyInput(seq), moveX: Math.SQRT1_2, moveZ: Math.SQRT1_2, buttons });

describe('ServerWorld (simulación autoritativa, sin red)', () => {
  it('asigna identidades únicas y puntos de aparición distintos', () => {
    const a = world.addPlayer('s1', 'Ana');
    const b = world.addPlayer('s2', 'Beto');
    expect(a.netId).not.toBe(b.netId);
    expect(a.color).not.toBe(b.color);
    expect(() => world.addPlayer('s1', 'Otra')).toThrow();
    const pa = a.body.state.position;
    const pb = b.body.state.position;
    expect(Math.hypot(pa.x - pb.x, pa.z - pb.z)).toBeGreaterThan(2);
    expect(a.body.state.grounded).toBe(true);
    world.removePlayer('s1');
    expect(world.addPlayer('s3', 'Caro').netId).toBe(a.netId); // reutiliza el hueco
  });

  it('valida, encola y procesa una entrada por tick (anti speed-hack)', () => {
    const p = world.addPlayer('s1', 'Ana');
    expect(world.queueInput('nadie', walk(1))).toBe('unknown-player');
    expect(world.queueInput('s1', { ...walk(1), moveX: Number.NaN })).toBe('invalid');
    expect(world.queueInput('s1', { ...walk(1), extra: 'x' })).toBe('queued');
    expect(p.queue[0]).not.toHaveProperty('extra');
    expect(world.queueInput('s1', walk(1))).toBe('invalid'); // secuencia repetida
    for (let s = 2; s <= NET.maxQueuedInputs; s++) expect(world.queueInput('s1', walk(s))).toBe('queued');
    expect(world.queueInput('s1', walk(999))).toBe('dropped');
    // Ráfaga de 12 entradas: como mucho maxInputsPerTick por tick y 1 de media.
    world.step();
    expect(p.body.state.lastProcessedSeq).toBeLessThanOrEqual(NET.maxInputsPerTick);
    for (let i = 0; i < 4; i++) world.step();
    expect(p.body.state.lastProcessedSeq).toBeLessThanOrEqual(NET.maxInputsPerTick + 4);
  });

  it('sin entradas aplica la gravedad tras unos ticks y marca la corrección', () => {
    const p = world.addPlayer('s1', 'Ana');
    world.takeCorrection('s1');
    p.body.teleport({ x: p.body.state.position.x, y: 6, z: p.body.state.position.z });
    for (let i = 0; i < NET.idleAfterTicks - 1; i++) world.step();
    expect(p.body.state.position.y).toBe(6);
    expect(world.takeCorrection('s1')).toBeNull();
    for (let i = 0; i < 40; i++) world.step();
    expect(p.body.state.grounded).toBe(true);
    expect(p.body.state.position.y).toBeLessThan(1);
    expect(world.takeCorrection('s1')!.lastProcessedSeq).toBe(0);
  });

  it('snapshot público con todos los jugadores y corrección privada solo si cambió', () => {
    const a = world.addPlayer('s1', 'Ana');
    world.addPlayer('s2', 'Beto');
    world.takeCorrection('s1');
    world.takeCorrection('s2');
    world.queueInput('s1', walk(1));
    world.step();
    const snap = world.snapshot();
    expect(snap.tick).toBe(world.tick);
    expect(unpackPlayers(snap.p)).toHaveLength(2);
    expect(world.takeCorrection('s1')!.lastProcessedSeq).toBe(1);
    expect(world.takeCorrection('s1')).toBeNull();
    expect(world.takeCorrection('s2')).toBeNull();
    expect(world.roster().map((r) => r.name)).toEqual(['Ana', 'Beto']);
    expect(world.rosterEntry(a).netId).toBe(a.netId);
  });

  it('cliente predictivo + servidor: tras reconciliar, el cliente coincide exactamente', async () => {
    const p = world.addPlayer('s1', 'Ana');
    const welcome = world.takeCorrection('s1')!;
    // Cliente: su propio mundo físico con el mismo mapa.
    const R = await loadRapier();
    const physics = new PhysicsWorld(R);
    physics.addTerrain(world.layout.terrain);
    worldColliders(world.layout).forEach((c) => physics.addStatic(c));
    const body = new CharacterBody(physics, 's1', 'Ana', welcome.position);
    body.restore(welcome);
    const pred = new PredictionController(body, SIMULATION.fixedDt);
    // 60 entradas; el servidor las recibe con 3 ticks de retraso.
    const inputs = Array.from({ length: 60 }, (_, i) => walk(i + 1, i === 10 ? Buttons.JUMP : i > 30 ? Buttons.SPRINT : 0));
    const inFlight: PlayerInput[] = [];
    for (const input of inputs) {
      pred.predict(input);
      physics.step();
      inFlight.push(input);
      if (inFlight.length > 3) world.queueInput('s1', inFlight.shift()!);
      world.step();
      const corr = world.takeCorrection('s1');
      if (corr) pred.reconcile(corr, corr.lastProcessedSeq);
    }
    inFlight.forEach((i) => world.queueInput('s1', i));
    for (let i = 0; i < 5; i++) world.step();
    const corr = world.takeCorrection('s1')!;
    pred.reconcile(corr, corr.lastProcessedSeq);
    expect(pred.history.size).toBe(0);
    expect(body.state.position).toEqual(p.body.state.position);
    expect(body.snapshot()).toEqual(p.body.snapshot());
    physics.dispose();
  });
});
