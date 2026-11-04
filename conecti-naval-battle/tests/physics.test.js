'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../shared/constants');
const { simulateShot, muzzle } = require('../server/physics');
const { findShot } = require('./helpers');

const ships = (a = C.START_X[0], b = C.START_X[1]) => [{ x: a }, { x: b }];
const primerAgua = s => (s.trayectorias[0].bounces[0] ? s.trayectorias[0].bounces[0].x : s.impact.x);

test('el proyectil sale de la boca real del cañón', () => {
  const s = simulateShot({ shooter: 0, ships: ships(), angle: 45, power: 60 });
  const m = muzzle(C.START_X[0], 1, 45);
  assert.deepEqual(s.path[0], [Math.round(m.x * 10) / 10, Math.round(m.y * 10) / 10]);
  assert.ok(muzzle(C.START_X[1], -1, 45).x < C.START_X[1], 'el jugador 2 dispara hacia la izquierda');
});

test('la simulación es determinista (con viento, rocas y caja)', () => {
  const o = { shooter: 1, ships: ships(), angle: 37.5, power: 71.3, projectile: 'instagram', wind: -13, rocks: [{ x: 240, w: 12, h: 20 }], crate: { x: 240, y: 90 } };
  assert.deepEqual(simulateShot(o), simulateShot(o));
});

test('la caída al agua coincide con la fórmula de la parábola, con y sin viento', () => {
  const sh = [{ x: 60 }, { x: 440 }];
  for (const wind of [0, 18, -18]) for (const [angle, power] of [[30, 40], [45, 50], [60, 45], [20, 60]]) {
    const s = simulateShot({ shooter: 0, ships: sh, angle, power, wind });
    if (!s.trayectorias[0].bounces.length) continue;
    const m = muzzle(60, 1, angle);
    const v = (power / 100) * C.V_MAX, a = (angle * Math.PI) / 180;
    const vx = v * Math.cos(a), vy = v * Math.sin(a), g = C.GRAVITY;
    // y0 − vy·t + ½·g·t² = SEA_Y   y   x = x0 + vx·t + ½·viento·t²
    const t = (vy + Math.sqrt(vy * vy + 2 * g * (C.SEA_Y - m.y))) / g;
    const esperado = m.x + vx * t + 0.5 * wind * t * t;
    assert.ok(Math.abs(primerAgua(s) - esperado) < 1.5, `viento ${wind}, ${angle}°, ${power}%: ${primerAgua(s)} vs ${esperado}`);
  }
});

test('más potencia llega más lejos (mismo ángulo)', () => {
  const sh = [{ x: 60 }, { x: 600 }];
  const xs = [30, 45, 60].map(p => primerAgua(simulateShot({ shooter: 0, ships: sh, angle: 45, power: p })));
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2], xs.join(' < '));
});

test('el viento a favor empuja el disparo más lejos y en contra lo acorta', () => {
  const sh = [{ x: 60 }, { x: 600 }];
  const x = w => primerAgua(simulateShot({ shooter: 0, ships: sh, angle: 45, power: 50, wind: w }));
  assert.ok(x(-20) < x(0) && x(0) < x(20));
});

test('el ángulo cambia la trayectoria', () => {
  const altura = s => Math.min(...s.path.map(p => p[1]));
  assert.ok(altura(simulateShot({ shooter: 0, ships: ships(), angle: 70, power: 50 })) < altura(simulateShot({ shooter: 0, ships: ships(), angle: 20, power: 50 })));
});

test('se puede impactar al rival en proa, popa y centro con el daño correcto', () => {
  for (const zone of ['proa', 'popa', 'centro']) {
    const r = findShot({ shooter: 0, ships: ships(), where: i => i.type === 'hull' && i.target === 1 && i.zone === zone });
    assert.ok(r, `hay un disparo que da en ${zone}`);
    assert.equal(r.shot.impact.damage, zone === 'centro' ? 8 : 20);
  }
});

test('TikTok rebota una sola vez en el agua y sigue volando', () => {
  const s = simulateShot({ shooter: 1, ships: ships(), angle: 45, power: 25, projectile: 'tiktok' });
  assert.equal(s.trayectorias.length, 1);
  assert.equal(s.trayectorias[0].bounces.length, 1, 'un rebote');
  assert.equal(s.impact.type, 'water', 'después del rebote cae al agua');
  assert.ok(s.impact.x < s.trayectorias[0].bounces[0].x, 'avanzó después del rebote (hacia la izquierda)');
  const r = findShot({ shooter: 0, ships: ships(), todo: true, where: x => x.trayectorias[0].bounces.length === 1 && x.impact.type === 'hull' && x.impact.target === 1 });
  assert.ok(r, 'un rebote puede terminar golpeando al rival');
});

test('Instagram se divide en 3 fragmentos que hacen la mitad del daño', () => {
  const s = simulateShot({ shooter: 0, ships: ships(), angle: 50, power: 70, projectile: 'instagram' });
  assert.equal(s.trayectorias.length, 4, 'tramo principal + 3 fragmentos');
  assert.equal(s.trayectorias[0].impact.type, 'split');
  assert.ok(s.trayectorias.slice(1).every(t => t.fragment && t.startMs === s.trayectorias[0].durMs));
  const r = findShot({ shooter: 0, ships: ships(), projectile: 'instagram', todo: true, where: x => x.trayectorias.some(t => t.fragment && t.impact.type === 'hull' && t.impact.zone !== 'centro' && t.impact.target === 1) });
  const frag = r.shot.trayectorias.find(t => t.fragment && t.impact.type === 'hull' && t.impact.zone !== 'centro');
  assert.equal(frag.impact.damage, 10, 'crítico de fragmento: 20 × 0,5');
});

test('las rocas bloquean un tiro bajo', () => {
  const rocks = [{ x: 240, w: 16, h: 30 }];
  const r = findShot({ shooter: 0, ships: ships(), rocks, where: i => i.type === 'rock' });
  assert.ok(r, 'existe un tiro que choca con la roca');
  assert.equal(r.shot.impact.damage, 0);
  const sin = simulateShot({ shooter: 0, ships: ships(), angle: r.angle, power: r.power });
  assert.notEqual(sin.impact.type, 'rock', 'sin la roca ese tiro sigue de largo');
});

test('la Caja 360 se puede acertar en el aire', () => {
  const crate = { x: 240, y: 95 };
  const r = findShot({ shooter: 0, ships: ships(), crate, todo: true, where: x => x.crateHit });
  assert.ok(r, 'hay un disparo que toca la caja');
  assert.equal(r.shot.impact.type, 'crate');
});

test('un tiro casi vertical y débil puede golpear el propio barco', () => {
  const s = simulateShot({ shooter: 0, ships: ships(100, 388), angle: 80, power: 20 });
  assert.equal(s.impact.type, 'hull'); assert.equal(s.impact.target, 0); assert.equal(s.impact.self, true);
});

test('el proyectil termina al salir del escenario', () => {
  const s = simulateShot({ shooter: 0, ships: [{ x: 200 }, { x: 600 }], angle: 40, power: 100 });
  assert.equal(s.impact.type, 'out');
});
