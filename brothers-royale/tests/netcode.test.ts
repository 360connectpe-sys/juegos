import { describe, expect, it } from 'vitest';
import { SnapshotInterpolator } from '@/net/Interpolation';
import { checkServerUrl, defaultServerUrl, readOnlineParams } from '@/net/config';
import { PACKED_STRIDE, packPlayer, toPlayerState, unpackPlayers, type PublicPlayer } from '@shared/netcodec';
import { PROTOCOL_VERSION } from '@shared/protocol';
import { sanitizeName, sanitizeRoomCode, uniqueName, validateJoinOptions } from '@shared/session';
import type { PlayerState } from '@shared/types';
import { generateWorldLayout, isClearSpawn, spawnPoint } from '@shared/world/layout';

const state = (over: Partial<PlayerState> = {}): PlayerState => ({
  id: 'a',
  name: 'A',
  position: { x: 12.3456, y: 2.8049, z: -7.0001 },
  velocity: { x: 5.004, y: -3.21, z: 0 },
  yaw: -2.71828,
  grounded: false,
  locomotion: 'fall',
  lastProcessedSeq: 123456,
  ...over,
});

describe('netcodec (snapshots cuantizados)', () => {
  it('ida y vuelta con error ≤ 0,5 cm / 0,5 mrad y campos discretos exactos', () => {
    const out: number[] = [];
    packPlayer(out, 7, state());
    packPlayer(out, 200, state({ grounded: true, locomotion: 'run', position: { x: -60, y: 0, z: 60 } }));
    expect(out).toHaveLength(2 * PACKED_STRIDE);
    expect(out.every(Number.isInteger)).toBe(true);
    const [a, b] = unpackPlayers(out);
    expect(a!.netId).toBe(7);
    expect(Math.abs(a!.x - 12.3456)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(a!.yaw + 2.71828)).toBeLessThanOrEqual(0.0005);
    expect(a!.grounded).toBe(false);
    expect(a!.locomotion).toBe('fall');
    expect(a!.lastSeq).toBe(123456);
    expect(b!.locomotion).toBe('run');
    expect(b!.grounded).toBe(true);
    expect(toPlayerState(b!, 'id', 'N').position).toEqual({ x: -60, y: 0, z: 60 });
  });
  it('un jugador ocupa ~25 bytes en MessagePack (prioridad móvil)', () => {
    const out: number[] = [];
    packPlayer(out, 3, state());
    // Estimación conservadora de MessagePack: enteros en 1, 3 o 5 bytes.
    const bytes = out.reduce((n, v) => n + (Math.abs(v) < 128 ? 1 : Math.abs(v) < 32768 ? 3 : 5), 0);
    expect(bytes).toBeLessThanOrEqual(30);
  });
  it('ignora datos truncados, no numéricos o con tipos raros', () => {
    expect(unpackPlayers(null)).toEqual([]);
    expect(unpackPlayers([1, 2, 3])).toEqual([]);
    const good: number[] = [];
    packPlayer(good, 1, state());
    expect(unpackPlayers([...good, ...good.slice(0, 5)])).toHaveLength(1);
    expect(unpackPlayers(good.map((v, i) => (i === 3 ? 'x' : v)))).toEqual([]);
    expect(unpackPlayers(good.map((v, i) => (i === 2 ? Number.NaN : v)))).toEqual([]);
  });
});

describe('identificación y opciones de unión', () => {
  it('limpia nombres y códigos', () => {
    expect(sanitizeName('  Ana\u0000‮  María   la  grande y más  ')).toBe('Ana María la gra');
    expect(sanitizeName(42)).toBe('');
    expect(sanitizeRoomCode(' ab-c 12x!')).toBe('ABC12X');
    expect(sanitizeRoomCode('123456789')).toBe('12345678');
  });
  it('valida protocolo y aplica valores por defecto', () => {
    expect(validateJoinOptions(null)).toEqual({ ok: false, reason: 'options' });
    expect(validateJoinOptions({ protocol: PROTOCOL_VERSION - 1, name: 'x' })).toEqual({ ok: false, reason: 'protocol' });
    expect(validateJoinOptions({ protocol: PROTOCOL_VERSION, name: '   ' })).toEqual({
      ok: true,
      options: { protocol: PROTOCOL_VERSION, name: 'Jugador', code: '' },
    });
  });
  it('nombres únicos en la sala', () => {
    expect(uniqueName('Ana', ['Bea'])).toBe('Ana');
    expect(uniqueName('Ana', ['Ana', 'Ana 2'])).toBe('Ana 3');
    expect(uniqueName('ABCDEFGHIJKLMNOP', ['ABCDEFGHIJKLMNOP'])).toBe('ABCDEFGHIJKLMN 2');
  });
});

