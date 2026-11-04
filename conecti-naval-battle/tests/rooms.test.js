'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../shared/constants');
const V = require('../server/validation');
const { createRoomManager } = require('../server/rooms');
const { findShot, wait, until } = require('./helpers');

const P = (name = 'Ana', conecti = 'azul', ship = 'verde') => ({ name, conecti, ship });
const FAST = { MOVE_MS: 300, AIM_MS: 300, RESOLUTION_MS: 40, START_DELAY_MS: 30, RECONNECT_MS: 150, EMPTY_ROOM_MS: 100 };

function manager(extra = {}) {
  const events = [];
  const m = createRoomManager({ timings: { ...FAST, ...extra }, random: () => 0.1, emit: (room, ev, p) => events.push([ev, p]), sync: () => {} });
  return { m, events };
}
/** Crea una sala con 2 jugadores listos y espera a que empiece el turno del jugador 0. */
async function partida(extra) {
  const { m, events } = manager(extra);
  const a = m.createRoom(P('Ana'), 'A');
  const b = m.joinRoom(a.room.code, P('Beto', 'morado', 'azul'), 'B');
  m.setReady('A', true); m.setReady('B', true);
  await until(() => a.room.state.phase === 'MOVEMENT');
  return { m, events, room: a.room, a, b };
}
const cleanup = m => { for (const code of [...m.rooms.keys()]) m.deleteRoom(code); };

test('crear sala: código CNX-XXXX no predecible y token secreto', () => {
  const { m } = manager();
  const r = m.createRoom(P(), 's1');
  assert.match(r.room.code, V.CODE_RE);
  assert.ok(r.token.length >= 30);
  const codigos = new Set(Array.from({ length: 50 }, (_, i) => m.createRoom(P(), 'x' + i).room.code));
  assert.equal(codigos.size, 50, 'no se repiten');
  cleanup(m);
});

test('exactamente 2 jugadores: el tercero no entra', () => {
  const { m } = manager();
  const r = m.createRoom(P(), 'A');
  assert.ok(m.joinRoom(r.room.code, P('B'), 'B').room);
  const tercero = m.joinRoom(r.room.code, P('C'), 'C');
  assert.match(tercero.error, /llena/);
  cleanup(m);
});

test('una misma conexión no puede ocupar los dos lugares', () => {
  const { m } = manager();
  const r = m.createRoom(P(), 'A');
  assert.match(m.joinRoom(r.room.code, P(), 'A').error, /Ya estás/);
  cleanup(m);
});

test('sala inexistente y validación de entradas', () => {
  const { m } = manager();
  assert.match(m.joinRoom('CNX-ZZZZ', P(), 'A').error, /no existe/);
  assert.equal(V.roomCode('k7p2'), 'CNX-K7P2');
  assert.equal(V.roomCode('cnx-k7p2'), 'CNX-K7P2');
  assert.equal(V.roomCode('CNX-K7P'), null);
  assert.equal(V.roomCode({}), null);
  assert.equal(V.sanitizeName('<script>Ana</script>'), 'scriptAnascrip', 'se corta en 14 caracteres');
  assert.equal(V.sanitizeName('   '), 'Capitán');
  assert.equal(V.sanitizeName('x'.repeat(40)).length, C.NAME_MAX);
  assert.equal(V.profile({ name: 'a', conecti: 'rojo', ship: 'azul' }), null);
  assert.equal(V.moveStep({ dx: 99 }), null);
  assert.equal(V.moveStep({ dx: 1.5 }), null);
  assert.equal(V.aim({ angle: 90, power: 50, projectile: 'tiktok' }), null);
  assert.equal(V.aim({ angle: 45, power: 50, projectile: 'whatsapp' }), null);
  assert.deepEqual(V.aim({ angle: 45, power: 50, projectile: 'instagram' }), { angle: 45, power: 50, projectile: 'instagram' });
  cleanup(m);
});

