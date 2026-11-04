'use strict';
/*
 * Física determinista del disparo (paso fijo).
 *   vx = v · cos(θ) · facing      vy = v · sin(θ)
 *   x(t) = x0 + vx·t              y(t) = y0 − vy·t + ½·g·t²   (y crece hacia abajo)
 * Se integra con paso fijo dt = 1/PHYS_HZ usando la fórmula cerrada en cada paso
 * (sin error acumulado) y se revisan colisiones entre pasos con sub-muestreo.
 */
const C = require('../shared/constants');
const { hitsHull, zoneAt } = require('./collisions');

const toRad = d => (d * Math.PI) / 180;

/** Boca del cañón en el mundo, según la posición del barco, su orientación y el ángulo. */
function muzzle(shipX, facing, angleDeg) {
  const px = shipX + facing * C.CANNON_PIVOT_DX, py = C.CANNON_PIVOT_Y;
  const a = toRad(angleDeg);
  return { x: px + facing * Math.cos(a) * C.CANNON_LEN, y: py - Math.sin(a) * C.CANNON_LEN };
}

/**
 * Simula un disparo.
 * @param {object} p  { shooter, ships:[{x},{x}], angle, power }
 * @returns {object}  { path:[[x,y]...], impact:{type,x,y,target?,zone?,damage}, flightMs }
 */
function simulateShot({ shooter, ships, angle, power }) {
  const facing = C.FACING[shooter];
  const start = muzzle(ships[shooter].x, facing, angle);
  const v = (power / 100) * C.V_MAX;
  const a = toRad(angle);
  const vx = v * Math.cos(a) * facing, vy = v * Math.sin(a);
  const dt = 1 / C.PHYS_HZ, g = C.GRAVITY;
  const maxSteps = Math.ceil(C.MAX_FLIGHT_S * C.PHYS_HZ);
  const SUB = 3;

  const path = [[round1(start.x), round1(start.y)]];
  let prev = { x: start.x, y: start.y };
  let impact = null;

  for (let step = 1; step <= maxSteps && !impact; step++) {
    for (let s = 1; s <= SUB && !impact; s++) {
      const t = (step - 1 + s / SUB) * dt;
      const x = start.x + vx * t;
      const y = start.y - vy * t + 0.5 * g * t * t;
      // Cascos: primero el rival, luego el propio (después del período de gracia)
      const order = [1 - shooter, shooter];
      for (const target of order) {
        if (target === shooter && step <= C.SELF_HIT_GRACE) continue;
        if (hitsHull(ships[target].x, x, y)) {
          const z = zoneAt(ships[target].x, C.FACING[target], x);
          impact = { type: 'hull', x: round1(x), y: round1(y), target, zone: z.zone, damage: z.damage, self: target === shooter };
          break;
        }
      }
      if (impact) break;
      if (y >= C.SEA_Y) {
        // Punto exacto donde cruza el nivel del mar (interpolación lineal)
        const k = (C.SEA_Y - prev.y) / (y - prev.y || 1);
        impact = { type: 'water', x: round1(prev.x + (x - prev.x) * k), y: C.SEA_Y, damage: 0 };
        break;
      }
      if (x < -40 || x > C.WIDTH + 40) { impact = { type: 'out', x: round1(x), y: round1(y), damage: 0 }; break; }
      prev = { x, y };
    }
    if (step % C.PATH_EVERY === 0 || impact) path.push([round1(prev.x), round1(prev.y)]);
    if (impact) { path.push([impact.x, impact.y]); }
    else if (step === maxSteps) impact = { type: 'out', x: round1(prev.x), y: round1(prev.y), damage: 0 };
  }
  const flightMs = Math.round(((path.length - 1) * C.PATH_EVERY * 1000) / C.PHYS_HZ);
  return { start, path, impact, flightMs: Math.max(300, flightMs) };
}

const round1 = n => Math.round(n * 10) / 10;

module.exports = { simulateShot, muzzle };
