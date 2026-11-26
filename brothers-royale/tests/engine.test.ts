import { describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { EventBus } from '@/core/EventBus';
import { AdaptiveResolution } from '@/engine/AdaptiveResolution';
import { FixedStepLoop } from '@/engine/FixedStepLoop';
import { computeFrustum, IsometricCamera, lookAheadTarget } from '@/engine/IsometricCamera';
import { CAMERA } from '@shared/constants';
import { buildQuality, detectQuality, pickTier, readQualityOverride } from '@/engine/quality';
import { ISO_SCREEN_RIGHT, ISO_SCREEN_UP } from '@shared/movement';

describe('calidad', () => {
  const desktop = { devicePixelRatio: 2, isTouch: false, shortSide: 1080, hardwareConcurrency: 8, deviceMemory: 8 };
  const phone = { devicePixelRatio: 3, isTouch: true, shortSide: 390, hardwareConcurrency: 8, deviceMemory: 4 };
  const weak = { devicePixelRatio: 2, isTouch: true, shortSide: 360, hardwareConcurrency: 4, deviceMemory: 2 };
  it('elige nivel por dispositivo', () => {
    expect(pickTier(desktop)).toBe('high');
    expect(pickTier(phone)).toBe('medium');
    expect(pickTier(weak)).toBe('low');
  });
  it('limita el pixel ratio en móvil y apaga sombras en bajo', () => {
    expect(detectQuality(phone).pixelRatio).toBe(1.5);
    expect(detectQuality(weak).shadows).toBe(false);
    expect(buildQuality('high', 1).pixelRatio).toBe(1);
    expect(detectQuality(desktop, 'low').tier).toBe('low');
  });
  it('lee ?q= de la URL', () => {
    expect(readQualityOverride('?q=low')).toBe('low');
    expect(readQualityOverride('?q=ultra')).toBeNull();
  });
});

describe('FixedStepLoop', () => {
  it('ejecuta ticks fijos y acumula el resto', () => {
    const step = vi.fn();
    const render = vi.fn();
    const loop = new FixedStepLoop(0.1, { step, render });
    loop.advance(0.25);
    expect(step).toHaveBeenCalledTimes(2);
    expect(render.mock.calls[0]![0]).toBeCloseTo(0.5);
    loop.advance(0.06);
    expect(step).toHaveBeenCalledTimes(3);
  });
  it('limita frames enormes (pestaña en segundo plano)', () => {
    const step = vi.fn();
    const loop = new FixedStepLoop(1 / 30, { step, render: () => undefined });
    loop.advance(10);
    expect(step.mock.calls.length).toBeLessThanOrEqual(8);
  });
});

describe('AdaptiveResolution', () => {
  it('baja la resolución si los FPS son bajos y la recupera con margen', () => {
    const a = new AdaptiveResolution({ min: 0.6, max: 1.5, window: 1, step: 0.1 });
    for (let i = 0; i < 25; i++) a.update(1 / 25);
    expect(a.pixelRatio).toBeCloseTo(1.4);
    for (let k = 0; k < 20; k++) for (let i = 0; i < 25; i++) a.update(1 / 25);
    expect(a.pixelRatio).toBeCloseTo(0.6);
    for (let k = 0; k < 40; k++) for (let i = 0; i < 60; i++) a.update(1 / 60);
    expect(a.pixelRatio).toBeCloseTo(1.5);
  });
});

describe('cámara isométrica', () => {
  it('mantiene la altura en horizontal y el ancho mínimo en vertical', () => {
    expect(computeFrustum(16 / 9, 20, 15).halfHeight).toBe(10);
    const portrait = computeFrustum(9 / 19.5, 20, 15);
    expect(portrait.halfWidth * 2).toBeCloseTo(15);
  });
  it('"arriba" y "derecha" de pantalla coinciden con la proyección de la cámara', () => {
    const iso = new IsometricCamera(1);
    iso.snapTo(new Vector3(0, 0, 0));
    iso.camera.updateMatrixWorld();
    const project = (x: number, z: number) => new Vector3(x, 0, z).project(iso.camera);
    const up = project(ISO_SCREEN_UP.x * 5, ISO_SCREEN_UP.y * 5);
    expect(up.y).toBeGreaterThan(0.1);
    expect(Math.abs(up.x)).toBeLessThan(1e-6);
    const right = project(ISO_SCREEN_RIGHT.x * 5, ISO_SCREEN_RIGHT.y * 5);
    expect(right.x).toBeGreaterThan(0.1);
    expect(Math.abs(right.y)).toBeLessThan(1e-6);
  });
});

describe('seguimiento de cámara', () => {
  it('adelanta en la dirección de la velocidad con límite', () => {
    expect(lookAheadTarget(0, 0, 0, 0)).toEqual({ x: 0, z: 0 });
    expect(lookAheadTarget(1, 1, 2, 0).x).toBeCloseTo(1 + 2 * CAMERA.lookAhead);
    const far = lookAheadTarget(0, 0, 100, 0);
    expect(far.x).toBeCloseTo(CAMERA.maxLookAhead);
  });
  it('converge al jugador y el zoom respeta los límites', () => {
    const iso = new IsometricCamera(16 / 9);
    const p = new Vector3(10, 2, -4);
    for (let i = 0; i < 120; i++) iso.follow(p, 0, 0, 1 / 60);
    expect(iso.focus.x).toBeCloseTo(10, 1);
    expect(iso.focus.y).toBeCloseTo(2, 1);
    iso.addZoom(10);
    for (let i = 0; i < 120; i++) iso.follow(p, 0, 0, 1 / 60);
    expect(iso.zoom).toBeLessThanOrEqual(CAMERA.maxZoom);
    expect(iso.zoom).toBeGreaterThan(CAMERA.maxZoom - 0.05);
  });
});

describe('EventBus', () => {
  it('emite, cancela suscripciones y limpia', () => {
    const bus = new EventBus<{ a: number }>();
    const fn = vi.fn();
    const off = bus.on('a', fn);
    bus.emit('a', 1);
    off();
    bus.emit('a', 2);
    expect(fn).toHaveBeenCalledExactlyOnceWith(1);
  });
});
