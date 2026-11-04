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
