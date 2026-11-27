/**
 * Servidor de BROTHERS ROYALE (Colyseus sobre WebSocket).
 *   npm run server            → puerto 2567 (o $PORT)
 * No requiere servicios externos: se ejecuta en cualquier máquina con Node 22.
 */
import { pathToFileURL } from 'node:url';
import { defineRoom, defineServer } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { NET, ROOM_NAME } from '@shared/protocol';
import { benchPrefix } from './bench';
import { BrothersRoom } from './BrothersRoom';

export function createServer() {
  benchPrefix();
  return defineServer({
    transport: new WebSocketTransport({ pingInterval: 3000, pingMaxRetries: 2 }),
    rooms: {
      // Una sala por código; sin código = sala pública.
      [ROOM_NAME]: defineRoom(BrothersRoom).filterBy(['code']),
    },
    gracefullyShutdown: true,
  });
}

export async function startServer(port: number = Number(process.env.PORT) || NET.defaultPort, host = process.env.HOST ?? '0.0.0.0') {
  const server = createServer();
  await server.listen(port, host);
  return server;
}

// Ejecución directa: node dist-server/index.js (no al importarlo desde las pruebas)
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startServer()
    .then(() => console.log(`BROTHERS ROYALE: servidor en ws://localhost:${Number(process.env.PORT) || NET.defaultPort}`))
    .catch((err) => {
      console.error('No se pudo iniciar el servidor:', err);
      process.exit(1);
    });
}
