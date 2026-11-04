'use strict';
const C = require('../shared/constants');
const { simulateShot } = require('../server/physics');

/** Busca (por fuerza bruta) un disparo que cumpla la condición. Devuelve {angle, power, shot} o null. */
function findShot({ shooter, ships, where }) {
  for (let angle = C.ANGLE_MIN; angle <= C.ANGLE_MAX; angle += 1) {
    for (let power = C.POWER_MIN; power <= C.POWER_MAX; power += 1) {
      const shot = simulateShot({ shooter, ships, angle, power });
      if (where(shot.impact)) return { angle, power, shot };
    }
  }
  return null;
}

const wait = ms => new Promise(r => setTimeout(r, ms));

/** Espera hasta que la condición sea verdadera (o falla tras `timeout` ms). */
async function until(cond, timeout = 4000, step = 10) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeout) throw new Error('Tiempo de espera agotado');
    await wait(step);
  }
}

module.exports = { findShot, wait, until };
