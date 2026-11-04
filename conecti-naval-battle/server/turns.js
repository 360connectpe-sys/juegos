'use strict';
/*
 * Máquina de estados con TURNOS SIMULTÁNEOS (el servidor es la única autoridad).
 *
 *   LOBBY → WAITING → MOVEMENT → AIMING → PROJECTILE → RESOLUTION → NEXT_TURN → MOVEMENT …
 *                                                                  ↘ GAME_OVER
 *   MOVEMENT (15 s): los dos mueven su barco a la vez. Termina cuando ambos confirman o se acaba el tiempo.
 *   AIMING   (20 s): los dos apuntan EN SECRETO y fijan su disparo. Termina cuando ambos disparan o se acaba
 *                    el tiempo (quien no disparó pierde ese tiro).
 *   PROJECTILE:      los dos proyectiles salen juntos; el servidor ya calculó ambas trayectorias.
 *   RESOLUTION:      se aplica el daño de los dos impactos a la vez. Si los dos llegan a 0 HP: empate.
 *   Cualquier fase con tiempo → PAUSED si alguien se desconecta → la misma fase al volver.
 */
const C = require('../shared/constants');
const { simulateShot } = require('./physics');
const { resetForMatch } = require('./gameState');

function createTurnEngine({ emit, sync, timings = {}, now = () => Date.now() }) {
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
  const alTerminar = (room, fase) => (fase === 'MOVEMENT' ? () => endMovement(room) : () => launch(room));

  /** Ambos listos: reinicia la partida. */
  function startMatch(room) {
    resetForMatch(room.state);
    room.players.forEach(p => { p.ready = false; p.rematch = false; });
    setPhase(room, 'WAITING', T.START_DELAY_MS, () => beginRound(room));
    emit(room, 'matchStart', { match: room.state.match });
    sync(room);
  }

  function beginRound(room) {
    const s = room.state;
    s.round += 1;
    s.moved = [false, false];
    s.locked = [false, false];
    s.pending = [null, null];
    s.lastResult = null;
    s.ships.forEach(sh => { sh.moveLeft = C.MOVE_BUDGET; });
    enterTimed(room, 'MOVEMENT', T.MOVE_MS);
  }

  /** Entra a una fase con tiempo; si falta alguien, la deja en pausa con el tiempo completo. */
  function enterTimed(room, phase, ms) {
    const s = room.state;
    if (anyoneAway(room)) {
      clearPhaseTimer(room);
      s.phase = 'PAUSED'; s.pausedPhase = phase; s.pausedRemaining = ms; s.phaseEndsAt = 0;
      sync(room);
      return;
    }
    setPhase(room, phase, ms, alTerminar(room, phase));
    sync(room);
  }

  function endMovement(room) {
    const s = room.state;
    if (s.phase !== 'MOVEMENT') return;
    s.ships.forEach(sh => { sh.moveLeft = 0; });
    s.moved = [true, true];
    enterTimed(room, 'AIMING', T.AIM_MS);
  }

  // ---------------- Acciones del jugador (ya validadas en tipo y rango) ----------------

  /** Mueve el barco del jugador. Devuelve los píxeles realmente recorridos. */
  function move(room, slot, dx) {
    const s = room.state;
    if (s.phase !== 'MOVEMENT' || s.moved[slot]) return 0;
    const ship = s.ships[slot];
    if (ship.moveLeft <= 0) return 0;
    const pedido = Math.sign(dx) * Math.min(Math.abs(dx), ship.moveLeft);
    const [min, max] = C.ZONES[slot];
    const nuevo = Math.max(min, Math.min(max, ship.x + pedido));
    const recorrido = Math.abs(nuevo - ship.x);
    ship.x = nuevo;
    ship.moveLeft -= recorrido;           // distancia absoluta: ir y volver también gasta
    if (ship.moveLeft <= 0) confirmMove(room, slot);
    else sync(room);
    return recorrido;
  }

  function confirmMove(room, slot) {
    const s = room.state;
    if (s.phase !== 'MOVEMENT' || s.moved[slot]) return false;
    s.moved[slot] = true;
    s.ships[slot].moveLeft = 0;
    if (s.moved[0] && s.moved[1]) endMovement(room);
    else sync(room);
    return true;
  }

  /** Mira privada: se guarda, pero NO se envía al rival (el disparo es secreto hasta que salen los dos). */
  function setAim(room, slot, aim) {
    const s = room.state;
    if ((s.phase !== 'AIMING' && s.phase !== 'MOVEMENT') || s.locked[slot]) return false;
    s.aim[slot] = aim;
    return true;
  }

  /** Fija el disparo del jugador (uno por ronda). Cuando los dos dispararon, salen juntos. */
  function fire(room, slot, aim) {
    const s = room.state;
    if (s.phase !== 'AIMING' || s.locked[slot]) return false;
    s.locked[slot] = true;
    s.aim[slot] = aim;
    s.pending[slot] = aim;
    if (s.locked[0] && s.locked[1]) launch(room);
    else sync(room);
    return true;
  }

  /** Calcula las dos trayectorias con las posiciones finales y las lanza a la vez. */
  function launch(room) {
    const s = room.state;
    if (s.phase !== 'AIMING') return;
    const shots = [0, 1].filter(i => s.pending[i]).map(i => {
      const a = s.pending[i];
      const sim = simulateShot({ shooter: i, ships: s.ships, angle: a.angle, power: a.power });
      s.shownAim[i] = { ...a };
      return { shooter: i, angle: a.angle, power: a.power, projectile: a.projectile, path: sim.path, impact: sim.impact, flightMs: sim.flightMs };
    });
    const missed = [0, 1].filter(i => !s.pending[i]);
    const dur = Math.max(700, ...shots.map(x => x.flightMs));
    s.lastResult = { shots: shots.map(x => ({ shooter: x.shooter, ...x.impact })), missed };
    emit(room, 'shots', { shots, missed });
    setPhase(room, 'PROJECTILE', dur, () => resolve(room, shots, missed));
    sync(room);
  }

  function resolve(room, shots, missed) {
    const s = room.state;
    const impacts = shots.map(x => ({ shooter: x.shooter, ...x.impact }));
    for (const imp of impacts) {
      if (imp.type !== 'hull') continue;
      const t = s.ships[imp.target];
      t.hp = Math.max(0, t.hp - imp.damage);   // nunca bajo cero
    }
    emit(room, 'resolution', { impacts, missed, hp: s.ships.map(x => x.hp) });
    setPhase(room, 'RESOLUTION', T.RESOLUTION_MS, () => nextRound(room));
    sync(room);
  }

  function nextRound(room) {
    const s = room.state;
    const muertos = s.ships.map(x => x.hp <= 0);
    if (muertos[0] && muertos[1]) return gameOver(room, null, 'empate');
    if (muertos[0] || muertos[1]) return gameOver(room, muertos[0] ? 1 : 0, 'hp');
    setPhase(room, 'NEXT_TURN', 0);
    beginRound(room);
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

  /** Un jugador se fue: si estaba corriendo el tiempo de una fase, se pausa. */
  function pause(room) {
    const s = room.state;
    if (!ACTIVE.includes(s.phase)) return;            // PROJECTILE/RESOLUTION terminan y la siguiente fase entra en pausa
    const restante = Math.max(1000, s.phaseEndsAt - now());
    const fase = s.phase;
    clearPhaseTimer(room);
    s.phase = 'PAUSED'; s.pausedPhase = fase; s.pausedRemaining = restante; s.phaseEndsAt = 0;
    sync(room);
  }

  /** Volvieron todos: se reanuda la fase con el tiempo que le quedaba. */
  function resume(room) {
    const s = room.state;
    if (s.phase !== 'PAUSED' || anyoneAway(room)) return false;
    const fase = s.pausedPhase, ms = s.pausedRemaining;
    s.pausedPhase = null; s.pausedRemaining = 0;
    setPhase(room, fase, ms, alTerminar(room, fase));
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
