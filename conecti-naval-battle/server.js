'use strict';
/*
 * CONECTI NAVAL BATTLE — servidor
 * Express sirve el juego y Socket.io lleva las salas. El servidor decide TODO:
 * posiciones, turnos, tiempos, física, colisiones, daño y ganador.
 */
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const C = require('./shared/constants');
const V = require('./server/validation');
const { createRoomManager } = require('./server/rooms');

const envMs = (name, def) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : def;
};

function startServer({ port = Number(process.env.PORT) || 3000, timings = {}, quiet = false } = {}) {
  const T = {
    MOVE_MS: envMs('MOVE_MS', C.MOVE_MS),
    AIM_MS: envMs('AIM_MS', C.AIM_MS),
    RESOLUTION_MS: envMs('RESOLUTION_MS', C.RESOLUTION_MS),
    START_DELAY_MS: envMs('START_DELAY_MS', C.START_DELAY_MS),
    RECONNECT_MS: envMs('RECONNECT_MS', C.RECONNECT_MS),
    EMPTY_ROOM_MS: envMs('EMPTY_ROOM_MS', C.EMPTY_ROOM_MS),
    ...timings,
  };

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.rooms.size }));
  app.use('/shared', express.static(path.join(__dirname, 'shared'), { maxAge: '1h' }));
  app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', extensions: ['html'] }));

  const server = http.createServer(app);
  const io = new Server(server, {
    maxHttpBufferSize: 4096,         // ningún mensaje legítimo pesa más
    pingInterval: 10000,
    pingTimeout: 8000,
    cors: process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN.split(',') } : undefined,
  });

  const rooms = createRoomManager({
    timings: T,
    emit: (room, event, payload) => io.to(room.code).emit(event, payload),
    sync: (room, snapshot) => io.to(room.code).emit('state', snapshot),
  });
  const sweeper = setInterval(() => rooms.sweep(), 60000);
  sweeper.unref();

  io.on('connection', socket => {
    const allow = V.createRateLimiter({ capacity: 30, refillPerSec: 20, minIntervals: { move: 35, aim: 45, fire: 500, create: 1000, join: 600, resume: 600 } });
    const ack = fn => (typeof fn === 'function' ? fn : () => {});
    // Envuelve cada evento: límite de frecuencia + captura de errores
    const on = (event, handler) => socket.on(event, (payload, cb) => {
      const reply = ack(cb);
      if (!allow(event)) return reply({ ok: false, error: 'Vas muy rápido. Espera un momento.' });
      try { handler(payload, reply); } catch (e) { console.error('[socket]', event, e); reply({ ok: false, error: 'Error del servidor.' }); }
    });
    const entrar = (res, reply) => {
      if (res.error) return reply({ ok: false, error: res.error });
      socket.join(res.room.code);
      reply({ ok: true, code: res.room.code, slot: res.slot, token: res.token });
      io.to(res.room.code).emit('state', require('./server/gameState').publicState(res.room));
    };

    on('create', (p, reply) => {
      const prof = V.profile(p); if (!prof) return reply({ ok: false, error: 'Datos de jugador no válidos.' });
      entrar(rooms.createRoom(prof, socket.id), reply);
    });
    on('join', (p, reply) => {
      const prof = V.profile(p), code = V.roomCode(p && p.code);
      if (!prof) return reply({ ok: false, error: 'Datos de jugador no válidos.' });
      if (!code) return reply({ ok: false, error: 'El código no es válido. Tiene la forma CNX-ABCD.' });
      entrar(rooms.joinRoom(code, prof, socket.id), reply);
    });
    on('resume', (p, reply) => {
      const code = V.roomCode(p && p.code), tok = V.token(p && p.token);
      if (!code || !tok) return reply({ ok: false, error: 'No se pudo recuperar la sesión.' });
      entrar(rooms.resumeRoom(code, tok, socket.id), reply);
    });
    on('ready', (p, reply) => reply({ ok: rooms.setReady(socket.id, !!(p && p.ready)) }));

    on('move', (p, reply) => {
      const ctx = rooms.context(socket.id), dx = V.moveStep(p);
      if (!ctx || dx === null) return reply({ ok: false });
      reply({ ok: true, moved: rooms.engine.move(ctx.room, ctx.slot, dx) });
    });
    on('endMove', (p, reply) => {
      const ctx = rooms.context(socket.id); if (!ctx) return reply({ ok: false });
      reply({ ok: rooms.engine.confirmMove(ctx.room, ctx.slot) });
    });
    on('aim', (p, reply) => {
      const ctx = rooms.context(socket.id), a = V.aim(p);
      if (!ctx || !a) return reply({ ok: false });
      reply({ ok: rooms.engine.setAim(ctx.room, ctx.slot, a) });
    });
    on('fire', (p, reply) => {
      const ctx = rooms.context(socket.id), a = V.aim(p);
      if (!ctx || !a) return reply({ ok: false, error: 'Disparo no válido.' });
      const ok = rooms.engine.fire(ctx.room, ctx.slot, a);
      reply(ok ? { ok: true } : { ok: false, error: 'Ahora no puedes disparar.' });
    });
    on('rematch', (p, reply) => {
      const ctx = rooms.context(socket.id); if (!ctx) return reply({ ok: false });
      reply({ ok: rooms.engine.requestRematch(ctx.room, ctx.slot) });
    });
    on('leave', (p, reply) => {
      const ref = rooms.bySocket.get(socket.id);
      if (ref) socket.leave(ref.code);
      rooms.leave(socket.id);
      reply({ ok: true });
    });
    socket.on('disconnect', () => rooms.disconnect(socket.id));
  });

  return new Promise(resolve => {
    server.listen(port, () => {
      const real = server.address().port;
      if (!quiet) console.log(`⚓ Conecti Naval Battle listo en http://localhost:${real}`);
      resolve({ server, io, rooms, port: real, close: () => new Promise(r => { clearInterval(sweeper); io.close(); server.close(() => r()); }) });
    });
  });
}

if (require.main === module) startServer();

module.exports = { startServer };
