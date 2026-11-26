export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Interpolación exponencial independiente del frame rate. */
export const damp = (a: number, b: number, lambda: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-lambda * dt));

/** Normaliza un ángulo a (-PI, PI]. */
export const wrapAngle = (a: number): number => {
  const twoPi = Math.PI * 2;
  let r = a % twoPi;
  if (r <= -Math.PI) r += twoPi;
  if (r > Math.PI) r -= twoPi;
  return r;
};

/** Gira el ángulo `from` hacia `to` como máximo `maxStep` radianes (camino corto). */
export const rotateTowards = (from: number, to: number, maxStep: number): number => {
  const delta = wrapAngle(to - from);
  if (Math.abs(delta) <= maxStep) return to;
  return wrapAngle(from + Math.sign(delta) * maxStep);
};

export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
