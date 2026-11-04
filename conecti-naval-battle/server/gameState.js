'use strict';
/* Estado autoritativo de una partida y su versión pública (lo que ven los clientes). */
const C = require('../shared/constants');

function newMatchState() {
  return {
    phase: 'LOBBY',          // LOBBY → WAITING → MOVEMENT → AIMING → PROJECTILE → RESOLUTION → NEXT_TURN … → GAME_OVER
    round: 0,
    phaseEndsAt: 0,
    pausedPhase: null,
    pausedRemaining: 0,
    ships: [0, 1].map(i => ({ x: C.START_X[i], hp: C.MAX_HP, moveLeft: 0 })),
    moved: [false, false],   // ya confirmó su movimiento en esta ronda
    locked: [false, false],  // ya fijó su disparo en esta ronda
    aim: [0, 1].map(() => ({ angle: 45, power: 60, projectile: 'tiktok' })),        // PRIVADO: mira actual de cada uno
    pending: [null, null],                                                          // PRIVADO: disparos fijados, aún secretos
    shownAim: [0, 1].map(() => ({ angle: 45, power: 60, projectile: 'tiktok' })),   // PÚBLICO: último disparo ya lanzado
    lastResult: null,
    winner: null,            // 0, 1 o null (empate)
    reason: null,            // 'hp' | 'abandono' | 'empate'
    match: 0,                // número de partida dentro de la sala (sube con cada revancha)
  };
}

function resetForMatch(state) {
  const match = state.match + 1;
  Object.assign(state, newMatchState(), { match });
}

/** Snapshot público: sin tokens, sin ids de socket y sin los disparos secretos. */
function publicState(room, now = Date.now()) {
  const s = room.state;
  return {
    code: room.code,
    serverNow: now,
    phase: s.phase,
    pausedPhase: s.pausedPhase,
    round: s.round,
    match: s.match,
    phaseEndsAt: s.phaseEndsAt,
    pausedRemaining: s.pausedRemaining,
    ships: s.ships.map(sh => ({ x: sh.x, hp: sh.hp, moveLeft: sh.moveLeft })),
    moved: [...s.moved],
    locked: [...s.locked],
    aim: s.shownAim.map(a => ({ ...a })),
    winner: s.winner,
    reason: s.reason,
    players: room.players.map(p => p && {
      name: p.name, conecti: p.conecti, ship: p.ship,
      connected: p.connected, ready: p.ready, rematch: p.rematch,
      reconnectEndsAt: p.connected ? 0 : p.reconnectEndsAt || 0,
    }),
  };
}

module.exports = { newMatchState, resetForMatch, publicState };
