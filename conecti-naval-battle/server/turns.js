'use strict';
/*
 * Máquina de estados de la partida (el servidor es la única autoridad).
 *   LOBBY → WAITING → MOVEMENT → AIMING → PROJECTILE → RESOLUTION → NEXT_TURN → MOVEMENT …
 *                                                                  ↘ GAME_OVER
 *   Cualquier fase de turno → PAUSED (si un jugador se desconecta) → la misma fase al volver.
 * Todos los temporizadores viven aquí; los relojes de los teléfonos no deciden nada.
 */
const C = require('../shared/constants');
const { simulateShot } = require('./physics');
const { resetForMatch } = require('./gameState');

/**
 * @param {object} opts
 *   emit(room, event, payload)  envía a toda la sala
 *   sync(room)                  envía el estado público a toda la sala
 *   timings                     { MOVE_MS, AIM_MS, RESOLUTION_MS, START_DELAY_MS }
 *   random()                    para decidir quién empieza (inyectable en pruebas)
 */
function createTurnEngine({ emit, sync, timings = {}, random = Math.random, now = () => Date.now() }) {
  const T = {
    MOVE_MS: timings.MOVE_MS ?? C.MOVE_MS,
    AIM_MS: timings.AIM_MS ?? C.AIM_MS,
    RESOLUTION_MS: timings.RESOLUTION_MS ?? C.RESOLUTION_MS,
    START_DELAY_MS: timings.START_DELAY_MS ?? C.START_DELAY_MS,
  };

  function clearPhaseTimer(room) { if (room.phaseTimer) { clearTimeout(room.phaseTimer); room.phaseTimer = null; } }
  function setPhase(room, phase, ms, next) {
    clearPhaseTimer(room);
    const s = room.state;
    s.phase = phase;
    s.phaseEndsAt = ms ? now() + ms : 0;
    if (ms && next) room.phaseTimer = setTimeout(() => { room.phaseTimer = null; next(); }, ms);
  }
  const anyoneAway = room => room.players.some(p => !p || !p.connected);

  /** Ambos listos: reinicia la partida y sortea quién empieza. */
  function startMatch(room) {
    resetForMatch(room.state);
    room.players.forEach(p => { p.ready = false; p.rematch = false; });
    const s = room.state;
    s.turn = random() < 0.5 ? 0 : 1;
    setPhase(room, 'WAITING', T.START_DELAY_MS, () => beginTurn(room));
    emit(room, 'matchStart', { first: s.turn, match: s.match });
    sync(room);
  }

  function beginTurn(room) {
    const s = room.state;
    s.round += 1;
    s.fired = false;
    s.lastResult = null;
    s.ships[s.turn].moveLeft = C.MOVE_BUDGET;
    enterTimed(room, 'MOVEMENT', T.MOVE_MS, () => endMovement(room));
  }

  /** Entra a una fase con tiempo; si falta alguien, la deja en pausa con el tiempo completo. */
  function enterTimed(room, phase, ms, onTimeout) {
    const s = room.state;
    if (anyoneAway(room)) {
      clearPhaseTimer(room);
      s.phase = 'PAUSED'; s.pausedPhase = phase; s.pausedRemaining = ms; s.phaseEndsAt = 0;
      room.onResume = onTimeout;
      sync(room);
      return;
    }
    setPhase(room, phase, ms, onTimeout);
    sync(room);
  }

  function endMovement(room) {
    const s = room.state;
    if (s.phase !== 'MOVEMENT') return;
    s.ships[s.turn].moveLeft = 0;
    enterTimed(room, 'AIMING', T.AIM_MS, () => aimTimeout(room));
  }

  function aimTimeout(room) {
    const s = room.state;
    if (s.phase !== 'AIMING' || s.fired) return;
    s.lastResult = { type: 'timeout', shooter: s.turn };
    emit(room, 'timeout', { shooter: s.turn });
    setPhase(room, 'RESOLUTION', Math.min(T.RESOLUTION_MS, 1400), () => nextTurn(room));
    sync(room);
  }

  // ---------------- Acciones del jugador (ya validadas en tipo y rango) ----------------

  /** Mueve el barco del jugador activo. Devuelve los píxeles realmente recorridos. */
  function move(room, slot, dx) {
    const s = room.state;
    if (s.phase !== 'MOVEMENT' || s.turn !== slot) return 0;
    const ship = s.ships[slot];
    if (ship.moveLeft <= 0) return 0;
    const pedido = Math.sign(dx) * Math.min(Math.abs(dx), ship.moveLeft);
    const [min, max] = C.ZONES[slot];
    const nuevo = Math.max(min, Math.min(max, ship.x + pedido));
    const recorrido = Math.abs(nuevo - ship.x);
    ship.x = nuevo;
    ship.moveLeft -= recorrido;           // distancia absoluta: ir y volver también gasta
    sync(room);
    if (ship.moveLeft <= 0) endMovement(room);
    return recorrido;
  }

  function confirmMove(room, slot) {
    const s = room.state;
    if (s.phase !== 'MOVEMENT' || s.turn !== slot) return false;
    endMovement(room);
    return true;
  }

  /** Actualiza la mira (solo visual para el rival). No cambia de fase. */
  function setAim(room, slot, aim) {
    const s = room.state;
    if (s.turn !== slot || (s.phase !== 'AIMING' && s.phase !== 'MOVEMENT')) return false;
    s.aim[slot] = aim;
    emit(room, 'aim', { slot, ...aim });
    return true;
  }

  function fire(room, slot, aim) {
    const s = room.state;
    if (s.phase !== 'AIMING' || s.turn !== slot || s.fired) return false;
    s.fired = true;
    s.aim[slot] = aim;
    const shot = simulateShot({ shooter: slot, ships: s.ships, angle: aim.angle, power: aim.power });
    s.lastResult = { ...shot.impact, shooter: slot };
    emit(room, 'shot', { shooter: slot, angle: aim.angle, power: aim.power, projectile: aim.projectile, path: shot.path, impact: shot.impact, flightMs: shot.flightMs });
    setPhase(room, 'PROJECTILE', shot.flightMs, () => resolve(room, slot, shot.impact));
    sync(room);
    return true;
  }

  function resolve(room, shooter, impact) {
    const s = room.state;
    if (impact.type === 'hull') {
      const t = s.ships[impact.target];
      t.hp = Math.max(0, t.hp - impact.damage);   // nunca bajo cero
    }
    emit(room, 'resolution', { shooter, impact, hp: s.ships.map(x => x.hp) });
    setPhase(room, 'RESOLUTION', T.RESOLUTION_MS, () => nextTurn(room));
    sync(room);
  }

  function nextTurn(room) {
    const s = room.state;
    const muertos = s.ships.map(x => x.hp <= 0);
    if (muertos[0] || muertos[1]) {
      // Si un disparo propio hunde al tirador, gana el rival.
      const winner = muertos[0] && muertos[1] ? 1 - s.turn : muertos[0] ? 1 : 0;
      return gameOver(room, winner, 'hp');
    }
    setPhase(room, 'NEXT_TURN', 0);
    s.turn = 1 - s.turn;
    beginTurn(room);
  }

  function gameOver(room, winner, reason) {
    clearPhaseTimer(room);
    const s = room.state;
    s.phase = 'GAME_OVER'; s.phaseEndsAt = 0; s.pausedPhase = null;
    s.winner = winner; s.reason = reason;
    room.players.forEach(p => { if (p) p.rematch = false; });
    emit(room, 'gameOver', { winner, reason, hp: s.ships.map(x => x.hp) });
    sync(room);
  }

  // ---------------- Desconexiones ----------------
  const ACTIVE = ['MOVEMENT', 'AIMING'];

  /** Un jugador se fue: si estaba corriendo el tiempo de un turno, se pausa. */
  function pause(room) {
    const s = room.state;
    if (!ACTIVE.includes(s.phase)) return;            // PROJECTILE/RESOLUTION terminan y la siguiente fase entra en pausa
    const restante = Math.max(1000, s.phaseEndsAt - now());
    const fase = s.phase;
    clearPhaseTimer(room);
    s.phase = 'PAUSED'; s.pausedPhase = fase; s.pausedRemaining = restante; s.phaseEndsAt = 0;
    room.onResume = fase === 'MOVEMENT' ? () => endMovement(room) : () => aimTimeout(room);
    sync(room);
  }

  /** Volvieron todos: se reanuda la fase con el tiempo que le quedaba. */
  function resume(room) {
    const s = room.state;
    if (s.phase !== 'PAUSED' || anyoneAway(room)) return false;
    const fase = s.pausedPhase, ms = s.pausedRemaining, cb = room.onResume;
    s.pausedPhase = null; s.pausedRemaining = 0; room.onResume = null;
    setPhase(room, fase, ms, cb);
    sync(room);
    return true;
  }

  function forfeit(room, loserSlot) {
    const s = room.state;
    if (s.phase === 'LOBBY' || s.phase === 'GAME_OVER') return false;
    gameOver(room, 1 - loserSlot, 'abandono');
    return true;
  }

  function requestRematch(room, slot) {
    const s = room.state;
    if (s.phase !== 'GAME_OVER') return false;
    const p = room.players[slot];
    if (!p) return false;
    p.rematch = true;
    sync(room);
    if (room.players.every(x => x && x.connected && x.rematch)) startMatch(room);
    return true;
  }

  return { startMatch, move, confirmMove, setAim, fire, pause, resume, forfeit, requestRematch, clearPhaseTimer, timings: T };
}

module.exports = { createTurnEngine };
