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
    ZONES: [[40, 190], [290, 440]], // límites del CENTRO de cada barco (dejan el centro del mar libre para las rocas)
    FACING: [1, -1],         // jugador 0 mira a la derecha, jugador 1 a la izquierda
    MAX_HP: 100,

    // Cañón (pivote relativo al centro del barco, en el sentido en que mira)
    CANNON_PIVOT_DX: 10,
    CANNON_PIVOT_Y: 186,
    CANNON_LEN: 14,

    // Movimiento (se planea en secreto y se revela junto con el disparo)
    MOVE_BUDGET: 24,         // desplazamiento máximo por ronda, en píxeles lógicos
    MOVE_STEP_MAX: 4,        // (compatibilidad) paso máximo de un movimiento suelto

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

    // Viento: aceleración horizontal (px/s²) que cambia cada ronda y desvía todos los disparos
    WIND_MAX: 26,

    // Rocas en el centro del mar (bloquean los tiros bajos). Se sortean al empezar cada partida.
    ROCKS_X: [222, 258],     // rango donde puede estar el centro de una roca
    ROCK_W: [10, 16],
    ROCK_H: [14, 30],

    // Caja 360: cuelga de un globo cada 3 rondas; quien le acierta gana un poder
    CRATE_EVERY: 3,
    CRATE_X: [200, 280],
    CRATE_Y: [70, 120],
    CRATE_SIZE: 12,
    POWERS: ['escudo', 'doble', 'reparar'],
    REPAIR_HP: 15,

    // Efectos de los proyectiles (ya no son iguales)
    TIKTOK_BOUNCE: { vy: 0.55, vx: 0.85 },   // rebota una vez en el agua
    INSTAGRAM_SPLIT: [0.72, 1, 1.28],        // se divide en 3 en el punto más alto
    FRAGMENT_FACTOR: 0.5,                    // cada fragmento hace la mitad del daño de la zona

    // Tiempos (ms) — el servidor los puede sobrescribir con variables de entorno
    PLAN_MS: 20000,          // moverse y apuntar, en secreto y al mismo tiempo
    REVEAL_MOVE_MS: 700,     // los barcos se deslizan a su nueva posición antes de que salgan las bombas
    MOVE_MS: 15000,          // (compatibilidad)
    AIM_MS: 20000,           // (compatibilidad)
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

    PHASES: ['LOBBY', 'WAITING', 'PLANNING', 'REVEAL', 'RESOLUTION', 'NEXT_TURN', 'GAME_OVER', 'PAUSED'],

    // Ranking semanal
    POINTS: { win: 3, draw: 1, loss: 0 },
    NEGOCIO_MAX: 24, PREMIO_MAX: 40,
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

