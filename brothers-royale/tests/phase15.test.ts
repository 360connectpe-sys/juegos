/** Fase 15 — regresiones: audio iOS (H7), carga de config.js sin bloquear (H1), rendimiento real. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SoundFx } from '@/game/combat/SoundFx';
import { loadRuntimeConfig } from '@/net/config';
import { PerformanceGovernor } from '@/engine/quality';

class FakeTarget { l = new Map<string, () => void>(); addEventListener(t: string, f: () => void) { this.l.set(t, f); } removeEventListener(t: string) { this.l.delete(t); } fire(t: string) { this.l.get(t)?.(); } }
function fakeAudio(initial = 'suspended') {
  const calls = { created: 0, resumed: 0, started: 0 };
  const node = () => ({ connect: (x: unknown) => x ?? node(), gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, frequency: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, start() { calls.started++; }, stop() {}, buffer: null as unknown, type: '' });
  class Ctx {
    state = initial; currentTime = 0; sampleRate = 8000; destination = {}; onstatechange: (() => void) | null = null;
    constructor() { calls.created++; }
    resume() { calls.resumed++; this.state = 'running'; return Promise.resolve(); }
    close() { return Promise.resolve(); }
    createGain() { return node(); } createBufferSource() { return node(); } createBiquadFilter() { return node(); } createOscillator() { return node(); }
    createBuffer(_c: number, n: number) { return { getChannelData: () => new Float32Array(n) }; }
  }
  return { Ctx, calls };
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('fase 15 H7: audio en Safari/iOS', () => {
  it('no crea el contexto fuera de un gesto; lo crea y reanuda con touchend/click; y suena', () => {
    const { Ctx, calls } = fakeAudio();
    vi.stubGlobal('AudioContext', Ctx);
    const t = new FakeTarget();
    const fx = new SoundFx(t as unknown as Window);
    fx.play('pistol');
    expect(calls.created).toBe(0);
    expect([...t.l.keys()]).toEqual(expect.arrayContaining(['touchend', 'click', 'pointerdown', 'keydown']));
    t.fire('touchend');
    expect(calls.created).toBe(1); expect(calls.resumed).toBeGreaterThan(0);
    const before = calls.started;
    fx.play('pistol');
    expect(calls.started).toBeGreaterThan(before);
    fx.dispose();
    expect(t.l.has('touchend')).toBe(false);
  });
  it('tras una interrupción (iOS) o segundo plano se reanuda solo', () => {
    const { Ctx, calls } = fakeAudio();
    vi.stubGlobal('AudioContext', Ctx);
    const t = new FakeTarget();
    const fx = new SoundFx(t as unknown as Window);
    t.fire('click');
    const ctx = (fx as unknown as { ctx: { state: string } }).ctx;
    ctx.state = 'interrupted';
    const r = calls.resumed;
    fx.play('reload'); // no suena, pero pide reanudar
    expect(calls.resumed).toBe(r + 1);
    ctx.state = 'suspended';
    t.fire('pageshow');
    expect(calls.resumed).toBe(r + 2);
    expect(ctx.state).toBe('running');
  });
});

describe('fase 15 H1: config.js no bloquea el arranque', () => {
  it('resuelve por tiempo si el script no llega, y por error si falla', async () => {
    const appended: { onload?: () => void; onerror?: () => void }[] = [];
    const doc = { createElement: () => ({}), head: { append: (s: never) => appended.push(s) } } as unknown as Document;
    const t0 = Date.now();
    expect(await loadRuntimeConfig(50, doc)).toBe('timeout');
    expect(Date.now() - t0).toBeLessThan(1000);
    const p = loadRuntimeConfig(5000, doc); appended.at(-1)!.onerror!();
    expect(await p).toBe('error');
    const q = loadRuntimeConfig(5000, doc); appended.at(-1)!.onload!();
    expect(await q).toBe('loaded');
    expect(await loadRuntimeConfig(10, null)).toBe('skipped');
  });
});

describe('fase 15.1: capacidad por rendimiento real', () => {
  it('pasa a Baja solo tras varias ventanas lentas con la resolución mínima, una vez', () => {
    const g = new PerformanceGovernor(4);
    for (let i = 0; i < 3; i++) expect(g.feed('normal', 40, 60, 0.75, 0.75)).toBe(false);
    expect(g.feed('normal', 40, 60, 0.75, 0.75)).toBe(true);
    expect(g.feed('normal', 40, 60, 0.75, 0.75)).toBe(false);
    const h = new PerformanceGovernor(2);
    expect(h.feed('normal', 40, 60, 1, 0.75)).toBe(false); // aún puede bajar resolución
    expect(h.feed('normal', 40, 60, 1, 0.75)).toBe(false);
    expect(h.feed('low', 80, 60, 0.6, 0.6)).toBe(false); // nunca decide en Baja
    expect(h.feed('normal', 18, 60, 0.75, 0.75)).toBe(false); // 18 ms ≈ 55 FPS: aceptable
  });
});

import { PlayerAvatar } from '@/game/entities/PlayerAvatar';
describe('fase 15 H16: correcciones suavizadas (solo dibujo)', () => {
  it('absorbe un salto pequeño y lo reduce en ~0,2 s; los teletransportes no se suavizan', () => {
    const a = new PlayerAvatar(0, false);
    const st = { id: 'a', name: 'A', position: { x: 1, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, yaw: 0, grounded: true, locomotion: 'idle' as const, lastProcessedSeq: 0 };
    a.pushState(st, true);
    a.absorbCorrection(1, 0, 0); // el servidor movió 1 m: se dibuja aún donde estaba
    a.render(1, 0);
    expect(a.position.x).toBeCloseTo(0, 5);
    for (let i = 0; i < 12; i++) a.render(1, 1 / 60);
    expect(a.position.x).toBeGreaterThan(0.9);
    a.absorbCorrection(10, 0, 0); a.render(1, 0);
    expect(a.position.x).toBeCloseTo(1, 3);
  });
});

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error script .mjs sin tipos
import { syncBeta } from '../scripts/sync-beta.mjs';
describe('fase 15 H17: publicación de la beta sin acumular builds', () => {
  it('conserva el build actual y el anterior y el config.js publicado; borra los más antiguos', () => {
    const root = mkdtempSync(join(tmpdir(), 'br-beta-'));
    const beta = join(root, 'beta');
    const build = (id: string) => {
      const j = join(root, 'jugar-' + id);
      mkdirSync(join(j, 'assets'), { recursive: true });
      writeFileSync(join(j, 'version.json'), JSON.stringify({ build: id, protocol: 10 }));
      writeFileSync(join(j, 'index.html'), id);
      writeFileSync(join(j, 'config.js'), "window.BR_CONFIG = { serverUrl: '' };");
      writeFileSync(join(j, 'assets', `index-${id}.js`), id);
      return j;
    };
    mkdirSync(join(beta, 'assets'), { recursive: true });
    writeFileSync(join(beta, 'config.js'), "window.BR_CONFIG = { serverUrl: 'wss://x' };");
    writeFileSync(join(beta, 'assets', 'index-old.js'), 'old');
    syncBeta(build('a'), beta);
    expect(existsSync(join(beta, 'assets', 'index-old.js'))).toBe(true); // build previo publicado: se conserva una vez
    const rb = syncBeta(build('b'), beta);
    expect(rb.removed).toEqual(['assets/index-old.js']);
    const r = syncBeta(build('c'), beta);
    expect(r.removed).toEqual(['assets/index-a.js']);
    expect(existsSync(join(beta, 'assets', 'index-b.js')) && existsSync(join(beta, 'assets', 'index-c.js'))).toBe(true);
    expect(readFileSync(join(beta, 'config.js'), 'utf8')).toContain('wss://x');
    expect(readFileSync(join(beta, 'index.html'), 'utf8')).toBe('c');
  });
});

import { generateWorldLayout } from '@shared/world/layout';
import { hillsFor, sectorAt, terrainHeight } from '@shared/world/terrain';
import { rockCollider, worldColliders } from '@shared/world/colliders';
describe('fase 15.4: terreno, sectores y vegetación', () => {
  const l = generateWorldLayout();
  it('cuatro sectores, colinas suaves fuera del pueblo y mapa 120 m determinista', () => {
    expect(l.terrain.size).toBe(120);
    expect(generateWorldLayout()).toEqual(l);
    const seen = new Set<string>();
    for (let x = -55; x <= 55; x += 5) for (let z = -55; z <= 55; z += 5) seen.add(sectorAt(x, z, l.seed));
    expect([...seen].sort()).toEqual(['forest', 'open', 'residential', 'rural']);
    const hills = hillsFor(l.seed);
    expect(hills.length).toBe(4);
    for (const h of hills) {
      expect(Math.hypot(h.x, h.z)).toBeGreaterThan(28);
      // Pendiente máxima en la ladera: subir caminando (< 50°, límite del personaje).
      let maxSlope = 0;
      for (let a = 0; a < 6.28; a += 0.5) for (let r = 1; r < h.r * 1.6; r += 0.5) {
        const x = h.x + Math.cos(a) * r, z = h.z + Math.sin(a) * r;
        maxSlope = Math.max(maxSlope, Math.abs(terrainHeight(x + 0.25, z, l.terrain) - terrainHeight(x - 0.25, z, l.terrain)) / 0.5);
      }
      expect(Math.atan(maxSlope) * 180 / Math.PI).toBeLessThan(45);
    }
  });
  it('bosque denso, claro abierto casi sin árboles; rocas de cobertura con colisión y lejos de cofres', () => {
    const count = (sec: string) => l.trees.filter((t) => sectorAt(t.x, t.z, l.seed) === sec).length;
    expect(count('forest')).toBeGreaterThan(count('open') * 2);
    expect(l.rocks.length).toBeGreaterThanOrEqual(15);
    expect(l.bushes.length).toBeGreaterThanOrEqual(30);
    for (const r of l.rocks) expect(l.chests.every((c) => Math.hypot(c.x - r.x, c.z - r.z) >= 2.5)).toBe(true);
    const cols = worldColliders(l, true);
    expect(cols).toEqual(expect.arrayContaining([rockCollider(l.rocks[0]!)]));
    expect(l.trees.every((t) => Math.hypot(t.x - l.spawn.x, t.z - l.spawn.z) >= 4.5)).toBe(true);
    expect(Math.min(...l.trees.map((t) => t.scale))).toBeGreaterThanOrEqual(1);
  });
});
