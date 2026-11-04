'use strict';
/*
 * Prueba de punta a punta: servidor real + dos clientes Socket.io conectados por red local.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { startServer } = require('../server');
const { findShot, until, wait } = require('./helpers');

const FAST = { MOVE_MS: 1500, AIM_MS: 3000, RESOLUTION_MS: 60, START_DELAY_MS: 40, RECONNECT_MS: 400, EMPTY_ROOM_MS: 300 };

function cliente(url) {
  const s = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  s.estado = null; s.eventos = [];
  s.on('state', st => { s.estado = st; });
  for (const ev of ['shots', 'resolution', 'gameOver', 'matchStart', 'aim', 'timeout']) s.on(ev, p => s.eventos.push([ev, p]));
  return s;
}
const pedir = (s, ev, p) => new Promise(r => s.emit(ev, p, r));

test('dos jugadores juegan una partida completa por red', async t => {
  const srv = await startServer({ port: 0, timings: FAST, quiet: true });
  const url = `http://localhost:${srv.port}`;
  const A = cliente(url), B = cliente(url), Z = cliente(url);
  t.after(async () => { [A, B, Z].forEach(s => s.close()); await srv.close(); });

  const ca = await pedir(A, 'create', { name: 'Ana<b>', conecti: 'morado', ship: 'azul' });
  assert.ok(ca.ok); assert.match(ca.code, /^CNX-[A-Z2-9]{4}$/);
  const cb = await pedir(B, 'join', { code: ca.code.slice(4).toLowerCase(), name: 'Beto', conecti: 'verde', ship: 'morado' });
  assert.ok(cb.ok, 'se une escribiendo solo las 4 letras en minúscula');
  const cz = await pedir(Z, 'join', { code: ca.code, name: 'Intruso', conecti: 'azul', ship: 'azul' });
  assert.equal(cz.ok, false, 'el tercero no entra');

  await until(() => A.estado && A.estado.players[1]);
  assert.equal(A.estado.players[0].name, 'Anab', 'nombre saneado');
  assert.deepEqual(A.estado.players.map(p => p.conecti), ['morado', 'verde']);
  assert.equal(JSON.stringify(A.estado).includes(ca.token), false, 'los tokens nunca se envían');

  await pedir(A, 'ready', { ready: true }); await pedir(B, 'ready', { ready: true });
  await until(() => A.estado.phase === 'MOVEMENT' && B.estado.phase === 'MOVEMENT');

  // Los dos se mueven a la vez y cada uno ve el movimiento del otro
  const x0 = A.estado.ships[0].x, x1 = A.estado.ships[1].x;
  await pedir(A, 'move', { dx: 4 });
  await pedir(B, 'move', { dx: -4 });
  await until(() => B.estado.ships[0].x === x0 + 4 && A.estado.ships[1].x === x1 - 4);
  assert.equal(A.estado.ships[1].moveLeft, 20, 'posición y presupuesto sincronizados');
  assert.equal((await pedir(A, 'move', { dx: 50 })).ok, false, 'pasos fuera de rango se rechazan');
  await pedir(A, 'endMove', {});
  await until(() => B.estado.moved[0] === true);
  assert.equal(B.estado.phase, 'MOVEMENT', 'espera a que el otro confirme');
  await pedir(B, 'endMove', {});
  await until(() => A.estado.phase === 'AIMING' && B.estado.phase === 'AIMING');

  // Disparos secretos y simultáneos
  const tA = findShot({ shooter: 0, ships: A.estado.ships, where: i => i.type === 'hull' && i.target === 1 && i.zone !== 'centro' });
  const tB = findShot({ shooter: 1, ships: A.estado.ships, where: i => i.type === 'water' });
  assert.equal((await pedir(A, 'fire', { angle: tA.angle, power: tA.power, projectile: 'tiktok', damage: 999 })).ok, true);
  assert.equal((await pedir(A, 'fire', { angle: tA.angle, power: tA.power, projectile: 'tiktok' })).ok, false, 'no hay segundo disparo');
  await until(() => B.estado.locked[0] === true);
  assert.notEqual(B.estado.aim[0].angle, tA.angle, 'el rival no ve hacia dónde apuntó');
  assert.equal(B.eventos.some(([e]) => e === 'shots'), false, 'nada sale hasta que disparen los dos');
  assert.equal((await pedir(B, 'fire', { angle: tB.angle, power: tB.power, projectile: 'instagram' })).ok, true);
  await until(() => A.eventos.some(([e]) => e === 'resolution') && B.eventos.some(([e]) => e === 'resolution'));
  const sA = A.eventos.find(([e]) => e === 'shots')[1], sB = B.eventos.find(([e]) => e === 'shots')[1];
  assert.equal(sA.shots.length, 2, 'salen los dos proyectiles juntos');
  assert.deepEqual(sA.shots.map(x => x.path), sB.shots.map(x => x.path), 'los dos ven las mismas trayectorias');
  assert.equal(sA.shots[0].impact.damage, 20, 'el daño extra enviado por el cliente se ignora');
  await until(() => A.estado.ships[1].hp === 80 && B.estado.ships[1].hp === 80 && A.estado.ships[0].hp === 100);
  await until(() => A.estado.phase === 'MOVEMENT' && A.estado.round === 2);
  const yo = 0, J = A, R = B;

  // Desconexión y reconexión con token
  const tokenR = R === A ? ca.token : cb.token;
  R.close();
  await until(() => J.estado.phase === 'PAUSED');
  assert.equal(J.estado.players[1 - yo].connected, false);
  const R2 = cliente(url);
  t.after(() => R2.close());
  const rr = await pedir(R2, 'resume', { code: ca.code, token: tokenR });
  assert.ok(rr.ok); assert.equal(rr.slot, 1 - yo);
  await until(() => J.estado.phase === 'MOVEMENT');
  assert.equal(J.estado.ships[1 - yo].hp, 80, 'el estado se conservó en el servidor');

  // Abandono: si no vuelve a tiempo, gana el otro
  R2.close();
  await until(() => J.estado.phase === 'GAME_OVER', 3000);
  assert.equal(J.estado.winner, yo);
  assert.equal(J.estado.reason, 'abandono');
});

test('el servidor responde /health y sirve el juego', async t => {
  const srv = await startServer({ port: 0, timings: FAST, quiet: true });
  t.after(() => srv.close());
  const r = await fetch(`http://localhost:${srv.port}/health`);
  assert.equal((await r.json()).ok, true);
  const h = await fetch(`http://localhost:${srv.port}/`);
  assert.match(await h.text(), /CONECTI NAVAL BATTLE/);
  const c = await fetch(`http://localhost:${srv.port}/shared/constants.js`);
  assert.equal(c.status, 200);
  await wait(10);
});
