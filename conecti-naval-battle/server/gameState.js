'use strict';
/* Estado autoritativo de una partida y su versión pública (lo que ven los clientes). */
const C = require('../shared/constants');

function newMatchState() {
  return {
    phase: 'LOBBY',          // LOBBY → WAITING → MOVEMENT → AIMING → PROJECTILE → RESOLUTION → NEXT_TURN … → GAME_OVER
    turn: 0,
    round: 0,
    phaseEndsAt: 0,
    pausedPhase: null,
    pausedRemaining: 0,
    ships: [0, 1].map(i => ({ x: C.START_X[i], hp: C.MAX_HP, moveLeft: 0 })),
    aim: [0, 1].map(() => ({ angle: 45, power: 60, projectile: 'tiktok' })),
    fired: false,
    lastResult: null,
    winner: null,
    reason: null,            // 'hp' | 'abandono'
    match: 0,                // número de partida dentro de la sala (sube con cada revancha)
  };
}

function resetForMatch(state) {
  const match = state.match + 1;
  Object.assign(state, newMatchState(), { match });
}

/** Snapshot público: sin tokens, sin ids de socket. */
function publicState(room, now = Date.now()) {
  const s = room.state;
  return {
    code: room.code,
    serverNow: now,
    phase: s.phase,
    pausedPhase: s.pausedPhase,
    turn: s.turn,
    round: s.round,
    match: s.match,
    phaseEndsAt: s.phaseEndsAt,
    pausedRemaining: s.pausedRemaining,
    ships: s.ships.map(sh => ({ x: sh.x, hp: sh.hp, moveLeft: sh.moveLeft })),
    aim: s.aim.map(a => ({ ...a })),
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
