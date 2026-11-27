/**
 * Servidor de BROTHERS ROYALE (Colyseus sobre WebSocket).
 *   npm run server            → puerto 2567 (o $PORT)
 * No requiere servicios externos: se ejecuta en cualquier máquina con Node 22.
 * Despliegue (Docker, Render, Oracle Cloud + WSS): ver DEPLOY.md y server/config.ts.
 *
 * Rutas HTTP: /matchmake/* (Colyseus) y GET /health (estado para el alojamiento).
 * El WebSocket seguro (wss://) lo termina el proxy del alojamiento (Render) o Caddy.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { defineRoom, defineServer, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { NET, PROTOCOL_VERSION, ROOM_NAME } from '@shared/protocol';
import { benchPrefix } from './bench';
import { BrothersRoom } from './BrothersRoom';
import { roomBudget } from './capacity';
import { isOriginAllowed, readServerConfig, type ServerConfig } from './config';

const startedAt = Date.now();

/** Estado público mínimo para el chequeo de salud (sin nombres ni datos de jugadores). */
export function healthStatus() {
  return {
    ok: true,
    protocol: PROTOCOL_VERSION,
    rooms: roomBudget.active,
    maxRooms: roomBudget.limit,
    maxPlayersPerRoom: NET.maxPlayersPerRoom,
    uptime: Math.round((Date.now() - startedAt) / 1000),
  };
}

export function createServer(config: ServerConfig = readServerConfig()) {
  benchPrefix();
  roomBudget.limit = config.maxRooms;
  // CORS del emparejamiento: solo los orígenes permitidos reciben permiso del navegador.
  matchMaker.controller.getCorsHeaders = (headers: Headers) => {
    const origin = headers.get('origin');
    return { 'Access-Control-Allow-Origin': origin && isOriginAllowed(origin, config) ? origin : config.allowedOrigins === null ? '*' : 'null', Vary: 'Origin' };
  };
  return defineServer({
    transport: new WebSocketTransport({
      pingInterval: 3000,
      pingMaxRetries: 2,
      // Un WebSocket abierto desde otra web (con Origin no permitido) se rechaza en el handshake.
      verifyClient: (info: { origin?: string }) => isOriginAllowed(info.origin, config),
    }),
    rooms: {
      // Una sala por código; sin código = sala pública.
      [ROOM_NAME]: defineRoom(BrothersRoom).filterBy(['code']),
    },
    express: (app) => {
      app.get('/health', (_req: IncomingMessage, res: ServerResponse) => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(healthStatus()));
      });
      app.get('/', (_req: IncomingMessage, res: ServerResponse) => {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('BROTHERS ROYALE: servidor de juego. Estado en /health.\n');
      });
    },
    gracefullyShutdown: true,
    greet: false,
  });
}

export async function startServer(config: ServerConfig = readServerConfig()) {
  const server = createServer(config);
  await server.listen(config.port, config.host);
  return server;
}

// Ejecución directa: node dist-server/index.js (no al importarlo desde las pruebas)
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const config = readServerConfig();
  startServer(config)
    .then(() =>
      console.log(
        `BROTHERS ROYALE: servidor en ws://${config.host}:${config.port} · máx. ${config.maxRooms} salas de ${NET.maxPlayersPerRoom} · orígenes: ${config.allowedOrigins === null ? 'todos' : config.allowedOrigins.join(', ') || 'ninguno'}`,
      ),
    )
    .catch((err) => {
      console.error('No se pudo iniciar el servidor:', err);
      process.exit(1);
    });
}
