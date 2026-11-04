'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../shared/constants');
const { hitsHull, zoneAt, hullRect } = require('../server/collisions');

test('el casco mide HULL_W y está centrado en el barco', () => {
  const h = hullRect(100);
  assert.equal(h.right - h.left, C.HULL_W);
  assert.equal((h.left + h.right) / 2, 100);
});

test('barco que mira a la derecha: proa adelante (derecha), popa atrás (izquierda)', () => {
  const x = 100, L = C.HULL_W, left = x - L / 2;
  assert.deepEqual(pick(zoneAt(x, 1, left + 2)), ['popa', 20]);
  assert.deepEqual(pick(zoneAt(x, 1, left + L * 0.24)), ['popa', 20]);
  assert.deepEqual(pick(zoneAt(x, 1, left + L * 0.25)), ['centro', 8]);
  assert.deepEqual(pick(zoneAt(x, 1, x)), ['centro', 8]);
  assert.deepEqual(pick(zoneAt(x, 1, left + L * 0.74)), ['centro', 8]);
  assert.deepEqual(pick(zoneAt(x, 1, left + L * 0.76)), ['proa', 20]);
  assert.deepEqual(pick(zoneAt(x, 1, left + L - 1)), ['proa', 20]);
});

test('barco que mira a la izquierda: las zonas se invierten (coordenadas locales)', () => {
  const x = 380, L = C.HULL_W, left = x - L / 2;
  assert.deepEqual(pick(zoneAt(x, -1, left + 2)), ['proa', 20]);
  assert.deepEqual(pick(zoneAt(x, -1, left + L - 2)), ['popa', 20]);
  assert.deepEqual(pick(zoneAt(x, -1, x)), ['centro', 8]);
});

test('las zonas se mueven con el barco (no son posiciones fijas de pantalla)', () => {
  assert.equal(zoneAt(100, 1, 130).zone, 'proa');
  assert.equal(zoneAt(180, 1, 130).zone, 'popa');
});

test('hitsHull detecta contacto en bordes y descarta puntos fuera', () => {
  const h = hullRect(200);
  assert.ok(hitsHull(200, 200, h.top));                       // cubierta
  assert.ok(hitsHull(200, h.left - 2, h.top + 4));             // a 2 px del borde, radio 3
  assert.ok(!hitsHull(200, h.left - 5, h.top + 4));            // a 5 px: no
  assert.ok(!hitsHull(200, 200, h.top - 5));                   // encima, sin tocar
  assert.ok(!hitsHull(200, h.right + 10, h.bottom));
});

function pick(z) { return [z.zone, z.damage]; }