/** ¿El círculo (px, py, r) toca un rectángulo {left, right, top, bottom}? (rocas y Caja 360) */
function hitsRect(rect, px, py, r = C.PROJECTILE_R) {
  const cx = Math.max(rect.left, Math.min(px, rect.right));
  const cy = Math.max(rect.top, Math.min(py, rect.bottom));
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

module.exports = { hullRect, hitsHull, zoneAt, hitsRect };

  };

  defs["physics"] = function (module, exports, require, Buffer) {
'use strict';
/*
 * Física determinista del disparo (paso fijo de 1/60 s, 3 sub-pasos de colisión).
 *
 *   x(t) = x0 + vx·t + ½·viento·t²       y(t) = y0 + vy·t + ½·g·t²     (y crece hacia abajo, vy < 0 sube)
 *   vx = v·cos(θ)·facing                 vy = −v·sin(θ)
 *
 * Efectos de cada proyectil:
 *   TikTok    → rebota UNA vez en el agua (pierde fuerza) y sigue volando.
 *   Instagram → en el punto más alto se divide en 3 fragmentos; cada uno hace la mitad del daño.
 * Obstáculos: rocas en el centro del mar (bloquean) y la Caja 360 en el aire (da un poder).
 */
const C = require('../shared/constants');
const { hitsHull, zoneAt, hitsRect } = require('./collisions');

const toRad = d => (d * Math.PI) / 180;
const r1 = n => Math.round(n * 10) / 10;
const DT = 1 / C.PHYS_HZ, SUB = 3;

/** Boca del cañón en el mundo, según la posición del barco, su orientación y el ángulo. */
function muzzle(shipX, facing, angleDeg) {
  const px = shipX + facing * C.CANNON_PIVOT_DX, py = C.CANNON_PIVOT_Y;
  const a = toRad(angleDeg);
  return { x: px + facing * Math.cos(a) * C.CANNON_LEN, y: py - Math.sin(a) * C.CANNON_LEN };
}

/** Rectángulos de las rocas (en el mundo). */
const rockRect = rk => ({ left: rk.x - rk.w / 2, right: rk.x + rk.w / 2, top: C.SEA_Y - rk.h, bottom: C.SEA_Y + 4 });
const crateRect = cr => ({ left: cr.x - C.CRATE_SIZE / 2, right: cr.x + C.CRATE_SIZE / 2, top: cr.y - C.CRATE_SIZE / 2, bottom: cr.y + C.CRATE_SIZE / 2 });

/**
 * Simula un tramo de vuelo con fórmula cerrada hasta que choca con algo (o llega a su punto más alto).
 * Devuelve los puntos del recorrido y cómo terminó.
 */
function tramo({ x0, y0, vx, vy, shooter, ships, wind, rocks, crate, grace, alCima }) {
  const g = C.GRAVITY;
  const path = [[r1(x0), r1(y0)]];
  const maxSteps = Math.ceil(C.MAX_FLIGHT_S * C.PHYS_HZ);
  let prev = { x: x0, y: y0 };
  for (let step = 1; step <= maxSteps; step++) {
    for (let s = 1; s <= SUB; s++) {
      const t = (step - 1 + s / SUB) * DT;
      const x = x0 + vx * t + 0.5 * wind * t * t;
      const y = y0 + vy * t + 0.5 * g * t * t;
      const vxT = vx + wind * t, vyT = vy + g * t;
      const fin = (type, extra = {}) => {
        path.push([r1(x), r1(y)]);
        return { path, steps: step, end: { type, x: r1(x), y: r1(y), vx: vxT, vy: vyT, ...extra } };
      };
      if (alCima && vy < 0 && vyT >= 0) return fin('apex');
      for (const target of [1 - shooter, shooter]) {
        if (target === shooter && step <= grace) continue;
        if (hitsHull(ships[target].x, x, y)) {
          const z = zoneAt(ships[target].x, C.FACING[target], x);
          return fin('hull', { target, zone: z.zone, base: z.damage, self: target === shooter });
        }
      }
      for (const rk of rocks) if (hitsRect(rockRect(rk), x, y)) return fin('rock');
      if (crate && hitsRect(crateRect(crate), x, y)) return fin('crate');
      if (y >= C.SEA_Y) {
        const k = (C.SEA_Y - prev.y) / (y - prev.y || 1);
        const xa = prev.x + (x - prev.x) * k;
        path.push([r1(xa), C.SEA_Y]);
        return { path, steps: step, end: { type: 'water', x: r1(xa), y: C.SEA_Y, vx: vxT, vy: vyT } };
      }
      if (x < -40 || x > C.WIDTH + 40) return fin('out');
      prev = { x, y };
    }
    if (step % C.PATH_EVERY === 0) path.push([r1(prev.x), r1(prev.y)]);
  }
  return { path, steps: maxSteps, end: { type: 'out', x: r1(prev.x), y: r1(prev.y), vx, vy } };
}

const msDe = steps => Math.round((steps * 1000) / C.PHYS_HZ);

/** Convierte el final de un tramo en un impacto con daño (sin aplicar poderes). */
function impacto(end, factor = 1) {
  if (end.type === 'hull') {
    return { type: 'hull', x: end.x, y: end.y, target: end.target, zone: end.zone, self: end.self, damage: Math.round(end.base * factor) };
  }
  return { type: end.type, x: end.x, y: end.y, damage: 0 };
}

/**
 * Simula un disparo completo.
 * @returns {{ trayectorias: Array<{path, startMs, durMs, impact, bounces?, fragment?}>, flightMs: number, start: object,
 *            path: number[][], impact: object }}   (path/impact = trayectoria principal, por compatibilidad)
 */
function simulateShot({ shooter, ships, angle, power, projectile = 'tiktok', wind = 0, rocks = [], crate = null }) {
  const facing = C.FACING[shooter];
  const start = muzzle(ships[shooter].x, facing, angle);
  const v = (power / 100) * C.V_MAX, a = toRad(angle);
  const base = { shooter, ships, wind, rocks, crate };
  const trayectorias = [];
  let caja = false;

  let seg = tramo({ ...base, x0: start.x, y0: start.y, vx: v * Math.cos(a) * facing, vy: -v * Math.sin(a), grace: C.SELF_HIT_GRACE, alCima: projectile === 'instagram' });
  const principal = { path: seg.path, startMs: 0, durMs: msDe(seg.steps), bounces: [] };

  if (projectile === 'tiktok' && seg.end.type === 'water') {
    // Rebote: sale hacia arriba con menos fuerza y sigue el mismo vuelo
    principal.bounces.push({ x: seg.end.x });
    const b = tramo({ ...base, x0: seg.end.x, y0: C.SEA_Y - 1, vx: seg.end.vx * C.TIKTOK_BOUNCE.vx, vy: -Math.abs(seg.end.vy) * C.TIKTOK_BOUNCE.vy, grace: 0, alCima: false });
    principal.path = principal.path.concat(b.path.slice(1));
    principal.durMs += msDe(b.steps);
    seg = b;
  }

  if (projectile === 'instagram' && seg.end.type === 'apex') {
    // Se divide en 3 fragmentos en el punto más alto
    principal.impact = { type: 'split', x: seg.end.x, y: seg.end.y, damage: 0 };
    trayectorias.push(principal);
    for (const k of C.INSTAGRAM_SPLIT) {
      const f = tramo({ ...base, x0: seg.end.x, y0: seg.end.y, vx: seg.end.vx * k, vy: 0, grace: 0, alCima: false });
      const imp = impacto(f.end, C.FRAGMENT_FACTOR);
      if (imp.type === 'crate') caja = true;
      trayectorias.push({ path: f.path, startMs: principal.durMs, durMs: msDe(f.steps), impact: imp, fragment: true });
    }
  } else {
    principal.impact = impacto(seg.end);
    if (principal.impact.type === 'crate') caja = true;
    trayectorias.push(principal);
  }

  const flightMs = Math.max(300, ...trayectorias.map(t => t.startMs + t.durMs));
  return { start, trayectorias, flightMs, crateHit: caja, path: principal.path, impact: trayectorias[trayectorias.length - 1].impact };
}

module.exports = { simulateShot, muzzle, rockRect, crateRect };

  };

  defs["gameState"] = function (module, exports, require, Buffer) {
'use strict';
/* Estado autoritativo de una partida y su versión pública (lo que ven los clientes). */
const C = require('../shared/constants');

function newMatchState() {
  return {
    phase: 'LOBBY',          // LOBBY → WAITING → PLANNING → REVEAL → RESOLUTION → NEXT_TURN … → GAME_OVER
    round: 0,
    phaseEndsAt: 0,
    pausedPhase: null,
    pausedRemaining: 0,
    ships: [0, 1].map(i => ({ x: C.START_X[i], hp: C.MAX_HP })),
    locked: [false, false],  // ya tocó DISPARAR en esta ronda (lo único que sabe el rival)
    pending: [null, null],   // PRIVADO: planes secretos { dx, angle, power, projectile }
    shownAim: [0, 1].map(() => ({ angle: 45, power: 60, projectile: 'tiktok' })),   // PÚBLICO: último disparo ya lanzado
    wind: 0,
    rocks: [],
    crate: null,
    powers: [0, 1].map(() => ({ escudo: false, doble: false })),
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

/** Snapshot público: sin tokens, sin ids de socket y sin los planes secretos. */
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
    ships: s.ships.map(sh => ({ x: sh.x, hp: sh.hp })),
    locked: [...s.locked],
    aim: s.shownAim.map(a => ({ ...a })),
    wind: s.wind,
    rocks: s.rocks.map(r => ({ ...r })),
    crate: s.crate ? { ...s.crate } : null,
    powers: s.powers.map(p => ({ ...p })),
    winner: s.winner,
    reason: s.reason,
    meta: room.meta || {},
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

  };

  defs["validation"] = function (module, exports, require, Buffer) {
'use strict';
/* Validación y saneamiento de todo lo que llega por Socket.io. Nunca se confía en el cliente. */
const C = require('../shared/constants');

const CODE_RE = /^\d{4}$/;
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
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).replace(/\D/g, '');
  return s.length === 4 ? s : null;
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

/** Plan secreto de la ronda: desplazamiento total (entero, ±MOVE_BUDGET) + mira. */
function plan(p) {
  const a = aim(p);
  if (!a || !isNum(p.dx) || !Number.isInteger(p.dx) || Math.abs(p.dx) > C.MOVE_BUDGET) return null;
  return { dx: p.dx, ...a };
}

/** Texto libre corto (nombre de negocio, premio): sin etiquetas ni saltos de línea. */
function textoCorto(v, max) {
  if (typeof v !== 'string') return '';
  return v.normalize('NFC').replace(/[<>{}\[\]\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

const TORNEO_RE = /^T[A-HJ-NP-Z2-9]{4}$/;
/** Datos opcionales de la sala: versión para negocios y vínculo con un torneo. */
function meta(p) {
  const m = {};
  if (p && typeof p === 'object') {
    const nombre = textoCorto(p.negocio, C.NEGOCIO_MAX), premio = textoCorto(p.premio, C.PREMIO_MAX);
    if (nombre) m.negocio = nombre;
    if (premio) m.premio = premio;
    if (p.torneo && typeof p.torneo === 'object' && TORNEO_RE.test(p.torneo.id) && Number.isInteger(p.torneo.r) && Number.isInteger(p.torneo.m)
        && p.torneo.r >= 0 && p.torneo.r < 3 && p.torneo.m >= 0 && p.torneo.m < 4) m.torneo = { id: p.torneo.id, r: p.torneo.r, m: p.torneo.m };
  }
  return m;
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

module.exports = { sanitizeName, profile, roomCode, token, moveStep, aim, plan, meta, textoCorto, createRateLimiter, CODE_RE, TORNEO_RE };

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

/** Código de sala: 4 números (fácil de dictar y escribir en el celular). */
function genCode() {
  return String(crypto.randomInt(10000)).padStart(4, '0');
}
/** Código de torneo: T + 4 letras/números. */
function genTorneo() {
  let s = 'T';
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

  function createRoom(profile, socketId, meta = {}) {
    if (bySocket.has(socketId)) return { error: 'Ya estás en una sala.' };
    let code;
    do { code = genCode(); } while (rooms.has(code));
    const room = { code, createdAt: Date.now(), meta, players: [newPlayer(profile, socketId), null], state: newMatchState(), phaseTimer: null, emptyTimer: null };
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

  /**
   * Recupera una sala guardada (versión sin servidor: el anfitrión recargó la página).
   * snap = { code, meta, state, players:[{name, conecti, ship, token, connected, socketId}] }
   */
  function restoreRoom(snap) {
    if (rooms.has(snap.code)) deleteRoom(snap.code);
    const room = { code: snap.code, createdAt: Date.now(), meta: snap.meta || {}, players: [null, null], state: { ...newMatchState(), ...snap.state }, phaseTimer: null, emptyTimer: null };
    snap.players.forEach((p, i) => {
      if (!p) return;
      room.players[i] = { name: p.name, conecti: p.conecti, ship: p.ship, token: p.token, socketId: p.socketId, connected: !!p.connected, ready: false, rematch: false, left: !!p.left, reconnectEndsAt: 0, timer: null };
      if (p.connected) bySocket.set(p.socketId, { code: snap.code, slot: i });
    });
    rooms.set(room.code, room);
    room.players.forEach((p, i) => { if (p && !p.connected && !p.left) { p.reconnectEndsAt = Date.now() + T.RECONNECT_MS; p.timer = setTimeout(() => expire(room, i), T.RECONNECT_MS); } });
    engine.restore(room);
    return room;
  }

  return { createRoom, joinRoom, resumeRoom, restoreRoom, setReady, disconnect, leave, sweep, deleteRoom, context, engine, rooms, bySocket };
}

module.exports = { createRoomManager, genCode, genTorneo };

  };

  root.CNB_ENGINE = { rooms: req('rooms'), validation: req('validation'), gameState: req('gameState'), physics: req('physics') };
})(window);
