'use strict';
/*
 * Máquina de estados: PLAN SECRETO SIMULTÁNEO (el servidor es la única autoridad).
 *
 *   LOBBY → WAITING → PLANNING → REVEAL → RESOLUTION → NEXT_TURN → PLANNING …
 *                                                     ↘ GAME_OVER
 *
 *   PLANNING (20 s): cada uno mueve su barco Y apunta, en secreto. El rival no ve ni el movimiento
 *                    ni la mira: solo sabe si ya tocaste DISPARAR. Termina cuando disparan los dos o
 *                    se acaba el tiempo (quien no disparó no se mueve ni dispara esa ronda).
 *   REVEAL:          se revela todo de una vez: los barcos se deslizan a su nueva posición
 *                    (REVEAL_MOVE_MS) y enseguida salen las bombas, ya calculadas por el servidor.
 *   RESOLUTION:      se aplica el daño de ambos impactos a la vez (con poderes). Si los dos llegan
 *                    a 0 HP: empate.
 *   Cada ronda cambia el viento; cada 3 rondas aparece la Caja 360 colgada de un globo.
 *   PLANNING → PAUSED si alguien se desconecta → PLANNING al volver.
 */
const C = require('../shared/constants');
const { simulateShot } = require('./physics');
const { resetForMatch } = require('./gameState');

