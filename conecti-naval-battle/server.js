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
const X = require('./shared/extras');
const crypto = require('crypto');

const envMs = (name, def) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : def;
};

function startServer({ port = Number(process.env.PORT) || 3000, timings = {}, quiet = false } = {}) {
  const T = {
    PLAN_MS: envMs('PLAN_MS', C.PLAN_MS),
    REVEAL_MOVE_MS: envMs('REVEAL_MOVE_MS', C.REVEAL_MOVE_MS),
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

  // Ranking semanal y torneos en memoria (MVP de una sola instancia)
  const ranking = {};            // semana → tabla
  const torneos = new Map();     // id → { datos, token }
  const tablaSemana = () => (ranking[X.semana()] = ranking[X.semana()] || {});
  function alTerminar(room, p) {
    X.sumarResultado(tablaSemana(), p.names, p.winner);
    const t = room.meta && room.meta.torneo && torneos.get(room.meta.torneo.id);
    if (t) {
      const g = X.ganadorDeSala(t.datos, room.meta.torneo.r, room.meta.torneo.m, p.names, p.winner);
      if (g && X.ponerGanador(t.datos, room.meta.torneo.r, room.meta.torneo.m, g)) io.to('t:' + room.meta.torneo.id).emit('torneo', { id: room.meta.torneo.id, ...t.datos });
    }
  }

  const rooms = createRoomManager({
    timings: T,
    emit: (room, event, payload) => { io.to(room.code).emit(event, payload); if (event === 'gameOver') alTerminar(room, payload); },
    sync: (room, snapshot) => io.to(room.code).emit('state', snapshot),
  });
  const sweeper = setInterval(() => rooms.sweep(), 60000);
  sweeper.unref();

  io.on('connection', socket => {
    const allow = V.createRateLimiter({ capacity: 30, refillPerSec: 20, minIntervals: { plan: 500, create: 1000, join: 600, resume: 600, 'torneo:create': 3000 } });
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
      entrar(rooms.createRoom(prof, socket.id, V.meta(p && p.meta)), reply);
    });
    on('join', (p, reply) => {
      const prof = V.profile(p), code = V.roomCode(p && p.code);
      if (!prof) return reply({ ok: false, error: 'Datos de jugador no válidos.' });
      if (!code) return reply({ ok: false, error: 'El código tiene 4 números.' });
      entrar(rooms.joinRoom(code, prof, socket.id), reply);
    });
    on('resume', (p, reply) => {
      const code = V.roomCode(p && p.code), tok = V.token(p && p.token);
      if (!code || !tok) return reply({ ok: false, error: 'No se pudo recuperar la sesión.' });
      entrar(rooms.resumeRoom(code, tok, socket.id), reply);
    });
    on('ready', (p, reply) => reply({ ok: rooms.setReady(socket.id, !!(p && p.ready)) }));

    on('plan', (p, reply) => {
      const ctx = rooms.context(socket.id), plan = V.plan(p);
      if (!ctx || !plan) return reply({ ok: false, error: 'Plan no válido.' });
      const ok = rooms.engine.submitPlan(ctx.room, ctx.slot, plan);
      reply(ok ? { ok: true } : { ok: false, error: 'Ahora no puedes disparar.' });
    });
    on('ranking:get', (p, reply) => reply({ ok: true, semana: X.semana(), top: X.top(tablaSemana(), 10) }));
    on('torneo:create', (p, reply) => {
      const jug = Array.isArray(p && p.jugadores) ? p.jugadores.map(V.sanitizeName) : [];
      const unicos = new Set(jug.map(X.claveNombre));
      if (![4, 8].includes(jug.length) || unicos.size !== jug.length) return reply({ ok: false, error: 'Escribe 4 u 8 nombres distintos.' });
      let id; do { id = require('./server/rooms').genTorneo(); } while (torneos.has(id));
      const datos = X.crearTorneo({ nombre: V.textoCorto(p.nombre, 30) || 'Torneo Conecti', negocio: V.textoCorto(p.negocio, C.NEGOCIO_MAX), premio: V.textoCorto(p.premio, C.PREMIO_MAX), jugadores: jug });
      const token = crypto.randomBytes(18).toString('base64url');
      torneos.set(id, { datos, token });
      reply({ ok: true, id, token });
    });
    on('torneo:get', (p, reply) => {
      const id = p && V.TORNEO_RE.test(p.id) ? p.id : null, t = id && torneos.get(id);
      if (!t) return reply({ ok: false, error: 'Ese torneo no existe.' });
      socket.join('t:' + id);
      reply({ ok: true, torneo: { id, ...t.datos } });
    });
    on('torneo:winner', (p, reply) => {
      const id = p && V.TORNEO_RE.test(p.id) ? p.id : null, t = id && torneos.get(id);
      if (!t || typeof p.token !== 'string' || p.token !== t.token) return reply({ ok: false, error: 'Solo el organizador puede marcar ganadores.' });
      if (!X.ponerGanador(t.datos, p.r | 0, p.m | 0, String(p.nombre || ''))) return reply({ ok: false, error: 'No se pudo marcar ese ganador.' });
      io.to('t:' + id).emit('torneo', { id, ...t.datos });
      reply({ ok: true });
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
