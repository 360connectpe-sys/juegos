'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../shared/constants');
const V = require('../server/validation');
const { createRoomManager } = require('../server/rooms');
const { publicState } = require('../server/gameState');
const { findShot, wait, until } = require('./helpers');

const P = (name = 'Ana', conecti = 'azul', ship = 'verde') => ({ name, conecti, ship });
const FAST = { PLAN_MS: 300, REVEAL_MOVE_MS: 20, RESOLUTION_MS: 40, START_DELAY_MS: 30, RECONNECT_MS: 150, EMPTY_ROOM_MS: 100 };

function manager(extra = {}) {
  const events = [];
  const m = createRoomManager({ timings: { ...FAST, ...extra }, random: () => 0.1, emit: (room, ev, p) => events.push([ev, p]), sync: () => {} });
  return { m, events };
}
/** Sala con 2 jugadores listos, ya en la primera fase de plan. */
async function partida(extra) {
  const { m, events } = manager(extra);
  const a = m.createRoom(P('Ana'), 'A', { negocio: 'Café Aroma', premio: '10% de descuento' });
  const b = m.joinRoom(a.room.code, P('Beto', 'morado', 'azul'), 'B');
  m.setReady('A', true); m.setReady('B', true);
  await until(() => a.room.state.phase === 'PLANNING');
  return { m, events, room: a.room, a, b };
}
const cleanup = m => { for (const code of [...m.rooms.keys()]) m.deleteRoom(code); };
/** Busca un tiro con las condiciones reales de la ronda (viento, rocas, caja). */
const tiro = (room, shooter, where, extra = {}) => findShot({ shooter, ships: room.state.ships, wind: room.state.wind, rocks: room.state.rocks, crate: room.state.crate, where, ...extra });
const plan = (t, dx = 0, projectile = 'tiktok') => ({ dx, angle: t.angle, power: t.power, projectile });
const alAgua = i => i.type === 'water';

test('crear sala: código de 4 números, token secreto y datos de negocio', () => {
  const { m } = manager();
  const r = m.createRoom(P(), 's1', { negocio: 'Café Aroma', premio: '10%' });
  assert.match(r.room.code, V.CODE_RE);
  assert.ok(r.token.length >= 30);
  assert.deepEqual(publicState(r.room).meta, { negocio: 'Café Aroma', premio: '10%' });
  const codigos = new Set(Array.from({ length: 50 }, (_, i) => m.createRoom(P(), 'x' + i).room.code));
  assert.equal(codigos.size, 50, 'nunca se repite un código en uso');
  cleanup(m);
});

test('exactamente 2 jugadores y una conexión por lugar', () => {
  const { m } = manager();
  const r = m.createRoom(P(), 'A');
  assert.match(m.joinRoom(r.room.code, P(), 'A').error, /Ya estás/);
  assert.ok(m.joinRoom(r.room.code, P('B'), 'B').room);
  assert.match(m.joinRoom(r.room.code, P('C'), 'C').error, /llena/);
  cleanup(m);
});

test('validación de entradas', () => {
  const { m } = manager();
  assert.match(m.joinRoom('9999', P(), 'A').error, /no existe/);
  assert.equal(V.roomCode(' 12 34 '), '1234');
  assert.equal(V.roomCode('0042'), '0042');
  assert.equal(V.roomCode('123'), null);
  assert.equal(V.roomCode('12345'), null);
  assert.match(require('../server/rooms').genTorneo(), V.TORNEO_RE);
  assert.equal(V.sanitizeName('<script>Ana</script>'), 'scriptAnascrip');
  assert.equal(V.plan({ dx: 25, angle: 45, power: 50, projectile: 'tiktok' }), null, 'no más de 24 px');
  assert.equal(V.plan({ dx: 2.5, angle: 45, power: 50, projectile: 'tiktok' }), null);
  assert.equal(V.plan({ dx: 0, angle: 90, power: 50, projectile: 'tiktok' }), null);
  assert.deepEqual(V.plan({ dx: -24, angle: 45, power: 50, projectile: 'instagram' }), { dx: -24, angle: 45, power: 50, projectile: 'instagram' });
  assert.equal(V.meta({ negocio: '<b>Café</b>' }).negocio, 'bCafé/b');
  cleanup(m);
});