function createTurnEngine({ emit, sync, timings = {}, now = () => Date.now(), random = Math.random }) {
  const T = {
    PLAN_MS: timings.PLAN_MS ?? C.PLAN_MS,
    REVEAL_MOVE_MS: timings.REVEAL_MOVE_MS ?? C.REVEAL_MOVE_MS,
    RESOLUTION_MS: timings.RESOLUTION_MS ?? C.RESOLUTION_MS,
    START_DELAY_MS: timings.START_DELAY_MS ?? C.START_DELAY_MS,
  };
  const entre = ([a, b]) => a + random() * (b - a);

  function clearPhaseTimer(room) { if (room.phaseTimer) { clearTimeout(room.phaseTimer); room.phaseTimer = null; } }
  function setPhase(room, phase, ms, next) {
    clearPhaseTimer(room);
    const s = room.state;
    s.phase = phase;
    s.phaseEndsAt = ms ? now() + ms : 0;
    if (ms && next) room.phaseTimer = setTimeout(() => { room.phaseTimer = null; next(); }, ms);
  }
  const anyoneAway = room => room.players.some(p => !p || !p.connected);

  /** Ambos listos: reinicia la partida, sortea rocas y empieza. */
  function startMatch(room) {
    resetForMatch(room.state);
    room.players.forEach(p => { p.ready = false; p.rematch = false; });
    const s = room.state;
    const n = random() < 0.5 ? 1 : 2;
    s.rocks = Array.from({ length: n }, (_, i) => ({
      x: Math.round(n === 1 ? entre(C.ROCKS_X) : i === 0 ? entre([C.ROCKS_X[0], 236]) : entre([244, C.ROCKS_X[1]])),
      w: Math.round(entre(C.ROCK_W)), h: Math.round(entre(C.ROCK_H)),
    }));
    setPhase(room, 'WAITING', T.START_DELAY_MS, () => beginRound(room));
    emit(room, 'matchStart', { match: s.match });
    sync(room);
  }

  function beginRound(room) {
    const s = room.state;
    s.round += 1;
    s.locked = [false, false];
    s.pending = [null, null];
    s.lastResult = null;
    s.wind = Math.round(entre([-C.WIND_MAX, C.WIND_MAX]));
    if (!s.crate && s.round % C.CRATE_EVERY === 0) s.crate = { x: Math.round(entre(C.CRATE_X)), y: Math.round(entre(C.CRATE_Y)) };
    enterPlanning(room, T.PLAN_MS);
  }

  function enterPlanning(room, ms) {
    const s = room.state;
    if (anyoneAway(room)) {
      clearPhaseTimer(room);
      s.phase = 'PAUSED'; s.pausedPhase = 'PLANNING'; s.pausedRemaining = ms; s.phaseEndsAt = 0;
      sync(room);
      return;
    }
    setPhase(room, 'PLANNING', ms, () => reveal(room));
    sync(room);
  }

  // ---------------- Acción del jugador (ya validada en tipo y rango) ----------------

  /** Plan secreto: desplazamiento + mira. Uno por ronda. Cuando están los dos, se revela todo. */
  function submitPlan(room, slot, plan) {
    const s = room.state;
    if (s.phase !== 'PLANNING' || s.locked[slot]) return false;
    s.locked[slot] = true;
    s.pending[slot] = plan;
    if (s.locked[0] && s.locked[1]) reveal(room);
    else sync(room);
    return true;
  }

  /** Aplica los movimientos y calcula los disparos con las posiciones nuevas. */
  function reveal(room) {
    const s = room.state;
    if (s.phase !== 'PLANNING') return;
    const moves = [0, 1].map(i => {
      const from = s.ships[i].x, p = s.pending[i];
      if (!p) return { from, to: from };
      const [min, max] = C.ZONES[i];
      const to = Math.max(min, Math.min(max, from + Math.max(-C.MOVE_BUDGET, Math.min(C.MOVE_BUDGET, p.dx))));
      s.ships[i].x = to;
      return { from, to };
    });
    const shots = [0, 1].filter(i => s.pending[i]).map(i => {
      const p = s.pending[i];
      const sim = simulateShot({ shooter: i, ships: s.ships, angle: p.angle, power: p.power, projectile: p.projectile, wind: s.wind, rocks: s.rocks, crate: s.crate });
      s.shownAim[i] = { angle: p.angle, power: p.power, projectile: p.projectile };
      return { shooter: i, angle: p.angle, power: p.power, projectile: p.projectile, trayectorias: sim.trayectorias, flightMs: sim.flightMs, crateHit: sim.crateHit };
    });
    const missed = [0, 1].filter(i => !s.pending[i]);
    const vuelo = Math.max(500, ...shots.map(x => x.flightMs));
    s.lastResult = { moves, missed };
    emit(room, 'reveal', { moves, shots, missed, wind: s.wind, moveMs: T.REVEAL_MOVE_MS });
    setPhase(room, 'REVEAL', T.REVEAL_MOVE_MS + vuelo, () => resolve(room, shots));
    sync(room);
  }

  function resolve(room, shots) {
    const s = room.state;
    const impacts = [];
    let caja = null;
    // 1) Daño (con DOBLE del tirador y ESCUDO del que recibe)
    const escudoUsado = [false, false];
    for (const sh of shots) {
      const doble = s.powers[sh.shooter].doble;
      let pego = false;
      for (const tr of sh.trayectorias) {
        const imp = { ...tr.impact, shooter: sh.shooter };
        if (imp.type === 'hull') {
          let d = imp.damage * (doble ? 2 : 1);
          if (s.powers[imp.target].escudo) { d = 0; escudoUsado[imp.target] = true; imp.blocked = true; }
          imp.damage = d;
          s.ships[imp.target].hp = Math.max(0, s.ships[imp.target].hp - d);   // nunca bajo cero
          if (imp.target !== sh.shooter) pego = true;
        }
        impacts.push(imp);
      }
      if (doble && pego) s.powers[sh.shooter].doble = false;
    }
    escudoUsado.forEach((u, i) => { if (u) s.powers[i].escudo = false; });
    // 2) Caja 360: si la tocaron los dos en la misma ronda, se la lleva el que la tocó con más vida restante
    const tocaron = shots.filter(x => x.crateHit).map(x => x.shooter);
    if (s.crate && tocaron.length) {
      const by = tocaron.length === 1 ? tocaron[0] : (s.ships[0].hp <= s.ships[1].hp ? 0 : 1);
      const power = C.POWERS[Math.floor(random() * C.POWERS.length)];
      if (power === 'reparar') s.ships[by].hp = Math.min(C.MAX_HP, s.ships[by].hp + C.REPAIR_HP);
      else s.powers[by][power] = true;
      caja = { by, power };
      s.crate = null;
    }
    emit(room, 'resolution', { impacts, hp: s.ships.map(x => x.hp), powers: s.powers.map(p => ({ ...p })), crate: caja });
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
    emit(room, 'gameOver', { winner, reason, hp: s.ships.map(x => x.hp), round: s.round, names: room.players.map(p => p && p.name) });
    sync(room);
  }

  // ---------------- Desconexiones ----------------

  /** Un jugador se fue: si corría el tiempo del plan, se pausa (los planes ya enviados se conservan). */
  function pause(room) {
    const s = room.state;
    if (s.phase !== 'PLANNING') return;
    const restante = Math.max(3000, s.phaseEndsAt - now());
    clearPhaseTimer(room);
    s.phase = 'PAUSED'; s.pausedPhase = 'PLANNING'; s.pausedRemaining = restante; s.phaseEndsAt = 0;
    sync(room);
  }

  /** Volvieron todos: se reanuda el plan con el tiempo que le quedaba. */
  function resume(room) {
    const s = room.state;
    if (s.phase !== 'PAUSED' || anyoneAway(room)) return false;
    const ms = s.pausedRemaining;
    s.pausedPhase = null; s.pausedRemaining = 0;
    setPhase(room, 'PLANNING', ms, () => reveal(room));
    sync(room);
    return true;
  }

  /** Reconstruye los temporizadores después de recuperar una sala guardada (anfitrión que recargó). */
  function restore(room) {
    const s = room.state;
    clearPhaseTimer(room);
    if (['PLANNING', 'PAUSED'].includes(s.phase)) { s.locked = [false, false]; s.pending = [null, null]; s.pausedPhase = null; enterPlanning(room, T.PLAN_MS); }
    else if (['REVEAL', 'RESOLUTION', 'NEXT_TURN'].includes(s.phase)) nextRound(room);
    else if (s.phase === 'WAITING') beginRound(room);
    else sync(room);
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

  return { startMatch, submitPlan, pause, resume, restore, forfeit, requestRematch, clearPhaseTimer, timings: T };
}

module.exports = { createTurnEngine };
