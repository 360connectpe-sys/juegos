import { describe, expect, it, vi } from 'vitest';
import { InstancedMesh, Mesh, Object3D, SkinnedMesh } from 'three';
import { AdaptiveResolution, estimateRefreshHz, quantize } from '@/engine/AdaptiveResolution';
import { ContextLossMonitor, type ContextStatus } from '@/engine/ContextLossMonitor';
import { computeFrustum } from '@/engine/IsometricCamera';
import { buildQuality, detectQuality, normalizeTier, pickTier, readQualityOverride, type QualitySettings } from '@/engine/quality';
import { BlobShadows, PlayerAvatar } from '@/game/entities/PlayerAvatar';
import { createStaticPrefabBatch, PrefabView, visibilityTargets } from '@/game/world/PrefabView';
import { createTrees } from '@/game/world/Trees';
import { CAMERA } from '@shared/constants';
import { generateWorldLayout } from '@shared/world/layout';
import { HOUSE } from '@shared/world/structures';
import type { PlayerState } from '@shared/types';

/** Campos que SOLO afectan al render (lo único que puede variar entre calidades). */
const RENDER_ONLY = new Set<keyof QualitySettings>(['tier', 'pixelRatio', 'minPixelRatio', 'antialias', 'shadows', 'shadowMapSize', 'shadowUpdateInterval', 'blobShadows']);

describe('calidades Baja y Normal', () => {
  it('solo existen dos niveles; los nombres antiguos son alias de Normal', () => {
    expect(normalizeTier('medium')).toBe('normal');
    expect(normalizeTier('high')).toBe('normal');
    expect(buildQuality('high', 2, false).tier).toBe('normal');
    expect(readQualityOverride('?q=baja')).toBe('low');
    expect(readQualityOverride('?q=Normal')).toBe('normal');
    expect(readQualityOverride('?q=medium')).toBe('normal');
    expect(pickTier({ devicePixelRatio: 3, isTouch: true, shortSide: 390, hardwareConcurrency: 8, deviceMemory: 2 })).toBe('low');
  });
  it('solo cambian parámetros de render, nunca de juego', () => {
    const low = buildQuality('low', 3, true);
    const normal = buildQuality('normal', 3, true);
    for (const k of Object.keys(normal) as (keyof QualitySettings)[]) if (low[k] !== normal[k]) expect(RENDER_ONLY.has(k)).toBe(true);
    expect(Object.keys(low).sort()).toEqual(Object.keys(normal).sort());
  });
  it('presupuestos de resolución: Baja ≤ 1, Normal ≤ 1,5 en móvil y ≤ 2 en escritorio; sin MSAA', () => {
    expect(buildQuality('low', 3, true).pixelRatio).toBe(1);
    expect(buildQuality('normal', 3, true).pixelRatio).toBe(1.5);
    expect(buildQuality('normal', 3, false).pixelRatio).toBe(2);
    expect(buildQuality('normal', 1, false).pixelRatio).toBe(1);
    expect(buildQuality('low', 0, true).pixelRatio).toBe(1);
    expect(detectQuality({ devicePixelRatio: 2, isTouch: true, shortSide: 390, hardwareConcurrency: 8 }).antialias).toBe(false);
    expect(buildQuality('low', 2).shadows).toBe(false);
    // Fase 15: sin sombras de ningún tipo en ninguna calidad.
    for (const t of ['low', 'normal'] as const) for (const touch of [true, false]) {
      const q = buildQuality(t, 2, touch);
      expect([q.shadows, q.blobShadows, q.shadowMapSize]).toEqual([false, false, 0]);
    }
  });
});