test('límite de frecuencia por conexión', () => {
  const allow = V.createRateLimiter({ capacity: 3, refillPerSec: 1, minIntervals: { move: 1000 } });
  assert.equal(allow('move'), true);
  assert.equal(allow('move'), false, 'intervalo mínimo por tipo');
  assert.equal(allow('aim'), true);
  assert.equal(allow('aim'), true);
  assert.equal(allow('aim'), false, 'se acabaron las fichas');
});

test('reconexión solo con el token correcto', () => {
  const { m } = manager();
  const r = m.createRoom(P(), 'A');
  m.disconnect('A');
  assert.match(m.resumeRoom(r.room.code, 'token-falso-token-falso-123', 'X').error, /No se pudo/);
  const ok = m.resumeRoom(r.room.code, r.token, 'A2');
  assert.equal(ok.slot, 0);
  assert.equal(r.room.players[0].connected, true);
  cleanup(m);
});

test('empieza al estar los dos listos y sortea el primer turno', async () => {
  const { m, room, events } = await partida();
  assert.equal(room.state.turn, 0);             // random() = 0.1 → empieza el jugador 0
  assert.ok(events.some(([e]) => e === 'matchStart'));
  assert.equal(room.state.ships[0].moveLeft, C.MOVE_BUDGET);
  cleanup(m);
});

test('movimiento: solo el jugador activo, máximo 24 px y sin recuperar presupuesto', async () => {
  const { m, room } = await partida();
  assert.equal(m.engine.move(room, 1, 4), 0, 'el rival no se mueve fuera de su turno');
  const x0 = room.state.ships[0].x;
  m.engine.move(room, 0, 4); m.engine.move(room, 0, -4); m.engine.move(room, 0, 4);
  assert.equal(room.state.ships[0].x, x0 + 4);
  assert.equal(room.state.ships[0].moveLeft, C.MOVE_BUDGET - 12, 'ir y volver también gasta');
  for (let i = 0; i < 10; i++) m.engine.move(room, 0, 4);
  assert.equal(room.state.ships[0].moveLeft, 0);
  assert.equal(room.state.ships[0].x, x0 + 16, '4 − 4 + 4 y luego solo 12 más hasta agotar los 24');
  assert.ok(Math.abs(room.state.ships[0].x - x0) <= C.MOVE_BUDGET);
  assert.equal(room.state.phase, 'AIMING', 'al agotar el presupuesto pasa a apuntar');
  cleanup(m);
});

test('movimiento: no sale de su zona', async () => {
  const { m, room } = await partida();
  room.state.ships[0].x = C.ZONES[0][0] + 2;
  m.engine.move(room, 0, -4);
  assert.equal(room.state.ships[0].x, C.ZONES[0][0]);
  assert.equal(room.state.ships[0].moveLeft, C.MOVE_BUDGET - 2, 'solo gasta lo que realmente recorrió');
  cleanup(m);
});

test('tiempo de movimiento agotado → pasa a apuntar; tiempo de apuntar agotado → turno del rival', async () => {
  const { m, room, events } = await partida();
  await until(() => room.state.phase === 'AIMING', 1000);
  await until(() => room.state.phase === 'MOVEMENT' && room.state.turn === 1, 2000);
  assert.ok(events.some(([e, p]) => e === 'timeout' && p.shooter === 0));
  cleanup(m);
});