test('límite de frecuencia por conexión', () => {
  const allow = V.createRateLimiter({ capacity: 3, refillPerSec: 1, minIntervals: { plan: 1000 } });
  assert.equal(allow('plan'), true);
  assert.equal(allow('plan'), false);
  assert.equal(allow('x'), true); assert.equal(allow('x'), true); assert.equal(allow('x'), false);
});

test('reconexión solo con el token correcto', () => {
  const { m } = manager();
  const r = m.createRoom(P(), 'A');
  m.disconnect('A');
  assert.match(m.resumeRoom(r.room.code, 'token-falso-token-falso-123', 'X').error, /No se pudo/);
  assert.equal(m.resumeRoom(r.room.code, r.token, 'A2').slot, 0);
  cleanup(m);
});

test('cada ronda trae viento; la partida trae rocas en el centro del mar', async () => {
  const { m, room } = await partida();
  assert.equal(room.state.round, 1);
  assert.ok(Math.abs(room.state.wind) <= C.WIND_MAX);
  assert.ok(room.state.rocks.length >= 1);
  for (const r of room.state.rocks) assert.ok(r.x >= C.ROCKS_X[0] && r.x <= C.ROCKS_X[1]);
  cleanup(m);
});

test('plan secreto: el rival no ve movimiento ni mira hasta que disparan los dos', async () => {
  const { m, room, events } = await partida({ PLAN_MS: 5000 });
  const x0 = room.state.ships[0].x;
  const t0 = tiro(room, 0, alAgua);
  assert.equal(m.engine.submitPlan(room, 0, plan(t0, 12)), true);
  assert.equal(m.engine.submitPlan(room, 0, plan(t0, 12)), false, 'un solo plan por ronda');
  const pub = publicState(room);
  assert.deepEqual(pub.locked, [true, false], 'el rival solo sabe que ya disparaste');
  assert.equal(pub.ships[0].x, x0, 'el barco todavía no se movió para nadie');
  assert.equal(JSON.stringify(pub).includes('pending'), false);
  assert.notEqual(pub.aim[0].angle, t0.angle);
  assert.ok(!events.some(([e]) => e === 'reveal'));
  const t1 = tiro(room, 1, alAgua);
  m.engine.submitPlan(room, 1, plan(t1, -6, 'instagram'));
  assert.equal(room.state.phase, 'REVEAL', 'con los dos planes se revela todo');
  const rv = events.find(([e]) => e === 'reveal')[1];
  assert.deepEqual(rv.moves, [{ from: x0, to: x0 + 12 }, { from: C.START_X[1], to: C.START_X[1] - 6 }]);
  assert.equal(rv.shots.length, 2);
  assert.equal(rv.moveMs, FAST.REVEAL_MOVE_MS, 'primero se mueven, luego vuelan las bombas');
  assert.equal(room.state.ships[0].x, x0 + 12);
  await until(() => room.state.phase === 'PLANNING' && room.state.round === 2);
  cleanup(m);
});

test('el movimiento no sale de su zona', async () => {
  const { m, room, events } = await partida({ PLAN_MS: 5000 });
  room.state.ships[0].x = C.ZONES[0][0] + 5;
  const t = tiro(room, 0, alAgua), t1 = tiro(room, 1, alAgua);
  m.engine.submitPlan(room, 0, plan(t, -24)); m.engine.submitPlan(room, 1, plan(t1, 0));
  assert.equal(events.find(([e]) => e === 'reveal')[1].moves[0].to, C.ZONES[0][0]);
  cleanup(m);
});

