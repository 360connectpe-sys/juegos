import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@colyseus/sdk';
import WebSocket from 'ws';
import { createServer } from '../server/index';
import { RoomBudget, roomBudget } from '../server/capacity';
import { isOriginAllowed, normalizeOrigin, readServerConfig } from '../server/config';
import { defaultServerUrl, healthUrl, runtimeServerUrl, wakeServer } from '@/net/config';
import { friendlyJoinError } from '@/net/OnlineSession';
import { closeReason, CloseCodes, NET, PROTOCOL_VERSION, ROOM_NAME } from '@shared/protocol';

describe('configuración de despliegue (variables de entorno)', () => {
  it('valores por defecto seguros y validación', () => {
    expect(readServerConfig({})).toEqual({ port: NET.defaultPort, host: '0.0.0.0', allowedOrigins: null, maxRooms: 8 });
    const c = readServerConfig({ PORT: '10000', HOST: ' ', MAX_ROOMS: '2', ALLOWED_ORIGINS: 'https://360connectpe-sys.github.io/, http://localhost:5173, basura' });
    expect(c).toEqual({ port: 10000, host: '0.0.0.0', allowedOrigins: ['https://360connectpe-sys.github.io', 'http://localhost:5173'], maxRooms: 2 });
    expect(readServerConfig({ PORT: '99999', MAX_ROOMS: '-3' })).toMatchObject({ port: NET.defaultPort, maxRooms: 8 });
    expect(readServerConfig({ ALLOWED_ORIGINS: '*' }).allowedOrigins).toBeNull();
    // Lista escrita pero toda inválida: se cierra, no se abre por error.
    expect(readServerConfig({ ALLOWED_ORIGINS: 'ftp://x' }).allowedOrigins).toEqual([]);
  });

  it('orígenes: exactos, sin cabecera se acepta, otro sitio se rechaza', () => {
    const cfg = { allowedOrigins: ['https://360connectpe-sys.github.io'] };
    expect(normalizeOrigin('HTTPS://360connectpe-sys.GitHub.io/juegos/')).toBe('https://360connectpe-sys.github.io');
    expect(isOriginAllowed('https://360connectpe-sys.github.io', cfg)).toBe(true);
    expect(isOriginAllowed(undefined, cfg)).toBe(true);
    expect(isOriginAllowed('https://otro.github.io', cfg)).toBe(false);
    expect(isOriginAllowed('https://360connectpe-sys.github.io.evil.com', cfg)).toBe(false);
    expect(isOriginAllowed('https://cualquiera.com', { allowedOrigins: null })).toBe(true);
  });

  it('presupuesto de salas y mensaje claro al jugador', () => {
    const b = new RoomBudget(2);
    expect([b.tryAcquire(), b.tryAcquire(), b.tryAcquire()]).toEqual([true, true, false]);
    b.release();
    expect(b.tryAcquire()).toBe(true);
    expect(closeReason(CloseCodes.SERVER_FULL)).toMatch(/lleno/);
  });

  it('cliente: config.js en tiempo de ejecución > VITE_SERVER_URL > mismo host; URLs inválidas se ignoran', () => {
    const page = { protocol: 'https:', hostname: '360connectpe-sys.github.io' };
    expect(runtimeServerUrl({ serverUrl: ' wss://juego.example.com/ ' })).toBe('wss://juego.example.com');
    expect(runtimeServerUrl({ serverUrl: 'https://juego.example.com' })).toBeUndefined();
    expect(runtimeServerUrl({ serverUrl: '' })).toBeUndefined();
    expect(runtimeServerUrl(undefined)).toBeUndefined();
    expect(defaultServerUrl(page, 'wss://build.example.com', 'wss://runtime.example.com')).toBe('wss://runtime.example.com');
    expect(defaultServerUrl(page, 'wss://build.example.com', undefined)).toBe('wss://build.example.com');
    expect(defaultServerUrl(page, undefined, undefined)).toBe(`wss://360connectpe-sys.github.io:${NET.defaultPort}`);
  });
});

describe('despertar servidores dormidos (Render gratis)', () => {
  it('convierte ws/wss en la URL de /health y no falla nunca', async () => {
    expect(healthUrl('wss://br.onrender.com')).toBe('https://br.onrender.com/health');
    expect(healthUrl('ws://127.0.0.1:2567/?x=1')).toBe('http://127.0.0.1:2567/health');
    expect(healthUrl('https://x')).toBeNull();
    const t0 = Date.now();
    await wakeServer('ws://127.0.0.1:1'); // rechazado al instante: no espera el plazo
    await wakeServer('basura');
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('los errores de red del navegador llegan al jugador en español', () => {
    expect((friendlyJoinError(new TypeError('Failed to fetch')) as Error).message).toMatch(/No se pudo contactar/);
    expect((friendlyJoinError(new TypeError('Load failed')) as Error).message).toMatch(/No se pudo contactar/); // Safari (iPhone)
    const other = new Error('Versión de protocolo distinta');
    expect(friendlyJoinError(other)).toBe(other);
  });
});

describe('servidor desplegable: /health, orígenes y límite de salas', () => {
  const PORT = 33070 + Math.floor(Math.random() * 300);
  const ORIGIN = 'https://360connectpe-sys.github.io';
  let server: ReturnType<typeof createServer>;

  beforeAll(async () => {
    server = createServer({ port: PORT, host: '127.0.0.1', allowedOrigins: [ORIGIN], maxRooms: 1 });
    await server.listen(PORT, '127.0.0.1');
  });
  afterAll(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  it('GET /health responde JSON sin datos de jugadores', async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toMatchObject({ ok: true, protocol: PROTOCOL_VERSION, maxRooms: 1, maxPlayersPerRoom: 8 });
  });

  it('CORS del emparejamiento solo para el origen permitido', async () => {
    const pre = (origin: string) => fetch(`http://127.0.0.1:${PORT}/matchmake/joinOrCreate/${ROOM_NAME}`, { method: 'OPTIONS', headers: { Origin: origin } });
    expect((await pre(ORIGIN)).headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect((await pre('https://intruso.example')).headers.get('access-control-allow-origin')).toBe('null');
  });

  it('WebSocket desde otro origen se rechaza en el handshake', async () => {
    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/cualquiera`, { headers: { Origin: 'https://intruso.example' } });
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => resolve(101));
      ws.on('error', () => undefined);
    });
    expect(status).toBe(401);
  });

  it('con MAX_ROOMS=1 la segunda sala se rechaza (servidor lleno) y la plaza se libera al vaciarse', async () => {
    const a = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate(ROOM_NAME, { protocol: PROTOCOL_VERSION, name: 'A', code: 'UNO' });
    expect(roomBudget.active).toBe(1);
    await expect(new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate(ROOM_NAME, { protocol: PROTOCOL_VERSION, name: 'B', code: 'DOS' })).rejects.toThrow(/lleno/);
    await a.leave(true);
    for (let i = 0; i < 100 && roomBudget.active > 0; i++) await new Promise((r) => setTimeout(r, 20));
    expect(roomBudget.active).toBe(0);
    const c = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate(ROOM_NAME, { protocol: PROTOCOL_VERSION, name: 'C', code: 'DOS' });
    await c.leave(true);
  });
});
