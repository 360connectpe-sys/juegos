'use strict';
/*
 * Física determinista del disparo (paso fijo de 1/60 s, 3 sub-pasos de colisión).
 *
 *   x(t) = x0 + vx·t + ½·viento·t²       y(t) = y0 + vy·t + ½·g·t²     (y crece hacia abajo, vy < 0 sube)
 *   vx = v·cos(θ)·facing                 vy = −v·sin(θ)
 *
 * Efectos de cada proyectil:
 *   TikTok    → rebota UNA vez en el agua (pierde fuerza) y sigue volando.
 *   Instagram → en el punto más alto se divide en 3 fragmentos; cada uno hace la mitad del daño.
 * Obstáculos: rocas en el centro del mar (bloquean) y la Caja 360 en el aire (da un poder).
 */
const C = require('../shared/constants');
const { hitsHull, zoneAt, hitsRect } = require('./collisions');

const toRad = d => (d * Math.PI) / 180;
const r1 = n => Math.round(n * 10) / 10;
const DT = 1 / C.PHYS_HZ, SUB = 3;

/** Boca del cañón en el mundo, según la posición del barco, su orientación y el ángulo. */
function muzzle(shipX, facing, angleDeg) {
  const px = shipX + facing * C.CANNON_PIVOT_DX, py = C.CANNON_PIVOT_Y;
  const a = toRad(angleDeg);
  return { x: px + facing * Math.cos(a) * C.CANNON_LEN, y: py - Math.sin(a) * C.CANNON_LEN };
}

/** Rectángulos de las rocas (en el mundo). */
const rockRect = rk => ({ left: rk.x - rk.w / 2, right: rk.x + rk.w / 2, top: C.SEA_Y - rk.h, bottom: C.SEA_Y + 4 });
const crateRect = cr => ({ left: cr.x - C.CRATE_SIZE / 2, right: cr.x + C.CRATE_SIZE / 2, top: cr.y - C.CRATE_SIZE / 2, bottom: cr.y + C.CRATE_SIZE / 2 });

/**
 * Simula un tramo de vuelo con fórmula cerrada hasta que choca con algo (o llega a su punto más alto).
 * Devuelve los puntos del recorrido y cómo terminó.
 */
function tramo({ x0, y0, vx, vy, shooter, ships, wind, rocks, crate, grace, alCima }) {
  const g = C.GRAVITY;
  const path = [[r1(x0), r1(y0)]];
  const maxSteps = Math.ceil(C.MAX_FLIGHT_S * C.PHYS_HZ);
  let prev = { x: x0, y: y0 };
  for (let step = 1; step <= maxSteps; step++) {
    for (let s = 1; s <= SUB; s++) {
      const t = (step - 1 + s / SUB) * DT;
      const x = x0 + vx * t + 0.5 * wind * t * t;
      const y = y0 + vy * t + 0.5 * g * t * t;
      const vxT = vx + wind * t, vyT = vy + g * t;
      const fin = (type, extra = {}) => {
        path.push([r1(x), r1(y)]);
        return { path, steps: step, end: { type, x: r1(x), y: r1(y), vx: vxT, vy: vyT, ...extra } };
      };
      if (alCima && vy < 0 && vyT >= 0) return fin('apex');
      for (const target of [1 - shooter, shooter]) {
        if (target === shooter && step <= grace) continue;
        if (hitsHull(ships[target].x, x, y)) {
          const z = zoneAt(ships[target].x, C.FACING[target], x);
          return fin('hull', { target, zone: z.zone, base: z.damage, self: target === shooter });
        }
      }
      for (const rk of rocks) if (hitsRect(rockRect(rk), x, y)) return fin('rock');
      if (crate && hitsRect(crateRect(crate), x, y)) return fin('crate');
      if (y >= C.SEA_Y) {
        const k = (C.SEA_Y - prev.y) / (y - prev.y || 1);
        const xa = prev.x + (x - prev.x) * k;
        path.push([r1(xa), C.SEA_Y]);
        return { path, steps: step, end: { type: 'water', x: r1(xa), y: C.SEA_Y, vx: vxT, vy: vyT } };
      }
      if (x < -40 || x > C.WIDTH + 40) return fin('out');
      prev = { x, y };
    }
    if (step % C.PATH_EVERY === 0) path.push([r1(prev.x), r1(prev.y)]);
  }
  return { path, steps: maxSteps, end: { type: 'out', x: r1(prev.x), y: r1(prev.y), vx, vy } };
}

