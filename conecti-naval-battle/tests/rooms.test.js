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
/** Crea una sala con 2 jugadores listos y espera a que empiece la primera ronda. */
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

const { publicState } = require('../server/gameState');
const tiroA = (room, shooter, where) => findShot({ shooter, ships: room.state.ships, where });
const alAgua = i => i.type === 'water';

test('empiezan los dos a la vez, cada uno con 24 px de motor', async () => {
  const { m, room, events } = await partida();
  assert.ok(events.some(([e]) => e === 'matchStart'));
  assert.deepEqual(room.state.ships.map(s => s.moveLeft), [C.MOVE_BUDGET, C.MOVE_BUDGET]);
  assert.equal(room.state.round, 1);
  cleanup(m);
});

test('movimiento simultáneo: cada uno con su presupuesto, sin recuperarlo yendo y viniendo', async () => {
  const { m, room } = await partida();
  const x0 = room.state.ships[0].x, x1 = room.state.ships[1].x;
  m.engine.move(room, 0, 4); m.engine.move(room, 0, -4); m.engine.move(room, 0, 4);
  m.engine.move(room, 1, -4);
  assert.equal(room.state.ships[0].x, x0 + 4);
  assert.equal(room.state.ships[0].moveLeft, C.MOVE_BUDGET - 12, 'ir y volver también gasta');
  assert.equal(room.state.ships[1].x, x1 - 4, 'el rival se mueve al mismo tiempo');
  for (let i = 0; i < 10; i++) m.engine.move(room, 0, 4);
  assert.equal(room.state.ships[0].x, x0 + 16, '4 − 4 + 4 y luego solo 12 más hasta agotar los 24');
  assert.equal(room.state.moved[0], true, 'al agotar el motor queda confirmado');
  assert.equal(room.state.phase, 'MOVEMENT', 'sigue esperando al otro');
  assert.equal(m.engine.move(room, 0, 4), 0, 'ya no se mueve más esta ronda');
  m.engine.confirmMove(room, 1);
  assert.equal(room.state.phase, 'AIMING', 'cuando los dos confirman, pasan a apuntar');
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

test('tiempos agotados: movimiento → ataque; ataque sin disparos → siguiente ronda', async () => {
  const { m, room, events } = await partida();
  await until(() => room.state.phase === 'AIMING', 1000);
  await until(() => room.state.phase === 'MOVEMENT' && room.state.round === 2, 3000);
  const sh = events.find(([e]) => e === 'shots')[1];
  assert.deepEqual(sh.shots, []);
  assert.deepEqual(sh.missed, [0, 1], 'quien no disparó pierde el tiro');
  cleanup(m);
});

test('disparo secreto: no se revela hasta que salen los dos juntos', async () => {
  const { m, room, events } = await partida({ AIM_MS: 5000 });
  m.engine.confirmMove(room, 0); m.engine.confirmMove(room, 1);
  const t0 = tiroA(room, 0, i => i.type === 'hull' && i.target === 1 && i.zone === 'proa');
  assert.equal(m.engine.fire(room, 0, { angle: t0.angle, power: t0.power, projectile: 'tiktok' }), true);
  assert.equal(m.engine.fire(room, 0, { angle: 45, power: 50, projectile: 'tiktok' }), false, 'un solo disparo por ronda');
  const pub = publicState(room);
  assert.deepEqual(pub.locked, [true, false], 'el rival sabe que ya disparó…');
  assert.notEqual(pub.aim[0].angle, t0.angle, '…pero no hacia dónde');
  assert.equal(JSON.stringify(pub).includes('pending'), false);
  assert.equal(room.state.phase, 'AIMING', 'espera al segundo');
  assert.ok(!events.some(([e]) => e === 'shots'));
  const t1 = tiroA(room, 1, alAgua);
  m.engine.fire(room, 1, { angle: t1.angle, power: t1.power, projectile: 'instagram' });
  assert.equal(room.state.phase, 'PROJECTILE', 'salen los dos a la vez');
  const sh = events.find(([e]) => e === 'shots')[1];
  assert.equal(sh.shots.length, 2);
  assert.deepEqual(sh.shots.map(x => x.shooter), [0, 1]);
  await until(() => events.some(([e]) => e === 'resolution'));
  assert.deepEqual(room.state.ships.map(s => s.hp), [100, 80], 'proa: −20; el otro cayó al agua');
  await until(() => room.state.phase === 'MOVEMENT' && room.state.round === 2);
  cleanup(m);
});

test('impacto en el centro blindado resta 8 y la vida nunca baja de 0', async () => {
  const { m, room, events } = await partida({ AIM_MS: 5000 });
  room.state.ships[1].hp = 5;
  m.engine.confirmMove(room, 0); m.engine.confirmMove(room, 1);
  const t0 = tiroA(room, 0, i => i.type === 'hull' && i.target === 1 && i.zone === 'centro');
  const t1 = tiroA(room, 1, alAgua);
  m.engine.fire(room, 0, { angle: t0.angle, power: t0.power, projectile: 'instagram' });
  m.engine.fire(room, 1, { angle: t1.angle, power: t1.power, projectile: 'tiktok' });
  await until(() => room.state.phase === 'GAME_OVER');
  assert.equal(room.state.ships[1].hp, 0);
  assert.equal(room.state.winner, 0);
  assert.equal(room.state.reason, 'hp');
  assert.ok(events.some(([e]) => e === 'gameOver'));
  cleanup(m);
});

test('si los dos barcos se hunden en la misma ronda, es empate', async () => {
  const { m, room } = await partida({ AIM_MS: 5000 });
  room.state.ships[0].hp = 8; room.state.ships[1].hp = 8;
  m.engine.confirmMove(room, 0); m.engine.confirmMove(room, 1);
  const t0 = tiroA(room, 0, i => i.type === 'hull' && i.target === 1);
  const t1 = tiroA(room, 1, i => i.type === 'hull' && i.target === 0);
  m.engine.fire(room, 0, { angle: t0.angle, power: t0.power, projectile: 'tiktok' });
  m.engine.fire(room, 1, { angle: t1.angle, power: t1.power, projectile: 'tiktok' });
  await until(() => room.state.phase === 'GAME_OVER');
  assert.deepEqual(room.state.ships.map(s => s.hp), [0, 0]);
  assert.equal(room.state.winner, null);
  assert.equal(room.state.reason, 'empate');
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
  m.engine.confirmMove(room, 0); m.engine.confirmMove(room, 1);
  const t0 = tiroA(room, 0, i => i.type === 'hull' && i.target === 1);
  const t1 = tiroA(room, 1, alAgua);
  m.engine.fire(room, 0, { angle: t0.angle, power: t0.power, projectile: 'tiktok' });
  m.engine.fire(room, 1, { angle: t1.angle, power: t1.power, projectile: 'tiktok' });
  await until(() => room.state.phase === 'GAME_OVER', 3000);
  m.engine.requestRematch(room, 0);
  assert.equal(room.state.phase, 'GAME_OVER', 'falta que acepte el otro');
  m.engine.requestRematch(room, 1);
  assert.equal(room.state.phase, 'WAITING');
  assert.deepEqual(room.state.ships.map(s => [s.x, s.hp]), [[C.START_X[0], 100], [C.START_X[1], 100]]);
  assert.equal(room.state.match, 2);
  cleanup(m);
});
