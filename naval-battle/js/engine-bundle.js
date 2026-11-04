/* Generado por scripts/build-pages.js — NO editar a mano: edita server/*.js y vuelve a generar. */
(function (root) {
  'use strict';
  // "crypto" de Node usando la API del navegador
  const cryptoShim = {
    randomInt(n) { const a = new Uint32Array(1); let x; do { root.crypto.getRandomValues(a); x = a[0]; } while (x >= Math.floor(0x100000000 / n) * n); return x % n; },
    randomBytes(n) { const a = new Uint8Array(n); root.crypto.getRandomValues(a); return { toString() { return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); } }; },
    timingSafeEqual(a, b) { let d = a.length ^ b.length; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; },
  };
  const Buffer = { from: s => new TextEncoder().encode(String(s)) };
  const defs = {}, cache = {};
  function req(nombre) {
    if (nombre === 'crypto') return cryptoShim;
    const k = nombre.split('/').pop().replace(/\.js$/, '');
    if (!cache[k]) { const module = { exports: {} }; cache[k] = module; defs[k](module, module.exports, req, Buffer); }
    return cache[k].exports;
  }

  defs["constants"] = function (module, exports, require, Buffer) {
/*
 * Constantes compartidas entre servidor (require) y navegador (window.CNB).
 * Todo el mundo del juego usa coordenadas lógicas de 480 × 270 px:
 * x crece hacia la derecha, y crece hacia abajo.
 */
(function (root) {
  const C = {
    WIDTH: 480,
    HEIGHT: 270,
    SEA_Y: 206,              // nivel del mar (lo que toca esta línea cae al agua)

    // Barco
    HULL_W: 64,              // largo del casco
    HULL_TOP: 194,           // cubierta (borde superior del casco)
    HULL_BOTTOM: 210,        // quilla visible (un poco bajo el agua)
    START_X: [92, 388],      // centro inicial de cada barco
    ZONES: [[40, 200], [280, 440]], // límites del CENTRO de cada barco (nunca se tocan: 232 < 248)
    FACING: [1, -1],         // jugador 0 mira a la derecha, jugador 1 a la izquierda
    MAX_HP: 100,

    // Cañón (pivote relativo al centro del barco, en el sentido en que mira)
    CANNON_PIVOT_DX: 10,
    CANNON_PIVOT_Y: 186,
    CANNON_LEN: 14,

    // Movimiento
    MOVE_BUDGET: 24,         // píxeles lógicos por turno (distancia absoluta)
    MOVE_STEP_MAX: 4,        // máximo por mensaje

    // Disparo
    ANGLE_MIN: 15, ANGLE_MAX: 80,
    POWER_MIN: 20, POWER_MAX: 100,
    V_MAX: 235,              // px/s a potencia 100 %
    GRAVITY: 120,            // px/s²
    PHYS_HZ: 60,             // paso fijo de la simulación
    PROJECTILE_R: 3,
    SELF_HIT_GRACE: 12,      // pasos en que el proyectil ignora el propio barco al salir
    MAX_FLIGHT_S: 14,
    PATH_EVERY: 2,           // se envía 1 de cada N pasos al cliente (30 puntos/s)

    // Daño por zona del casco (en coordenadas locales: 0 = popa, 1 = proa)
    DAMAGE_CRIT: 20,
    DAMAGE_ARMOR: 8,

    // Tiempos (ms) — el servidor los puede sobrescribir con variables de entorno
    MOVE_MS: 15000,
    AIM_MS: 20000,
    RESOLUTION_MS: 1800,
    START_DELAY_MS: 2500,
    RECONNECT_MS: 30000,
    EMPTY_ROOM_MS: 60000,

    COLORS: {
      morado: '#8A2BE2',
      azul: '#00BFFF',
      verde: '#32CD32',
    },
    PROJECTILES: ['tiktok', 'instagram'],
    NAME_MAX: 14,

    PHASES: ['WAITING', 'MOVEMENT', 'AIMING', 'PROJECTILE', 'RESOLUTION', 'NEXT_TURN', 'GAME_OVER', 'PAUSED'],
  };
  C.COLOR_KEYS = Object.keys(C.COLORS);
  if (typeof module !== 'undefined' && module.exports) module.exports = C;
  else root.CNB = C;
})(typeof window !== 'undefined' ? window : this);

  };

  defs["collisions"] = function (module, exports, require, Buffer) {
'use strict';
/* Colisiones del proyectil con los cascos y cálculo de daño por zona. */
const C = require('../shared/constants');

/** Rectángulo del casco de un barco centrado en x (coordenadas del mundo). */
function hullRect(shipX) {
  return { left: shipX - C.HULL_W / 2, right: shipX + C.HULL_W / 2, top: C.HULL_TOP, bottom: C.HULL_BOTTOM };
}

/** ¿El círculo (px, py, r) toca el casco? */
function hitsHull(shipX, px, py, r = C.PROJECTILE_R) {
  const h = hullRect(shipX);
  const cx = Math.max(h.left, Math.min(px, h.right));
  const cy = Math.max(h.top, Math.min(py, h.bottom));
  const dx = px - cx, dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

/**
 * Zona del casco según coordenadas LOCALES del barco.
 * u = 0 en la popa (atrás) y u = 1 en la proa (adelante), según hacia dónde mira el barco.
 */
function zoneAt(shipX, facing, hitX) {
  const h = hullRect(shipX);
  let u = (Math.max(h.left, Math.min(hitX, h.right)) - h.left) / C.HULL_W; // 0 a la izquierda
  if (facing < 0) u = 1 - u;                                                // proa a la izquierda
  if (u >= 0.75) return { zone: 'proa', damage: C.DAMAGE_CRIT, u };
  if (u < 0.25) return { zone: 'popa', damage: C.DAMAGE_CRIT, u };
  return { zone: 'centro', damage: C.DAMAGE_ARMOR, u };
}

module.exports = { hullRect, hitsHull, zoneAt };

  };

  defs["physics"] = function (module, exports, require, Buffer) {
'use strict';
/*
 * Física determinista del disparo (paso fijo).
 *   vx = v · cos(θ) · facing      vy = v · sin(θ)
 *   x(t) = x0 + vx·t              y(t) = y0 − vy·t + ½·g·t²   (y crece hacia abajo)
 * Se integra con paso fijo dt = 1/PHYS_HZ usando la fórmula cerrada en cada paso
 * (sin error acumulado) y se revisan colisiones entre pasos con sub-muestreo.
 */
const C = require('../shared/constants');
const { hitsHull, zoneAt } = require('./collisions');

const toRad = d => (d * Math.PI) / 180;

/** Boca del cañón en el mundo, según la posición del barco, su orientación y el ángulo. */
function muzzle(shipX, facing, angleDeg) {
  const px = shipX + facing * C.CANNON_PIVOT_DX, py = C.CANNON_PIVOT_Y;
  const a = toRad(angleDeg);
  return { x: px + facing * Math.cos(a) * C.CANNON_LEN, y: py - Math.sin(a) * C.CANNON_LEN };
}

/**
 * Simula un disparo.
 * @param {object} p  { shooter, ships:[{x},{x}], angle, power }
 * @returns {object}  { path:[[x,y]...], impact:{type,x,y,target?,zone?,damage}, flightMs }
 */
function simulateShot({ shooter, ships, angle, power }) {
  const facing = C.FACING[shooter];
  const start = muzzle(ships[shooter].x, facing, angle);
  const v = (power / 100) * C.V_MAX;
  const a = toRad(angle);
  const vx = v * Math.cos(a) * facing, vy = v * Math.sin(a);
  const dt = 1 / C.PHYS_HZ, g = C.GRAVITY;
  const maxSteps = Math.ceil(C.MAX_FLIGHT_S * C.PHYS_HZ);
  const SUB = 3;

  const path = [[round1(start.x), round1(start.y)]];
  let prev = { x: start.x, y: start.y };
  let impact = null;

  for (let step = 1; step <= maxSteps && !impact; step++) {
    for (let s = 1; s <= SUB && !impact; s++) {
      const t = (step - 1 + s / SUB) * dt;
      const x = start.x + vx * t;
      const y = start.y - vy * t + 0.5 * g * t * t;
      // Cascos: primero el rival, luego el propio (después del período de gracia)
      const order = [1 - shooter, shooter];
      for (const target of order) {
        if (target === shooter && step <= C.SELF_HIT_GRACE) continue;
        if (hitsHull(ships[target].x, x, y)) {
          const z = zoneAt(ships[target].x, C.FACING[target], x);
          impact = { type: 'hull', x: round1(x), y: round1(y), target, zone: z.zone, damage: z.damage, self: target === shooter };
          break;
        }
      }
      if (impact) break;
      if (y >= C.SEA_Y) {
        // Punto exacto donde cruza el nivel del mar (interpolación lineal)
        const k = (C.SEA_Y - prev.y) / (y - prev.y || 1);
        impact = { type: 'water', x: round1(prev.x + (x - prev.x) * k), y: C.SEA_Y, damage: 0 };
        break;
      }
      if (x < -40 || x > C.WIDTH + 40) { impact = { type: 'out', x: round1(x), y: round1(y), damage: 0 }; break; }
      prev = { x, y };
    }
    if (step % C.PATH_EVERY === 0 || impact) path.push([round1(prev.x), round1(prev.y)]);
    if (impact) { path.push([impact.x, impact.y]); }
    else if (step === maxSteps) impact = { type: 'out', x: round1(prev.x), y: round1(prev.y), damage: 0 };
  }
  const flightMs = Math.round(((path.length - 1) * C.PATH_EVERY * 1000) / C.PHYS_HZ);
  return { start, path, impact, flightMs: Math.max(300, flightMs) };
}

const round1 = n => Math.round(n * 10) / 10;

module.exports = { simulateShot, muzzle };

  };

  defs["gameState"] = function (module, exports, require, Buffer) {
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

  };

  defs["turns"] = function (module, exports, require, Buffer) {
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

  };

  defs["validation"] = function (module, exports, require, Buffer) {
'use strict';
/* Validación y saneamiento de todo lo que llega por Socket.io. Nunca se confía en el cliente. */
const C = require('../shared/constants');

const CODE_RE = /^CNX-[A-HJ-NP-Z2-9]{4}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);

/** Deja solo letras, números, espacio, punto, guion y guion bajo. Máximo NAME_MAX caracteres. */
function sanitizeName(v) {
  if (typeof v !== 'string') return 'Capitán';
  const limpio = v.normalize('NFC').replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, C.NAME_MAX);
  return limpio || 'Capitán';
}

function color(v) { return typeof v === 'string' && C.COLOR_KEYS.includes(v) ? v : null; }

function profile(p) {
  if (!isObj(p)) return null;
  const conecti = color(p.conecti), ship = color(p.ship);
  if (!conecti || !ship) return null;
  return { name: sanitizeName(p.name), conecti, ship };
}

function roomCode(v) {
  if (typeof v !== 'string' || v.length > 20) return null;
  const s = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const cuerpo = s.length === 7 && s.startsWith('CNX') ? s.slice(3) : s.length === 4 ? s : null;
  if (!cuerpo) return null;
  const c = 'CNX-' + cuerpo;
  return CODE_RE.test(c) ? c : null;
}

function token(v) { return typeof v === 'string' && TOKEN_RE.test(v) ? v : null; }

/** Paso de movimiento: entero distinto de 0 entre −MOVE_STEP_MAX y +MOVE_STEP_MAX. */
function moveStep(p) {
  if (!isObj(p) || !isNum(p.dx) || !Number.isInteger(p.dx)) return null;
  if (p.dx === 0 || Math.abs(p.dx) > C.MOVE_STEP_MAX) return null;
  return p.dx;
}

/** Ángulo, potencia y proyectil. Valores fuera de rango se rechazan (no se ajustan). */
function aim(p) {
  if (!isObj(p) || !isNum(p.angle) || !isNum(p.power)) return null;
  if (p.angle < C.ANGLE_MIN || p.angle > C.ANGLE_MAX) return null;
  if (p.power < C.POWER_MIN || p.power > C.POWER_MAX) return null;
  const projectile = C.PROJECTILES.includes(p.projectile) ? p.projectile : null;
  if (!projectile) return null;
  return { angle: Math.round(p.angle * 10) / 10, power: Math.round(p.power * 10) / 10, projectile };
}

/**
 * Límite de frecuencia por conexión: cubeta de fichas (ráfaga) + intervalo mínimo por tipo de evento.
 */
function createRateLimiter({ capacity = 25, refillPerSec = 20, minIntervals = {} } = {}) {
  let tokens = capacity, last = Date.now();
  const lastByType = {};
  return function allow(type) {
    const now = Date.now();
    tokens = Math.min(capacity, tokens + ((now - last) / 1000) * refillPerSec);
    last = now;
    const min = minIntervals[type] || 0;
    if (min && lastByType[type] && now - lastByType[type] < min) return false;
    if (tokens < 1) return false;
    tokens -= 1;
    lastByType[type] = now;
    return true;
  };
}

module.exports = { sanitizeName, profile, roomCode, token, moveStep, aim, createRateLimiter, CODE_RE };

  };

  defs["rooms"] = function (module, exports, require, Buffer) {
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

  };

  root.CNB_ENGINE = { rooms: req('rooms'), validation: req('validation'), gameState: req('gameState'), physics: req('physics') };
})(window);
