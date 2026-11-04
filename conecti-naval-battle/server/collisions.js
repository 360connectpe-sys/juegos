'use strict';
/* Colisiones del proyectil con los cascos y cálculo de daño por zona. */
const C = require('../shared/constants');

/** Rectángulo del casco de un barco centrado en x (coordenadas del mundo). */
function hullRect(shipX) {
  return { left: shipX - C.HULL_W / 2, right: shipX + C.HULL_W / 2, top: C.HULL_TOP, bottom: C.HULL_BOTTOM };
}

/** ¿El círculo (px, py, r) toca el casco? */
function hitsHull(shipX, px, py, r = C.PROJECTILE_R) {
  const h = hullRect(shipX);
  const cx = Math.max(h.left, Math.min(px, h.right));
  const cy = Math.max(h.top, Math.min(py, h.bottom));
  const dx = px - cx, dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

/**
 * Zona del casco según coordenadas LOCALES del barco.
 * u = 0 en la popa (atrás) y u = 1 en la proa (adelante), según hacia dónde mira el barco.
 */
function zoneAt(shipX, facing, hitX) {
  const h = hullRect(shipX);
  let u = (Math.max(h.left, Math.min(hitX, h.right)) - h.left) / C.HULL_W; // 0 a la izquierda
  if (facing < 0) u = 1 - u;                                                // proa a la izquierda
  if (u >= 0.75) return { zone: 'proa', damage: C.DAMAGE_CRIT, u };
  if (u < 0.25) return { zone: 'popa', damage: C.DAMAGE_CRIT, u };
  return { zone: 'centro', damage: C.DAMAGE_ARMOR, u };
}

module.exports = { hullRect, hitsHull, zoneAt };