test('se acaba el tiempo: quien no envió su plan no se mueve ni dispara', async () => {
  const { m, room, events } = await partida();
  const t0 = tiro(room, 0, alAgua);
  m.engine.submitPlan(room, 0, plan(t0, 4));
  await until(() => events.some(([e]) => e === 'reveal'), 2000);
  const rv = events.find(([e]) => e === 'reveal')[1];
  assert.deepEqual(rv.missed, [1]);
  assert.equal(rv.shots.length, 1);
  assert.deepEqual(rv.moves[1], { from: C.START_X[1], to: C.START_X[1] });
  await until(() => room.state.phase === 'PLANNING' && room.state.round === 2, 3000);
  cleanup(m);
});

test('daño simultáneo: proa −20, centro −8', async () => {
  const { m, room, events } = await partida({ PLAN_MS: 5000 });
  const t0 = tiro(room, 0, i => i.type === 'hull' && i.target === 1 && i.zone === 'proa');
  const t1 = tiro(room, 1, i => i.type === 'hull' && i.target === 0 && i.zone === 'centro');
  m.engine.submitPlan(room, 0, plan(t0)); m.engine.submitPlan(room, 1, plan(t1));
  await until(() => events.some(([e]) => e === 'resolution'));
  assert.deepEqual(room.state.ships.map(s => s.hp), [92, 80]);
  cleanup(m);
});

test('poderes: DOBLE duplica el golpe y ESCUDO lo anula (y se gastan)', async () => {
  const { m, room, events } = await partida({ PLAN_MS: 5000 });
  room.state.powers[0].doble = true; room.state.powers[0].escudo = true;
  const t0 = tiro(room, 0, i => i.type === 'hull' && i.target === 1 && i.zone === 'proa');
  const t1 = tiro(room, 1, i => i.type === 'hull' && i.target === 0 && i.zone === 'proa');
  m.engine.submitPlan(room, 0, plan(t0)); m.engine.submitPlan(room, 1, plan(t1));
  await until(() => events.some(([e]) => e === 'resolution'));
  assert.deepEqual(room.state.ships.map(s => s.hp), [100, 60], 'escudo: 0 · doble: −40');
  assert.deepEqual(room.state.powers[0], { escudo: false, doble: false });
  cleanup(m);
});

test('Caja 360: aparece cada 3 rondas y quien la toca gana un poder', async () => {
  const { m, room, events } = await partida({ PLAN_MS: 5000 });
  assert.equal(room.state.crate, null);
  room.state.round = 2;
  room.state.crate = { x: 240, y: 95 };
  const t0 = tiro(room, 0, null, { todo: true, where: x => x.crateHit });
  const t1 = tiro(room, 1, alAgua);
  m.engine.submitPlan(room, 0, plan(t0)); m.engine.submitPlan(room, 1, plan(t1));
  await until(() => events.some(([e]) => e === 'resolution'));
  const res = events.find(([e]) => e === 'resolution')[1];
  assert.deepEqual(res.crate, { by: 0, power: 'escudo' }, 'random() = 0,1 → primer poder');
  assert.equal(room.state.powers[0].escudo, true);
  assert.equal(room.state.crate, null, 'la caja desaparece');
  await until(() => room.state.round === 3);
  assert.ok(room.state.crate, 'en la ronda 3 vuelve a aparecer');
  cleanup(m);
});

test('si los dos barcos se hunden en la misma ronda, es empate', async () => {
  const { m, room } = await partida({ PLAN_MS: 5000 });
  room.state.ships[0].hp = 8; room.state.ships[1].hp = 8;
  const t0 = tiro(room, 0, i => i.type === 'hull' && i.target === 1);
  const t1 = tiro(room, 1, i => i.type === 'hull' && i.target === 0);
  m.engine.submitPlan(room, 0, plan(t0)); m.engine.submitPlan(room, 1, plan(t1));
  await until(() => room.state.phase === 'GAME_OVER');
  assert.equal(room.state.winner, null); assert.equal(room.state.reason, 'empate');
  cleanup(m);
});