test('disparo: solo en AIMING, una vez por turno, el daño lo calcula el servidor', async () => {
  const { m, room, events } = await partida({ AIM_MS: 5000 });
  const tiro = findShot({ shooter: 0, ships: room.state.ships, where: i => i.type === 'hull' && i.target === 1 && i.zone === 'proa' });
  assert.equal(m.engine.fire(room, 0, { angle: tiro.angle, power: tiro.power, projectile: 'tiktok' }), false, 'no dispara durante MOVEMENT');
  m.engine.confirmMove(room, 0);
  assert.equal(room.state.phase, 'AIMING');
  assert.equal(m.engine.fire(room, 1, { angle: 45, power: 50, projectile: 'tiktok' }), false, 'el rival no dispara');
  assert.equal(m.engine.fire(room, 0, { angle: tiro.angle, power: tiro.power, projectile: 'tiktok' }), true);
  assert.equal(m.engine.fire(room, 0, { angle: tiro.angle, power: tiro.power, projectile: 'tiktok' }), false, 'sin disparos duplicados');
  await until(() => events.some(([e]) => e === 'resolution'));
  assert.equal(room.state.ships[1].hp, 80, 'proa: −20');
  await until(() => room.state.turn === 1 && room.state.phase === 'MOVEMENT');
  cleanup(m);
});

test('impacto en el centro blindado resta 8 y la vida nunca baja de 0', async () => {
  const { m, room, events } = await partida({ AIM_MS: 5000 });
  room.state.ships[1].hp = 5;
  const tiro = findShot({ shooter: 0, ships: room.state.ships, where: i => i.type === 'hull' && i.target === 1 && i.zone === 'centro' });
  m.engine.confirmMove(room, 0);
  m.engine.fire(room, 0, { angle: tiro.angle, power: tiro.power, projectile: 'instagram' });
  await until(() => room.state.phase === 'GAME_OVER');
  assert.equal(room.state.ships[1].hp, 0);
  assert.equal(room.state.winner, 0);
  assert.equal(room.state.reason, 'hp');
  assert.ok(events.some(([e]) => e === 'gameOver'));
  cleanup(m);
});

test('desconexión: pausa, reconexión reanuda; sin volver, gana el otro por abandono', async () => {
  const { m, room, a } = await partida({ MOVE_MS: 2000 });
  m.disconnect('A');
  assert.equal(room.state.phase, 'PAUSED');
  assert.equal(room.state.pausedPhase, 'MOVEMENT');
  m.resumeRoom(room.code, a.token, 'A2');
  assert.equal(room.state.phase, 'MOVEMENT');
  m.disconnect('A2');
  await wait(FAST.RECONNECT_MS + 60);
  assert.equal(room.state.phase, 'GAME_OVER');
  assert.equal(room.state.winner, 1);
  assert.equal(room.state.reason, 'abandono');
  assert.ok(room.players[0].left);
  assert.match(m.resumeRoom(room.code, a.token, 'A3').error, /No se pudo/, 'pasado el plazo ya no recupera el lugar');
  cleanup(m);
});

test('si se van los dos, la sala se borra después del período de gracia', async () => {
  const { m, room } = await partida();
  m.disconnect('A'); m.disconnect('B');
  await wait(FAST.RECONNECT_MS + FAST.EMPTY_ROOM_MS + 80);
  assert.equal(m.rooms.has(room.code), false);
});

test('revancha: empieza solo cuando los dos aceptan y reinicia vida y posiciones', async () => {
  const { m, room } = await partida({ AIM_MS: 5000 });
  room.state.ships[1].hp = 8; room.state.ships[0].x += 10;
  const tiro = findShot({ shooter: 0, ships: room.state.ships, where: i => i.type === 'hull' && i.target === 1 });
  m.engine.confirmMove(room, 0);
  m.engine.fire(room, 0, { angle: tiro.angle, power: tiro.power, projectile: 'tiktok' });
  await until(() => room.state.phase === 'GAME_OVER');
  m.engine.requestRematch(room, 0);
  assert.equal(room.state.phase, 'GAME_OVER', 'falta que acepte el otro');
  m.engine.requestRematch(room, 1);
  assert.equal(room.state.phase, 'WAITING');
  assert.deepEqual(room.state.ships.map(s => [s.x, s.hp]), [[C.START_X[0], 100], [C.START_X[1], 100]]);
  assert.equal(room.state.match, 2);
  cleanup(m);
});
