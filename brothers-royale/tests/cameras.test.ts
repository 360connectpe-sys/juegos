import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  applyLook,
  forwardFromYaw,
  hideOwnAvatar,
  isoAimYaw,
  moveToWorld,
  pitchLimits,
  resolveCameraDistance,
  smoothCameraDistance,
  thirdPersonDirection,
} from '@/engine/camera/cameraMath';
import { IsometricCamera } from '@/engine/IsometricCamera';
import { CameraController } from '@/game/camera/CameraController';
import { CharacterBody } from '@/physics/CharacterBody';
import { loadRapier, PhysicsWorld, type Rapier } from '@/physics/PhysicsWorld';
import { PredictionController } from '@/net/Prediction';
import { ServerWorld } from '../server/ServerWorld';
import { CAMERA_RIG, SIMULATION } from '@shared/constants';
import { isValidPlayerInput } from '@shared/inputValidation';
import { screenToWorld } from '@shared/movement';
import { emptyInput, type PlayerInput } from '@shared/types';
import { worldColliders } from '@shared/world/colliders';
import { generateWorldLayout } from '@shared/world/layout';
import { HOUSE } from '@shared/world/structures';

describe('matemática de cámaras', () => {
  it('isométrica conserva exactamente la conversión de siempre', () => {
    for (const [x, y] of [[0, 1], [1, 0], [0.3, -0.7], [1, 1]] as const) expect(moveToWorld(x, y, 'isometric', 123)).toEqual(screenToWorld(x, y));
  });
  it('3ª/1ª persona: adelante = hacia donde mira la cámara, derecha = su derecha', () => {
    const f0 = moveToWorld(0, 1, 'third', 0);
    expect(f0.x).toBeCloseTo(0);
    expect(f0.y).toBeCloseTo(1); // yaw 0 → +Z
    const r0 = moveToWorld(1, 0, 'first', 0);
    expect(r0.x).toBeCloseTo(-1); // mirando a +Z, la derecha es -X
    const f90 = moveToWorld(0, 1, 'third', Math.PI / 2);
    expect(f90.x).toBeCloseTo(1);
    const diag = moveToWorld(1, 1, 'third', 0.7);
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(1);
    const half = moveToWorld(0, 0.5, 'first', 2);
    expect(Math.hypot(half.x, half.y)).toBeCloseTo(0.5);
  });
  it('el yaw de cámara usa la misma convención que el personaje', () => {
    const f = forwardFromYaw(1.1);
    expect(Math.atan2(f.x, f.y)).toBeCloseTo(1.1);
  });
  it('la mirada se limita en vertical, da la vuelta en horizontal e ignora valores no finitos', () => {
    const s = { yaw: Math.PI - 0.1, pitch: 0 };
    applyLook(s, 0.2, 10, 'third');
    expect(s.yaw).toBeCloseTo(-Math.PI + 0.1);
    expect(s.pitch).toBe(pitchLimits('third').max);
    applyLook(s, 0, -10, 'first');
    expect(s.pitch).toBe(pitchLimits('first').min);
    applyLook(s, Number.NaN, Infinity, 'first');
    expect(Number.isFinite(s.yaw) && Number.isFinite(s.pitch)).toBe(true);
  });
  it('la cámara de 3ª persona va detrás del personaje y sube al inclinarse', () => {
    const d = thirdPersonDirection(0, 0);
    expect(d.z).toBeCloseTo(-1);
    expect(thirdPersonDirection(0, 0.5).y).toBeGreaterThan(0.4);
  });
  it('colisión: se acerca justo antes del obstáculo, nunca más allá del mínimo, y se aleja suave', () => {
    expect(resolveCameraDistance(4, null, 0.3, 0.5)).toBe(4);
    expect(resolveCameraDistance(4, 10, 0.3, 0.5)).toBe(4);
    expect(resolveCameraDistance(4, 2, 0.3, 0.5)).toBeCloseTo(1.7);
    expect(resolveCameraDistance(4, 0.1, 0.3, 0.5)).toBe(0.5);
    expect(smoothCameraDistance(4, 1, 1 / 60)).toBe(1); // acercarse: inmediato
    const out = smoothCameraDistance(1, 4, 1 / 60);
    expect(out).toBeGreaterThan(1);
    expect(out).toBeLessThan(4); // alejarse: suave
  });
  it('avatar propio: oculto en 1ª persona y con la cámara pegada; visible en isométrica', () => {
    expect(hideOwnAvatar('first', 4)).toBe(true);
    expect(hideOwnAvatar('third', 0.3)).toBe(true);
    expect(hideOwnAvatar('third', 1)).toBe(true); // pegada a una pared: el avatar taparía la vista
    expect(hideOwnAvatar('third', 3)).toBe(false);
    expect(hideOwnAvatar('isometric', 0)).toBe(false);
  });
  it('apuntado isométrico desde un stick de pantalla', () => {
    expect(isoAimYaw(0.05, 0.05)).toBeNull();
    const up = screenToWorld(0, 1);
    expect(isoAimYaw(0, 1)).toBeCloseTo(Math.atan2(up.x, up.y));
  });
});

let R: Rapier;
beforeAll(async () => {
  R = await loadRapier();
});
const layout = generateWorldLayout();
const house = layout.structures.find((s) => s.def.id === 'house')!;
const makePhysics = () => {
  const p = new PhysicsWorld(R);
  p.addTerrain(layout.terrain);
  worldColliders(layout).forEach((c) => p.addStatic(c));
  p.step();
  return p;
};