test('victoria normal y la vida nunca baja de 0', async () => {
  const { m, room, events } = await partida({ PLAN_MS: 5000 });
  room.state.ships[1].hp = 5;
  const t0 = tiro(room, 0, i => i.type === 'hull' && i.target === 1 && i.zone === 'centro');
  m.engine.submitPlan(room, 0, plan(t0)); m.engine.submitPlan(room, 1, plan(tiro(room, 1, alAgua)));
  await until(() => room.state.phase === 'GAME_OVER');
  assert.equal(room.state.ships[1].hp, 0); assert.equal(room.state.winner, 0);
  const go = events.find(([e]) => e === 'gameOver')[1];
  assert.deepEqual(go.names, ['Ana', 'Beto']);
  cleanup(m);
});

test('desconexión: pausa, reconexión reanuda; sin volver, gana el otro por abandono', async () => {
  const { m, room, a } = await partida({ PLAN_MS: 2000 });
  m.disconnect('A');
  assert.equal(room.state.phase, 'PAUSED');
  m.resumeRoom(room.code, a.token, 'A2');
  assert.equal(room.state.phase, 'PLANNING');
  m.disconnect('A2');
  await wait(FAST.RECONNECT_MS + 60);
  assert.equal(room.state.phase, 'GAME_OVER'); assert.equal(room.state.winner, 1); assert.equal(room.state.reason, 'abandono');
  cleanup(m);
});

test('si se van los dos, la sala se borra después del período de gracia', async () => {
  const { m, room } = await partida();
  m.disconnect('A'); m.disconnect('B');
  await wait(FAST.RECONNECT_MS + FAST.EMPTY_ROOM_MS + 80);
  assert.equal(m.rooms.has(room.code), false);
});

test('recuperar una sala guardada (anfitrión que recargó) reinicia el plan de la ronda', async () => {
  const { m, room } = await partida({ PLAN_MS: 5000 });
  room.state.ships[0].hp = 64;
  m.engine.submitPlan(room, 0, plan(tiro(room, 0, alAgua)));
  const snap = { code: room.code, meta: room.meta, state: JSON.parse(JSON.stringify(room.state)),
    players: room.players.map((p, i) => ({ name: p.name, conecti: p.conecti, ship: p.ship, token: p.token, connected: true, socketId: i ? 'B' : 'A' })) };
  m.deleteRoom(room.code);
  const r2 = m.restoreRoom(snap);
  assert.equal(r2.state.phase, 'PLANNING');
  assert.deepEqual(r2.state.locked, [false, false], 'los planes se vuelven a hacer');
  assert.equal(r2.state.ships[0].hp, 64, 'la vida se conserva');
  assert.equal(r2.meta.negocio, 'Café Aroma');
  cleanup(m);
});

test('revancha: empieza solo cuando los dos aceptan y reinicia todo', async () => {
  const { m, room } = await partida({ PLAN_MS: 5000 });
  room.state.ships[1].hp = 8; room.state.powers[0].doble = true;
  m.engine.submitPlan(room, 0, plan(tiro(room, 0, i => i.type === 'hull' && i.target === 1)));
  m.engine.submitPlan(room, 1, plan(tiro(room, 1, alAgua)));
  await until(() => room.state.phase === 'GAME_OVER', 3000);
  m.engine.requestRematch(room, 0);
  assert.equal(room.state.phase, 'GAME_OVER');
  m.engine.requestRematch(room, 1);
  assert.equal(room.state.phase, 'WAITING');
  assert.deepEqual(room.state.ships.map(s => [s.x, s.hp]), [[C.START_X[0], 100], [C.START_X[1], 100]]);
  assert.deepEqual(room.state.powers[0], { escudo: false, doble: false });
  cleanup(m);
});
