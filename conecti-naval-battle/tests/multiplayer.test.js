'use strict';
/*
 * Prueba de punta a punta: servidor real + dos clientes Socket.io conectados por red local.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { startServer } = require('../server');
const { findShot, until, wait } = require('./helpers');

const FAST = { PLAN_MS: 3000, REVEAL_MOVE_MS: 20, RESOLUTION_MS: 60, START_DELAY_MS: 40, RECONNECT_MS: 400, EMPTY_ROOM_MS: 300 };

function cliente(url) {
  const s = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  s.estado = null; s.eventos = [];
  s.on('state', st => { s.estado = st; });
  for (const ev of ['reveal', 'resolution', 'gameOver', 'matchStart', 'torneo']) s.on(ev, p => s.eventos.push([ev, p]));
  return s;
}
const pedir = (s, ev, p) => new Promise(r => s.emit(ev, p, r));

test('dos jugadores juegan una partida completa por red', async t => {
  const srv = await startServer({ port: 0, timings: FAST, quiet: true });
  const url = `http://localhost:${srv.port}`;
  const A = cliente(url), B = cliente(url), Z = cliente(url);
  t.after(async () => { [A, B, Z].forEach(s => s.close()); await srv.close(); });

  const ca = await pedir(A, 'create', { name: 'Ana<b>', conecti: 'morado', ship: 'azul', meta: { negocio: 'Café Aroma', premio: '10% dscto' } });
  assert.ok(ca.ok); assert.match(ca.code, /^\d{4}$/);
  const cb = await pedir(B, 'join', { code: ' ' + ca.code + ' ', name: 'Beto', conecti: 'verde', ship: 'morado' });
  assert.ok(cb.ok, 'se une con los 4 números (aunque tenga espacios)');
  const cz = await pedir(Z, 'join', { code: ca.code, name: 'Intruso', conecti: 'azul', ship: 'azul' });
  assert.equal(cz.ok, false, 'el tercero no entra');

  await until(() => A.estado && A.estado.players[1]);
  assert.equal(A.estado.players[0].name, 'Anab', 'nombre saneado');
  assert.deepEqual(A.estado.players.map(p => p.conecti), ['morado', 'verde']);
  assert.equal(JSON.stringify(A.estado).includes(ca.token), false, 'los tokens nunca se envían');

  assert.equal(A.estado.meta.negocio, 'Café Aroma');
  await pedir(A, 'ready', { ready: true }); await pedir(B, 'ready', { ready: true });
  await until(() => A.estado.phase === 'PLANNING' && B.estado.phase === 'PLANNING');
  const st = A.estado, x0 = st.ships[0].x, x1 = st.ships[1].x;
  const cond = { wind: st.wind, rocks: st.rocks, crate: st.crate };

  // Plan secreto de A: moverse 10 y disparar
  const shipsA = [{ x: x0 + 10 }, { x: x1 - 8 }];
  const tA = findShot({ shooter: 0, ships: shipsA, ...cond, where: i => i.type === 'hull' && i.target === 1 && i.zone !== 'centro' });
  const tB = findShot({ shooter: 1, ships: shipsA, ...cond, where: i => i.type === 'water' });
  assert.equal((await pedir(A, 'plan', { dx: 10, angle: tA.angle, power: tA.power, projectile: 'tiktok', damage: 999 })).ok, true);
  assert.equal((await pedir(A, 'plan', { dx: 10, angle: tA.angle, power: tA.power, projectile: 'tiktok' })).ok, false, 'un solo plan por ronda');
  await until(() => B.estado.locked[0] === true);
  assert.equal(B.estado.ships[0].x, x0, 'B no ve el movimiento de A');
  assert.notEqual(B.estado.aim[0].angle, tA.angle, 'ni hacia dónde apuntó');
  assert.equal((await pedir(B, 'plan', { dx: 99, angle: 45, power: 50, projectile: 'tiktok' })).ok, false, 'movimiento fuera de rango');
  await wait(550);   // límite de frecuencia: un plan cada medio segundo como máximo
  assert.equal((await pedir(B, 'plan', { dx: -8, angle: tB.angle, power: tB.power, projectile: 'instagram' })).ok, true);
  await until(() => A.eventos.some(([e]) => e === 'resolution') && B.eventos.some(([e]) => e === 'resolution'));
  const rA = A.eventos.find(([e]) => e === 'reveal')[1], rB = B.eventos.find(([e]) => e === 'reveal')[1];
  assert.deepEqual(rA.moves, [{ from: x0, to: x0 + 10 }, { from: x1, to: x1 - 8 }], 'se revelan los dos movimientos juntos');
  assert.deepEqual(rA.shots.map(x => x.trayectorias.map(t => t.path)), rB.shots.map(x => x.trayectorias.map(t => t.path)), 'los dos ven las mismas trayectorias');
  assert.equal(rA.shots[0].trayectorias[0].impact.damage, 20, 'el daño extra enviado por el cliente se ignora');
  await until(() => A.estado.ships[1].hp === 80 && B.estado.ships[1].hp === 80);
  await until(() => A.estado.phase === 'PLANNING' && A.estado.round === 2);

  // Ranking semanal y torneo por red
  const rk = await pedir(A, 'ranking:get', {});
  assert.ok(rk.ok && Array.isArray(rk.top));
  const tc = await pedir(A, 'torneo:create', { nombre: 'Copa', jugadores: ['Ana', 'Beto', 'Caro', 'Dani'] });
  assert.ok(tc.ok);
  const tg = await pedir(B, 'torneo:get', { id: tc.id });
  assert.equal(tg.torneo.rondas[0].length, 2);
  const par = tg.torneo.rondas[0][0];
  assert.equal((await pedir(B, 'torneo:winner', { id: tc.id, token: 'falso', r: 0, m: 0, nombre: par.a })).ok, false, 'solo el organizador');
  assert.equal((await pedir(A, 'torneo:winner', { id: tc.id, token: tc.token, r: 0, m: 0, nombre: par.a })).ok, true);
  await until(() => B.eventos.some(([e, p]) => e === 'torneo' && p.rondas[1][0].a === par.a));
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
  await until(() => J.estado.phase === 'PLANNING');
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