describe('resolución adaptativa', () => {
  const feed = (a: AdaptiveResolution, fps: number, seconds: number) => {
    for (let i = 0; i < fps * seconds; i++) a.update(1 / fps);
  };
  it('detecta la frecuencia real de la pantalla', () => {
    expect(estimateRefreshHz(1 / 60)).toBe(60);
    expect(estimateRefreshHz(1 / 120)).toBe(120);
    expect(estimateRefreshHz(1 / 30)).toBe(30);
    expect(estimateRefreshHz(1 / 41)).toBe(60); // limitado por GPU, no por vsync
    expect(quantize(0.7333)).toBeCloseTo(0.75);
  });
  it('a 30 Hz (modo ahorro) no baja la resolución inútilmente', () => {
    const a = new AdaptiveResolution({ min: 0.5, max: 1.5, window: 1 });
    feed(a, 30, 20);
    expect(a.refreshHz).toBe(30);
    expect(a.pixelRatio).toBe(1.5);
  });
  it('en pantallas de 120 Hz no persigue 120: el objetivo es 60', () => {
    const a = new AdaptiveResolution({ min: 0.5, max: 1.5, window: 1 });
    feed(a, 120, 2);
    expect(a.targetFps).toBe(60);
    feed(a, 70, 10);
    expect(a.pixelRatio).toBe(1.5);
  });
  it('ignora tirones aislados (> 250 ms) y usa el percentil 90', () => {
    const a = new AdaptiveResolution({ min: 0.5, max: 1.5, window: 1 });
    for (let k = 0; k < 10; k++) {
      feed(a, 60, 1);
      a.update(0.5);
    }
    expect(a.pixelRatio).toBe(1.5);
  });
  it('si subir vuelve a ir lento, espera más antes de probar otra vez (no oscila)', () => {
    const a = new AdaptiveResolution({ min: 0.5, max: 1.5, window: 1, step: 0.1 });
    feed(a, 60, 1); // aprende 60 Hz
    feed(a, 40, 3); // lento: baja
    const low = a.pixelRatio;
    expect(low).toBeLessThan(1.5);
    // Simula un dispositivo cuyo límite está justo en `low`: por encima va lento.
    let changes = 0;
    let last = a.pixelRatio;
    for (let s = 0; s < 120; s++) {
      feed(a, a.pixelRatio > low + 1e-6 ? 45 : 60, 1);
      if (a.pixelRatio !== last) changes++;
      last = a.pixelRatio;
    }
    expect(changes).toBeLessThan(25); // sin backoff serían ~80 cambios
    expect(a.pixelRatio).toBeGreaterThanOrEqual(low - 0.1);
  });
  it('setBounds aplica los límites de la nueva calidad', () => {
    const a = new AdaptiveResolution({ min: 0.5, max: 1 });
    expect(a.setBounds(0.7, 1.5)).toBe(1.5);
    expect(a.pixelRatio).toBe(1.5);
  });
});

describe('pérdida del contexto WebGL', () => {
  it('pide recuperarlo, avisa al volver y falla si no vuelve a tiempo', () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    const seen: ContextStatus[] = [];
    const m = new ContextLossMonitor(target, (s) => seen.push(s), 1000);
    const lost = new Event('webglcontextlost', { cancelable: true });
    target.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    expect(m.lost).toBe(true);
    target.dispatchEvent(new Event('webglcontextrestored'));
    expect(m.lost).toBe(false);
    target.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    vi.advanceTimersByTime(1001);
    expect(seen).toEqual(['lost', 'restored', 'lost', 'failed']);
    m.dispose();
    target.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(seen).toHaveLength(4);
    vi.useRealTimers();
  });
});

describe('encuadre para celular en horizontal', () => {
  it('en pantallas más anchas que 16:9 acerca la cámara en lugar de mostrar más mundo', () => {
    const phone = computeFrustum(844 / 390);
    expect(phone.halfWidth * 2).toBeCloseTo(CAMERA.maxViewWidth);
    expect(phone.halfHeight * 2).toBeLessThan(CAMERA.viewHeight);
    const monitor = computeFrustum(16 / 9);
    expect(monitor.halfWidth * 2).toBeLessThanOrEqual(CAMERA.maxViewWidth);
    // Nadie ve más ancho que un monitor 16:9, sea cual sea su pantalla.
    for (const aspect of [1.33, 1.6, 1.78, 2, 2.16, 2.4]) expect(computeFrustum(aspect).halfWidth * 2).toBeLessThanOrEqual(CAMERA.maxViewWidth + 1e-9);
  });
});

