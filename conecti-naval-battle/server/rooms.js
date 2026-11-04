'use strict';
/*
 * Salas privadas de exactamente 2 jugadores, tokens de reconexión y limpieza.
 * No conoce Socket.io: recibe ids de conexión y avisa con emit/sync.
 */
const crypto = require('crypto');
const C = require('../shared/constants');
const { newMatchState, publicState } = require('./gameState');
const { createTurnEngine } = require('./turns');

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // sin O/0/I/1 para que no se confundan

function genCode() {
  let s = 'CNX-';
  for (let i = 0; i < 4; i++) s += ALFABETO[crypto.randomInt(ALFABETO.length)];
  return s;
}
const genToken = () => crypto.randomBytes(24).toString('base64url');
const sameToken = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function createRoomManager({ emit = () => {}, sync = () => {}, timings = {}, random } = {}) {
  const T = {
    RECONNECT_MS: timings.RECONNECT_MS ?? C.RECONNECT_MS,
    EMPTY_ROOM_MS: timings.EMPTY_ROOM_MS ?? C.EMPTY_ROOM_MS,
  };
  const rooms = new Map();          // code → room
  const bySocket = new Map();       // socketId → { code, slot }
  const syncRoom = room => sync(room, publicState(room));
  const engine = createTurnEngine({ emit, sync: syncRoom, timings, random });

  function newPlayer(profile, socketId) {
    return { ...profile, socketId, token: genToken(), connected: true, ready: false, rematch: false, left: false, reconnectEndsAt: 0, timer: null };
  }

  function createRoom(profile, socketId) {
    if (bySocket.has(socketId)) return { error: 'Ya estás en una sala.' };
    let code;
    do { code = genCode(); } while (rooms.has(code));
    const room = { code, createdAt: Date.now(), players: [newPlayer(profile, socketId), null], state: newMatchState(), phaseTimer: null, emptyTimer: null, onResume: null };
    rooms.set(code, room);
    bySocket.set(socketId, { code, slot: 0 });
    syncRoom(room);
    return { room, slot: 0, token: room.players[0].token };
  }

  function joinRoom(code, profile, socketId) {
    if (bySocket.has(socketId)) return { error: 'Ya estás en una sala.' };
    const room = rooms.get(code);
    if (!room) return { error: 'Esa sala no existe. Revisa el código.' };
    const libre = room.players.findIndex(p => !p || (p.left && !p.connected));
    const enJuego = !['LOBBY', 'GAME_OVER'].includes(room.state.phase);
    if (libre < 0 || enJuego) return { error: 'Esa sala ya está llena.' };
    const old = room.players[libre];
    if (old && old.timer) clearTimeout(old.timer);
    room.players[libre] = newPlayer(profile, socketId);
    if (room.state.phase === 'GAME_OVER') { engine.clearPhaseTimer(room); room.state = newMatchState(); }
    room.players.forEach(p => { if (p) { p.ready = false; p.rematch = false; } });
    bySocket.set(socketId, { code, slot: libre });
    cancelEmpty(room);
    syncRoom(room);
    return { room, slot: libre, token: room.players[libre].token };
  }

  /** Recupera un lugar con el token secreto. Nadie más puede ocupar ese lugar. */
  function resumeRoom(code, token, socketId) {
    const room = rooms.get(code);
    if (!room) return { error: 'La sala ya no existe.' };
    const slot = room.players.findIndex(p => p && !p.left && sameToken(p.token, token));
    if (slot < 0) return { error: 'No se pudo recuperar tu lugar en la sala.' };
    const p = room.players[slot];
    if (p.connected && p.socketId !== socketId) bySocket.delete(p.socketId);   // la conexión vieja queda fuera
    if (p.timer) { clearTimeout(p.timer); p.timer = null; }
    p.socketId = socketId; p.connected = true; p.reconnectEndsAt = 0;
    bySocket.set(socketId, { code, slot });
    cancelEmpty(room);
    if (!engine.resume(room)) syncRoom(room);
    return { room, slot, token: p.token };
  }

  function setReady(socketId, ready) {
    const ref = bySocket.get(socketId); if (!ref) return false;
    const room = rooms.get(ref.code);
    if (!room || room.state.phase !== 'LOBBY') return false;
    room.players[ref.slot].ready = !!ready;
    syncRoom(room);
    if (room.players.every(p => p && p.connected && p.ready)) engine.startMatch(room);
    return true;
  }

  function disconnect(socketId) {
    const ref = bySocket.get(socketId); if (!ref) return;
    bySocket.delete(socketId);
    const room = rooms.get(ref.code); if (!room) return;
    const p = room.players[ref.slot];
    if (!p || p.socketId !== socketId) return;
    p.connected = false; p.ready = false;
    p.reconnectEndsAt = Date.now() + T.RECONNECT_MS;
    p.timer = setTimeout(() => expire(room, ref.slot), T.RECONNECT_MS);
    engine.pause(room);
    if (room.players.every(x => !x || !x.connected)) scheduleEmpty(room);
    syncRoom(room);
  }

  /** Se acabó el tiempo para volver (o el jugador salió a propósito). */
  function expire(room, slot) {
    const p = room.players[slot];
    if (!p || p.connected) return;
    p.timer = null;
    const otro = room.players[1 - slot];
    const fase = room.state.phase;
    if (fase === 'LOBBY') room.players[slot] = null;
    else {
      p.left = true;
      if (fase !== 'GAME_OVER' && otro && otro.connected) engine.forfeit(room, slot);
    }
    if (room.players.every(x => !x || !x.connected)) scheduleEmpty(room);
    if (rooms.has(room.code)) syncRoom(room);
  }

  /** "Volver al menú": libera el lugar al instante. */
  function leave(socketId) {
    const ref = bySocket.get(socketId); if (!ref) return;
    bySocket.delete(socketId);
    const room = rooms.get(ref.code); if (!room) return;
    const p = room.players[ref.slot];
    if (!p || p.socketId !== socketId) return;
    if (p.timer) clearTimeout(p.timer);
    p.connected = false; p.ready = false; p.reconnectEndsAt = 0;
    expire(room, ref.slot);
  }

  function scheduleEmpty(room) {
    cancelEmpty(room);
    room.emptyTimer = setTimeout(() => deleteRoom(room.code), T.EMPTY_ROOM_MS);
  }
  function cancelEmpty(room) { if (room.emptyTimer) { clearTimeout(room.emptyTimer); room.emptyTimer = null; } }

  function deleteRoom(code) {
    const room = rooms.get(code); if (!room) return;
    engine.clearPhaseTimer(room); cancelEmpty(room);
    room.players.forEach(p => { if (p && p.timer) clearTimeout(p.timer); if (p) bySocket.delete(p.socketId); });
    rooms.delete(code);
  }

  /** Limpieza periódica: salas vacías o abandonadas en la sala de espera por más de 2 horas. */
  function sweep(maxLobbyMs = 2 * 60 * 60 * 1000) {
    const ahora = Date.now();
    for (const room of rooms.values()) {
      const nadie = room.players.every(p => !p || !p.connected);
      if (nadie && !room.emptyTimer) scheduleEmpty(room);
      if (room.state.phase === 'LOBBY' && ahora - room.createdAt > maxLobbyMs) deleteRoom(room.code);
    }
  }

  const context = socketId => {
    const ref = bySocket.get(socketId); if (!ref) return null;
    const room = rooms.get(ref.code); if (!room) return null;
    const p = room.players[ref.slot];
    if (!p || p.socketId !== socketId || !p.connected) return null;
    return { room, slot: ref.slot };
  };

  return { createRoom, joinRoom, resumeRoom, setReady, disconnect, leave, sweep, deleteRoom, context, engine, rooms, bySocket };
}

module.exports = { createRoomManager, genCode };