describe('CameraController con colisiones reales (Rapier)', () => {
  it('en campo abierto la cámara de 3ª persona queda a su distancia', () => {
    const physics = makePhysics();
    const c = new CameraController(new IsometricCamera(16 / 9), (o, d, m, r) => physics.castCameraSphere(o, d, m, r));
    c.setMode('third', 0);
    const feet = new Vector3(-30, 0, -30);
    feet.y = physics.groundHeightAt(feet.x, feet.z) ?? 0;
    c.look.pitch = 0.1;
    c.update(feet, 0, 0, 0);
    expect(c.distance).toBeGreaterThan(CAMERA_RIG.thirdDistance - 0.2);
    physics.dispose();
  });
  it('de espaldas a una pared, la cámara no la atraviesa', () => {
    const physics = makePhysics();
    const c = new CameraController(new IsometricCamera(16 / 9), (o, d, m, r) => physics.castCameraSphere(o, d, m, r));
    c.setMode('third', 0); // mira a +Z: la cámara va hacia -Z, donde está la fachada de la casa
    const wallZ = house.z + HOUSE.depth / 2;
    const feet = new Vector3(house.x + 3, 0, wallZ + 1.2);
    c.look.pitch = 0.1;
    c.update(feet, 0, 0, 0);
    expect(c.lastHit).not.toBeNull();
    expect(c.distance).toBeLessThan(CAMERA_RIG.thirdDistance);
    expect(c.perspective.position.z).toBeGreaterThan(wallZ + 0.1); // sigue fuera de la casa
    physics.dispose();
  });
  it('1ª persona: cámara a la altura de los ojos y avatar oculto; isométrica usa la ortográfica', () => {
    const c = new CameraController(new IsometricCamera(1));
    expect(c.camera).toBe((c as unknown as { iso: IsometricCamera }).iso.camera);
    c.setMode('first', 0.5);
    c.update(new Vector3(1, 2, 3), 0, 0, 1 / 60);
    expect(c.perspective.position.y).toBeCloseTo(2 + CAMERA_RIG.eyeHeight);
    expect(c.hideAvatar).toBe(true);
    expect(c.yaw).toBeCloseTo(0.5);
    c.addLook(0.3, 0);
    expect(c.yaw).toBeCloseTo(0.8);
    c.setMode('isometric');
    c.addLook(1, 1); // en isométrica la mirada no gira la cámara
    expect(c.yaw).toBeCloseTo(0.8);
  });
});

describe('la perspectiva no altera la física ni la sincronización', () => {
  /** Entradas de 2 s caminando "adelante" según una perspectiva y un yaw de cámara. */
  const inputsFor = (mode: 'isometric' | 'third' | 'first', yaw: number, from = 1): PlayerInput[] =>
    Array.from({ length: 60 }, (_, i) => {
      const w = moveToWorld(0.3, 1, mode, yaw);
      return { ...emptyInput(from + i), moveX: w.x, moveZ: w.y, buttons: mode === 'first' ? 16 : 0, aimYaw: yaw };
    });

  it('la misma dirección en el mundo produce exactamente la misma simulación', () => {
    // La "arriba" isométrica equivale a mirar con yaw = atan2(up) en 3ª persona.
    const up = screenToWorld(0.3, 1);
    const w = moveToWorld(0.3, 1, 'third', 0);
    expect(Math.hypot(w.x, w.y)).toBeCloseTo(Math.hypot(up.x, up.y));
    const yaw = Math.atan2(up.x, up.y) - Math.atan2(w.x, w.y);
    const a = moveToWorld(0.3, 1, 'third', yaw);
    expect(a.x).toBeCloseTo(up.x, 12);
    expect(a.y).toBeCloseTo(up.y, 12);
    const run = (inputs: PlayerInput[]) => {
      const physics = makePhysics();
      const body = new CharacterBody(physics, 'p', 'P', { x: layout.spawn.x, y: 0.1, z: layout.spawn.z });
      for (const i of inputs) {
        body.step({ ...i, buttons: 0, aimYaw: 0 });
        physics.step();
      }
      const pos = { ...body.state.position };
      physics.dispose();
      return pos;
    };
    const iso = run(inputsFor('isometric', 0));
    const third = run(inputsFor('third', yaw));
    expect(third.x).toBeCloseTo(iso.x, 4);
    expect(third.z).toBeCloseTo(iso.z, 4);
  });

  it('en cualquier perspectiva las entradas son válidas y el cliente coincide con el servidor', async () => {
    const world = await ServerWorld.create();
    world.addPlayer('s1', 'Ana');
    const welcome = world.takeCorrection('s1')!;
    const physics = makePhysics();
    const body = new CharacterBody(physics, 's1', 'Ana', welcome.position);
    body.restore(welcome);
    const pred = new PredictionController(body, SIMULATION.fixedDt);
    const inputs = [...inputsFor('first', 2.1, 1), ...inputsFor('third', -0.8, 61), ...inputsFor('isometric', 0, 121)];
    for (const input of inputs) {
      expect(isValidPlayerInput(input, input.seq - 1)).toBe(true);
      pred.predict(input);
      physics.step();
      world.queueInput('s1', input);
      world.step();
      const c = world.takeCorrection('s1');
      if (c) pred.reconcile(c, c.lastProcessedSeq);
    }
    for (let i = 0; i < 5; i++) world.step();
    const c = world.takeCorrection('s1');
    if (c) pred.reconcile(c, c.lastProcessedSeq);
    expect(body.snapshot()).toEqual(world.players.get('s1')!.body.snapshot());
    physics.dispose();
    world.dispose();
  });
});
