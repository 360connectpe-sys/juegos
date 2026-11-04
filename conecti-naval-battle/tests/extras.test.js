'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../shared/extras');

test('ranking: 3 por victoria, 1 por empate, ordenado', () => {
  const t = {};
  X.sumarResultado(t, ['Ana', 'Beto'], 0);
  X.sumarResultado(t, ['Ana', 'Caro'], null);
  X.sumarResultado(t, ['beto', 'Caro'], 0);
  const top = X.top(t);
  assert.deepEqual(top.map(f => [f.name, f.pts]), [['Ana', 4], ['beto', 3], ['Caro', 1]]);
  assert.equal(top[0].v, 1); assert.equal(top[0].e, 1);
  assert.match(X.semana(new Date(2026, 10, 4)), /^26\d\d$/);
  assert.equal(X.claveNombre('Café.Aroma#1'), 'cafe_aroma_1');
});

test('torneo de 4: llaves, avance del ganador y campeón', () => {
  const t = X.crearTorneo({ nombre: 'Copa', jugadores: ['A', 'B', 'C', 'D'] }, () => 0.99);
  assert.equal(t.rondas.length, 2);
  assert.equal(t.rondas[0].length, 2);
  const [p0, p1] = t.rondas[0];
  assert.equal(X.ponerGanador(t, 0, 0, 'Z'), false, 'solo uno de los dos del partido');
  assert.ok(X.ponerGanador(t, 0, 0, p0.a));
  assert.equal(t.rondas[1][0].a, p0.a);
  assert.equal(X.ponerGanador(t, 0, 0, p0.b), false, 'no se cambia un resultado ya puesto');
  assert.ok(X.ponerGanador(t, 0, 1, p1.b));
  assert.ok(X.ponerGanador(t, 1, 0, p1.b));
  assert.equal(t.campeon, p1.b);
});

test('torneo de 8 y ganador desde el resultado de una sala', () => {
  const t = X.crearTorneo({ nombre: 'Copa', jugadores: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] });
  assert.equal(t.rondas.length, 3);
  const p = t.rondas[0][2];
  assert.equal(X.ganadorDeSala(t, 0, 2, [p.b.toLowerCase(), p.a], 0), p.b, 'reconoce el nombre aunque cambien mayúsculas');
  assert.equal(X.ganadorDeSala(t, 0, 2, ['Otro', p.a], 0), null);
});