describe('puntos de aparición', () => {
  const layout = generateWorldLayout();
  it('son deterministas, distintos y libres de estructuras y árboles', () => {
    const pts = Array.from({ length: 16 }, (_, i) => spawnPoint(layout, i));
    expect(pts[0]).toEqual(layout.spawn);
    expect(spawnPoint(layout, 5)).toEqual(pts[5]);
    for (let i = 1; i < pts.length; i++) {
      expect(isClearSpawn(layout, pts[i]!.x, pts[i]!.z)).toBe(true);
      for (let j = 0; j < i; j++) expect(Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.z - pts[j]!.z)).toBeGreaterThan(2);
    }
  });
});

describe('SnapshotInterpolator', () => {
  const p = (netId: number, x: number, yaw = 0): PublicPlayer => ({ netId, x, y: 0, z: 0, yaw, vx: 0, vy: 0, vz: 0, grounded: true, locomotion: 'walk', lastSeq: 0 });
  it('interpola entre ticks, incluido el yaw por el camino corto', () => {
    const it = new SnapshotInterpolator();
    it.push(10, [p(1, 0, 3)]);
    it.push(12, [p(1, 2, -3)]);
    const s = it.sample(1, 11)!;
    expect(s.x).toBeCloseTo(1);
    expect(Math.abs(s.yaw)).toBeCloseTo(Math.PI, 1);
    expect(it.sample(1, 50)!.x).toBe(2); // sin extrapolar
    expect(it.sample(1, 0)!.x).toBe(0);
  });
  it('acepta snapshots desordenados y olvida a quien desaparece', () => {
    const it = new SnapshotInterpolator();
    it.push(5, [p(1, 5), p(2, 0)]);
    it.push(3, [p(1, 3), p(2, 0)]);
    expect(it.sample(1, 4)!.x).toBeCloseTo(4);
    it.push(6, [p(1, 6)]);
    expect(it.ids()).toEqual([1]);
    expect(it.sample(2, 6)).toBeNull();
  });
  it('un snapshot atrasado no resucita a un jugador que ya salió', () => {
    const it = new SnapshotInterpolator();
    it.push(5, [p(1, 5), p(2, 0)]);
    it.push(6, [p(1, 6)]);
    it.push(4, [p(1, 4), p(2, 0)]);
    expect(it.ids()).toEqual([1]);
    it.clear();
    expect(it.latestTick).toBe(-1);
    expect(it.ids()).toEqual([]);
  });
  it('reutiliza el objeto de salida (sin basura por frame)', () => {
    const it = new SnapshotInterpolator();
    it.push(1, [p(1, 0)]);
    it.push(2, [p(1, 1)]);
    const out = p(0, 0);
    expect(it.sample(1, 1.5, out)).toBe(out);
    expect(out.netId).toBe(1);
  });
});

describe('configuración del cliente en línea', () => {
  it('servidor por defecto según la página', () => {
    expect(defaultServerUrl({ protocol: 'http:', hostname: '192.168.1.5' })).toBe('ws://192.168.1.5:2567');
    expect(defaultServerUrl({ protocol: 'https:', hostname: 'example.org' })).toBe('wss://example.org:2567');
    expect(defaultServerUrl({ protocol: 'https:', hostname: 'x' }, 'wss://env:443')).toBe('wss://env:443');
  });
  it('valida la URL del servidor', () => {
    expect(checkServerUrl('ws://localhost:2567', 'http:')).toBeNull();
    expect(checkServerUrl('http://localhost', 'http:')).toMatch(/ws:\/\//);
    expect(checkServerUrl('ws://x:1', 'https:')).toMatch(/wss/);
    expect(checkServerUrl('no es url', 'http:')).toMatch(/no es válida/);
  });
  it('lee ?online, ?server, ?name y ?code', () => {
    const o = readOnlineParams('?online&server=ws://h:1&name=%20Bea%20&code=ab1', { protocol: 'http:', hostname: 'z' });
    expect(o).toEqual({ server: 'ws://h:1', name: 'Bea', code: 'AB1', auto: true });
    expect(readOnlineParams('', { protocol: 'http:', hostname: 'z' }, undefined, 'Guardado').name).toBe('Guardado');
  });
});

describe('códigos de cierre', () => {
  it('no chocan con los de Colyseus y se explican en castellano', async () => {
    const { CloseCodes, closeReason } = await import('@shared/protocol');
    for (const c of Object.values(CloseCodes)) expect(c).toBeGreaterThanOrEqual(4100);
    expect(closeReason(4001)).toBe('El servidor se apagó');
    expect(closeReason(CloseCodes.PROTOCOL_MISMATCH)).toMatch(/recarga/);
    expect(closeReason(4999, 'x')).toBe('Conexión cerrada: x');
  });
});
