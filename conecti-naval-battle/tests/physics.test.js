'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../shared/constants');
const { simulateShot, muzzle } = require('../server/physics');
const { findShot } = require('./helpers');

const ships = (a = C.START_X[0], b = C.START_X[1]) => [{ x: a }, { x: b }];

test('el proyectil sale de la boca real del cañón', () => {
  const s = simulateShot({ shooter: 0, ships: ships(), angle: 45, power: 60 });
  const m = muzzle(C.START_X[0], 1, 45);
  assert.deepEqual(s.path[0], [Math.round(m.x * 10) / 10, Math.round(m.y * 10) / 10]);
  const m1 = muzzle(C.START_X[1], -1, 45);
  assert.ok(m1.x < C.START_X[1], 'el jugador 2 dispara hacia la izquierda');
});

test('la simulación es determinista', () => {
  const a = simulateShot({ shooter: 1, ships: ships(), angle: 37.5, power: 71.3 });
  const b = simulateShot({ shooter: 1, ships: ships(), angle: 37.5, power: 71.3 });
  assert.deepEqual(a, b);
});

test('la caída al agua coincide con la fórmula de la parábola', () => {
  // Barcos lejos de la trayectoria para que caiga al agua
  const sh = [{ x: 60 }, { x: 440 }];
  for (const [angle, power] of [[30, 40], [45, 50], [60, 45], [20, 60]]) {
    const s = simulateShot({ shooter: 0, ships: sh, angle, power });
    if (s.impact.type !== 'water') continue;
    const m = muzzle(60, 1, angle);
    const v = (power / 100) * C.V_MAX, a = (angle * Math.PI) / 180;
    const vx = v * Math.cos(a), vy = v * Math.sin(a), g = C.GRAVITY;
    // y0 − vy·t + ½·g·t² = SEA_Y  →  t = (vy + √(vy² + 2g(SEA_Y − y0))) / g
    const t = (vy + Math.sqrt(vy * vy + 2 * g * (C.SEA_Y - m.y))) / g;
    const xEsperado = m.x + vx * t;
    assert.ok(Math.abs(s.impact.x - xEsperado) < 1.5, `ángulo ${angle} potencia ${power}: ${s.impact.x} vs ${xEsperado}`);
  }
});

test('más potencia llega más lejos (mismo ángulo)', () => {
  const sh = [{ x: 60 }, { x: 600 }];   // rival fuera del mapa para medir solo el alcance
  const xs = [30, 45, 60].map(p => simulateShot({ shooter: 0, ships: sh, angle: 45, power: p }).impact.x);
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2], xs.join(' < '));
});

test('el ángulo cambia la trayectoria', () => {
  const a = simulateShot({ shooter: 0, ships: ships(), angle: 20, power: 50 });
  const b = simulateShot({ shooter: 0, ships: ships(), angle: 70, power: 50 });
  const altura = s => Math.min(...s.path.map(p => p[1]));
  assert.ok(altura(b) < altura(a), 'a 70° sube más alto que a 20°');
});

test('se puede impactar al rival en proa, popa y centro con el daño correcto', () => {
  for (const zone of ['proa', 'popa', 'centro']) {
    const r = findShot({ shooter: 0, ships: ships(), where: i => i.type === 'hull' && i.target === 1 && i.zone === zone });
    assert.ok(r, `hay un disparo que da en ${zone}`);
    assert.equal(r.shot.impact.damage, zone === 'centro' ? 8 : 20);
  }
});

test('un tiro casi vertical y débil puede golpear el propio barco', () => {
  const s = simulateShot({ shooter: 0, ships: ships(100, 388), angle: 80, power: 20 });
  assert.equal(s.impact.type, 'hull');
  assert.equal(s.impact.target, 0);
  assert.equal(s.impact.self, true);
  assert.ok(s.impact.damage === 20 || s.impact.damage === 8);
});

test('un disparo puede fallar y caer al mar sin daño', () => {
  const s = simulateShot({ shooter: 1, ships: ships(), angle: 45, power: 25 });
  assert.equal(s.impact.type, 'water');
  assert.equal(s.impact.damage, 0);
  assert.equal(s.impact.y, C.SEA_Y);
});

test('el proyectil termina al salir del escenario', () => {
  const s = simulateShot({ shooter: 0, ships: [{ x: 200 }, { x: 600 }], angle: 40, power: 100 });
  assert.equal(s.impact.type, 'out');
  assert.ok(s.impact.x > C.WIDTH);
});

test('la duración del vuelo es proporcional a los pasos simulados', () => {
  const s = simulateShot({ shooter: 0, ships: ships(), angle: 50, power: 70 });
  assert.ok(s.flightMs > 300 && s.flightMs < C.MAX_FLIGHT_S * 1000);
  assert.ok(s.path.length > 5);
});