const state = (over: Partial<PlayerState> = {}): PlayerState => ({
  id: 'x',
  name: 'X',
  position: { x: 0, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  yaw: 0,
  grounded: true,
  locomotion: 'idle',
  lastProcessedSeq: 0,
  ...over,
});

const countMeshes = (root: Object3D) => {
  let n = 0;
  root.traverse((o) => {
    if ((o as Mesh).isMesh && o.visible) n++;
  });
  return n;
};

describe('avatar optimizado', () => {
  it('es UNA malla con esqueleto de 6 huesos (1 draw call)', () => {
    const a = new PlayerAvatar(3, true);
    expect(countMeshes(a.root)).toBe(1);
    expect(a.mesh).toBeInstanceOf(SkinnedMesh);
    expect(a.mesh.skeleton.bones).toHaveLength(6);
    expect(a.mesh.castShadow).toBe(true);
    expect(a.mesh.boundingSphere!.radius).toBeGreaterThan(1);
    a.dispose();
  });
  it('anima los huesos al correr y no calcula la pose fuera de cámara', () => {
    const a = new PlayerAvatar(1, false);
    a.pushState(state(), true);
    a.pushState(state({ velocity: { x: 8, y: 0, z: 0 }, locomotion: 'run', position: { x: 0.27, y: 0, z: 0 } }));
    for (let i = 0; i < 20; i++) a.render(1, 1 / 60);
    const body = a.mesh.skeleton.bones[1]!;
    expect(body.rotation.x).toBeGreaterThan(0.1); // inclinación al correr
    const legL = a.mesh.skeleton.bones[4]!;
    const before = legL.rotation.x;
    for (let i = 0; i < 20; i++) a.render(1, 1 / 60, false);
    expect(legL.rotation.x).toBe(before);
    expect(a.position.x).toBeCloseTo(0.27);
    a.dispose();
  });
  it('las sombras de mancha de todos los jugadores van en un solo InstancedMesh', () => {
    const blobs = new BlobShadows();
    const avatars = Array.from({ length: 8 }, (_, i) => {
      const a = new PlayerAvatar(i, false);
      a.pushState(state({ position: { x: i, y: 0, z: 0 } }), true);
      a.render(1, 0);
      return a;
    });
    blobs.update(avatars);
    expect(blobs.mesh).toBeInstanceOf(InstancedMesh);
    expect(blobs.mesh.count).toBe(8);
    avatars.forEach((a) => a.dispose());
  });
});

describe('mundo con menos draw calls', () => {
  const layout = generateWorldLayout();
  it('la casa es 1 malla vista desde fuera y se divide al entrar', () => {
    const house = layout.structures.find((s) => s.def.id === 'house')!;
    const view = new PrefabView(house, true);
    view.update(house.x, 0, house.z + 30, 1 / 60);
    expect(view.visibleMeshes).toBe(1);
    for (let i = 0; i < 60; i++) view.update(house.x, 0, house.z, 1 / 60);
    expect(view.state).toBe('lower');
    expect(view.visibleMeshes).toBeGreaterThan(1);
    expect(view.groupOpacity('roof')).toBe(0);
    for (let i = 0; i < 60; i++) view.update(house.x, 0, house.z + HOUSE.depth + 10, 1 / 60);
    expect(view.visibleMeshes).toBe(1);
  });
  it('visibilityTargets no crea objetos por frame', () => {
    expect(visibilityTargets('lower')).toBe(visibilityTargets('lower'));
    expect(Object.isFrozen(visibilityTargets('outside'))).toBe(true);
  });
  it('mirador y cajas se fusionan en un solo lote estático', () => {
    const props = layout.structures.filter((s) => !s.def.interior);
    expect(props.length).toBeGreaterThanOrEqual(3);
    const batch = createStaticPrefabBatch(props, false)!;
    expect(batch).toBeInstanceOf(Mesh);
    expect(createStaticPrefabBatch([], false)).toBeNull();
  });
  it('los 140 árboles se dibujan con 2 InstancedMesh (tronco incluido)', () => {
    const g = createTrees(layout.trees, layout.seed, true);
    const meshes = g.children as InstancedMesh[];
    expect(meshes).toHaveLength(2);
    expect(meshes.reduce((n, m) => n + m.count, 0)).toBe(layout.trees.length);
  });
});