const msDe = steps => Math.round((steps * 1000) / C.PHYS_HZ);

/** Convierte el final de un tramo en un impacto con daño (sin aplicar poderes). */
function impacto(end, factor = 1) {
  if (end.type === 'hull') {
    return { type: 'hull', x: end.x, y: end.y, target: end.target, zone: end.zone, self: end.self, damage: Math.round(end.base * factor) };
  }
  return { type: end.type, x: end.x, y: end.y, damage: 0 };
}

/**
 * Simula un disparo completo.
 * @returns {{ trayectorias: Array<{path, startMs, durMs, impact, bounces?, fragment?}>, flightMs: number, start: object,
 *            path: number[][], impact: object }}   (path/impact = trayectoria principal, por compatibilidad)
 */
function simulateShot({ shooter, ships, angle, power, projectile = 'tiktok', wind = 0, rocks = [], crate = null }) {
  const facing = C.FACING[shooter];
  const start = muzzle(ships[shooter].x, facing, angle);
  const v = (power / 100) * C.V_MAX, a = toRad(angle);
  const base = { shooter, ships, wind, rocks, crate };
  const trayectorias = [];
  let caja = false;

  let seg = tramo({ ...base, x0: start.x, y0: start.y, vx: v * Math.cos(a) * facing, vy: -v * Math.sin(a), grace: C.SELF_HIT_GRACE, alCima: projectile === 'instagram' });
  const principal = { path: seg.path, startMs: 0, durMs: msDe(seg.steps), bounces: [] };

  if (projectile === 'tiktok' && seg.end.type === 'water') {
    // Rebote: sale hacia arriba con menos fuerza y sigue el mismo vuelo
    principal.bounces.push({ x: seg.end.x });
    const b = tramo({ ...base, x0: seg.end.x, y0: C.SEA_Y - 1, vx: seg.end.vx * C.TIKTOK_BOUNCE.vx, vy: -Math.abs(seg.end.vy) * C.TIKTOK_BOUNCE.vy, grace: 0, alCima: false });
    principal.path = principal.path.concat(b.path.slice(1));
    principal.durMs += msDe(b.steps);
    seg = b;
  }

  if (projectile === 'instagram' && seg.end.type === 'apex') {
    // Se divide en 3 fragmentos en el punto más alto
    principal.impact = { type: 'split', x: seg.end.x, y: seg.end.y, damage: 0 };
    trayectorias.push(principal);
    for (const k of C.INSTAGRAM_SPLIT) {
      const f = tramo({ ...base, x0: seg.end.x, y0: seg.end.y, vx: seg.end.vx * k, vy: 0, grace: 0, alCima: false });
      const imp = impacto(f.end, C.FRAGMENT_FACTOR);
      if (imp.type === 'crate') caja = true;
      trayectorias.push({ path: f.path, startMs: principal.durMs, durMs: msDe(f.steps), impact: imp, fragment: true });
    }
  } else {
    principal.impact = impacto(seg.end);
    if (principal.impact.type === 'crate') caja = true;
    trayectorias.push(principal);
  }

  const flightMs = Math.max(300, ...trayectorias.map(t => t.startMs + t.durMs));
  return { start, trayectorias, flightMs, crateHit: caja, path: principal.path, impact: trayectorias[trayectorias.length - 1].impact };
}

module.exports = { simulateShot, muzzle, rockRect, crateRect };
