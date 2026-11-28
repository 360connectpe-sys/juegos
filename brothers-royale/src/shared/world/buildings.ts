/**
 * Fase 12: diseños de edificio adicionales y muebles. Mismo formato de prefab que el resto:
 * de las mismas piezas salen la malla (PrefabView, fusionada/instanciada) y los colisionadores.
 *
 * Diseños del mapa (al menos uno de cada en cada partida, ver layout.ts):
 *  - Casa rural de una planta ............ 'cabin' (structures.ts) + muebles
 *  - Casa familiar de dos plantas ......... casa grande del pueblo ('house') + muebles
 *  - Casa moderna con azotea .............. 'modern'
 *  - Casa con balcón ...................... 'balcony'
 *  - Almacén / garaje ..................... 'garage'
 *  - Edificio abandonado .................. 'ruin'
 * Más las variantes previas 'stone', 'long' y 'porch'.
 *
 * Reglas para no quedarse atascado: los muebles colisionan con UNA caja invisible de su
 * volumen completo (sin huecos bajo mesas o camas), van pegados a las paredes y dejan
 * siempre un pasillo ≥ 1 m entre la puerta, la escalera y el cofre.
 */
import type { Vec2 } from '../types';
import type { PartLayer, PrefabDef, PrefabPart } from './prefab';
import { bx, stairs } from './structures';

export type FurnitureKind = 'bed' | 'table' | 'chair' | 'shelf' | 'crate' | 'sofa' | 'bench' | 'car' | 'rubble';
/** Tamaño (ancho X, alto, fondo Z) del volumen sólido de cada mueble. */
export const FURNITURE_SIZE: Record<FurnitureKind, [number, number, number]> = {
  bed: [1.0, 0.55, 2.0], table: [1.2, 0.78, 0.8], chair: [0.45, 0.95, 0.45], shelf: [1.4, 1.8, 0.4],
  crate: [0.8, 0.8, 0.8], sofa: [1.8, 0.8, 0.8], bench: [1.6, 0.9, 0.6], car: [1.8, 1.5, 3.6], rubble: [1.1, 0.35, 0.9],
};
const WOOD = '#8a5a3b';
const DARK = '#5e3d27';

/**
 * Un mueble en (x, y, z) locales del prefab (y = suelo donde apoya). `turn` = gira 90°.
 * Colisión: una sola caja invisible del volumen completo; lo visible no colisiona.
 */
export function furniture(kind: FurnitureKind, x: number, y: number, z: number, layer: PartLayer, turn = false, color?: string): PrefabPart[] {
  const [sw, sh, sd] = FURNITURE_SIZE[kind];
  const w = turn ? sd : sw, d = turn ? sw : sd;
  const parts: PrefabPart[] = [bx([x, y + sh / 2, z], [w, sh, d], WOOD, layer, { visible: false })];
  const v = (c: [number, number, number], s: [number, number, number], col: string) => parts.push(bx([x + c[0], y + c[1], z + c[2]], turn ? [s[2], s[1], s[0]] : s, col, layer, { collide: false }));
  const o = (lx: number, lz: number): [number, number] => (turn ? [lz, lx] : [lx, lz]);
  switch (kind) {
    case 'bed': {
      v([0, 0.2, 0], [1.0, 0.3, 2.0], WOOD);
      v([0, 0.42, 0.1], [0.92, 0.14, 1.75], color ?? '#e9e2d0');
      const [px, pz] = o(0, -0.75); v([px, 0.52, pz], [0.8, 0.1, 0.35], '#ffffff');
      const [hx, hz] = o(0, -0.97); v([hx, 0.4, hz], [1.0, 0.8, 0.06], DARK);
      break;
    }
    case 'table': {
      v([0, 0.74, 0], [1.2, 0.08, 0.8], color ?? WOOD);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const [lx, lz] = o(sx * 0.52, sz * 0.32); v([lx, 0.35, lz], [0.08, 0.7, 0.08], DARK); }
      break;
    }
    case 'chair': {
      v([0, 0.45, 0], [0.45, 0.06, 0.45], color ?? WOOD);
      const [bxx, bzz] = o(0, -0.2); v([bxx, 0.72, bzz], [0.45, 0.5, 0.06], DARK);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const [lx, lz] = o(sx * 0.18, sz * 0.18); v([lx, 0.21, lz], [0.06, 0.42, 0.06], DARK); }
      break;
    }
    case 'shelf': {
      for (const sx of [-1, 1]) { const [lx, lz] = o(sx * 0.67, 0); v([lx, 0.9, lz], [0.06, 1.8, 0.4], DARK); }
      for (const h of [0.1, 0.65, 1.2, 1.75]) v([0, h, 0], [1.34, 0.05, 0.38], color ?? WOOD);
      const [bxx, bzz] = o(-0.3, 0); v([bxx, 0.85, bzz], [0.35, 0.35, 0.3], '#c98b4a');
      const [cx, cz] = o(0.35, 0); v([cx, 1.4, cz], [0.3, 0.3, 0.3], '#d9534f');
      break;
    }
    case 'crate': v([0, 0.4, 0], [0.8, 0.8, 0.8], color ?? '#c98b4a'); v([0, 0.4, 0], [0.84, 0.1, 0.84], DARK); break;
    case 'sofa': {
      v([0, 0.22, 0], [1.8, 0.44, 0.8], color ?? '#4f6fa8');
      const [bxx, bzz] = o(0, -0.32); v([bxx, 0.6, bzz], [1.8, 0.4, 0.16], color ?? '#3d5a8f');
      for (const sx of [-1, 1]) { const [lx, lz] = o(sx * 0.82, 0); v([lx, 0.5, lz], [0.16, 0.3, 0.8], color ?? '#3d5a8f'); }
      break;
    }
    case 'bench': v([0, 0.86, 0], [1.6, 0.08, 0.6], color ?? '#9b6a43'); v([0, 0.41, 0], [1.5, 0.82, 0.5], '#6b6b6b'); break;
    case 'car': {
      v([0, 0.55, 0], [1.8, 0.7, 3.6], color ?? '#c84b31');
      const [cx, cz] = o(0, -0.2); v([cx, 1.15, cz], [1.6, 0.55, 1.8], '#9ad1e6');
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const [lx, lz] = o(sx * 0.92, sz * 1.15); v([lx, 0.3, lz], [0.12, 0.6, 0.6], '#222222'); }
      break;
    }
    case 'rubble': v([0, 0.15, 0], [1.1, 0.3, 0.9], color ?? '#8f8a80'); v([0.2, 0.3, -0.1], [0.5, 0.2, 0.4], '#a39d92'); break;
  }
  return parts;
}

export type ExtraVariant = 'modern' | 'balcony' | 'garage' | 'ruin';
export const EXTRA_VARIANTS: readonly ExtraVariant[] = ['modern', 'balcony', 'garage', 'ruin'];
/** Huella (ancho X, fondo Z, alto de pared) y margen extra para la zona plana (escalera, balcón). */
export const EXTRA_SIZE: Record<ExtraVariant, { w: number; d: number; h: number; door: number; extra: number }> = {
  modern: { w: 6.4, d: 5.6, h: 2.8, door: 1.0, extra: 2.4 },
  balcony: { w: 6, d: 5.6, h: 2.8, door: 1.2, extra: 2 },
  garage: { w: 7, d: 8, h: 3.4, door: 0, extra: 1.5 },
  ruin: { w: 6, d: 6, h: 2.7, door: -0.6, extra: 2 },
};
const T = 0.25;
const FRONT: Vec2 = { x: 0, y: 1 }, BACK: Vec2 = { x: 0, y: -1 }, LEFT: Vec2 = { x: -1, y: 0 }, RIGHT: Vec2 = { x: 1, y: 0 };

/** Fachada (+Z) con hueco de puerta en doorX: tres piezas que colisionan + dintel. */
function frontWall(parts: PrefabPart[], W: number, D: number, y0: number, H: number, doorX: number, doorW: number, doorH: number, color: string, trim: string, layer: PartLayer): void {
  const hw = W / 2, hd = D / 2, cy = y0 + H / 2;
  const dl = doorX - doorW / 2, dr = doorX + doorW / 2;
  if (dl + hw > 0.01) parts.push(bx([(-hw + dl) / 2, cy, hd - T / 2], [dl + hw, H, T], color, layer, { facing: FRONT }));
  if (hw - dr > 0.01) parts.push(bx([(dr + hw) / 2, cy, hd - T / 2], [hw - dr, H, T], color, layer, { facing: FRONT }));
  if (H - doorH > 0.01) parts.push(bx([doorX, y0 + doorH + (H - doorH) / 2, hd - T / 2], [doorW, H - doorH, T], color, layer, { facing: FRONT }));
  parts.push(bx([doorX, y0 + doorH, hd - T / 2], [doorW + 0.1, 0.1, T + 0.06], trim, layer, { collide: false, facing: FRONT }));
}
/** Tres paredes ciegas (fondo, izquierda, derecha). */
function sideWalls(parts: PrefabPart[], W: number, D: number, y0: number, H: number, color: string, layer: PartLayer): void {
  const hw = W / 2, hd = D / 2, cy = y0 + H / 2;
  parts.push(bx([0, cy, -hd + T / 2], [W, H, T], color, layer, { facing: BACK }));
  parts.push(bx([-hw + T / 2, cy, 0], [T, H, D], color, layer, { facing: LEFT }));
  parts.push(bx([hw - T / 2, cy, 0], [T, H, D], color, layer, { facing: RIGHT }));
}
/** Ventana en relieve (no colisiona) en una pared exterior. */
function windowAt(parts: PrefabPart[], x: number, y: number, z: number, facing: Vec2, layer: PartLayer, color = '#5bc0eb', w = 1): void {
  const along = facing.x === 0;
  parts.push(bx([x + facing.x * 0.02, y, z + facing.y * 0.02], along ? [w, 0.8, 0.06] : [0.06, 0.8, w], color, layer, { collide: false, facing }));
  parts.push(bx([x + facing.x * 0.05, y - 0.46, z + facing.y * 0.05], along ? [w + 0.2, 0.1, 0.12] : [0.12, 0.1, w + 0.2], '#6b4a2b', layer, { collide: false, facing }));
}
/** Pretil/barandilla de azotea o balcón (colisiona). */
function rail(parts: PrefabPart[], cx: number, y: number, cz: number, sx: number, sz: number, color: string, layer: PartLayer, h = 0.9): void {
  parts.push(bx([cx, y + h / 2, cz], [sx, h, sz], color, layer));
}
/** Losa del suelo interior (solo visual: el terreno es plano). */
function floorSlab(parts: PrefabPart[], W: number, D: number, trim: string, floor: string): void {
  parts.push(bx([0, 0.03, 0], [W + 0.3, 0.06, D + 0.3], trim, 'base', { collide: false }));
  parts.push(bx([0, 0.07, 0], [W - 2 * T, 0.04, D - 2 * T], floor, 'base', { collide: false }));
}

/** Casa moderna: planta baja con ventanales y azotea transitable con pretil; escalera exterior. */
function createModern(pal: { wall: string; roof: string; trim: string }): PrefabDef {
  const { w: W, d: D, h: H, door } = EXTRA_SIZE.modern;
  const hw = W / 2, hd = D / 2, parts: PrefabPart[] = [];
  const wall = '#eceff1', accent = pal.roof;
  floorSlab(parts, W, D, '#5f6368', '#cfd8dc');
  sideWalls(parts, W, D, 0, H, wall, 'base');
  frontWall(parts, W, D, 0, H, door, 1.3, 2.2, wall, accent, 'base');
  windowAt(parts, -1.4, 1.5, hd, FRONT, 'base', '#7fd3f7', 2.0);
  windowAt(parts, -hw, 1.5, 0, LEFT, 'base', '#7fd3f7', 2.2);
  windowAt(parts, 0.8, 1.5, -hd, BACK, 'base', '#7fd3f7', 1.6);
  // Azotea: losa sólida (cara superior en H + 0.2) y pretil con hueco donde llega la escalera.
  const roofTop = H + 0.2;
  parts.push(bx([0, H + 0.1, 0], [W + 0.3, 0.2, D + 0.3], '#90a4ae', 'roof'));
  const ph = 0.9, py = roofTop, e = hd + 0.1;
  rail(parts, 0, py, e, W + 0.3, 0.15, accent, 'roof', ph);
  rail(parts, 0, py, -e, W + 0.3, 0.15, accent, 'roof', ph);
  rail(parts, -hw - 0.1, py, 0, 0.15, D + 0.3, accent, 'roof', ph);
  const gap = 1.1; // hueco al fondo del lado +X (rellano de la escalera)
  const railLen = D + 0.3 - gap;
  rail(parts, hw + 0.1, py, -hd - 0.15 + gap + railLen / 2, 0.15, railLen, accent, 'roof', ph);
  // Mobiliario de azotea: tumbona y macetas (sólidos bajos).
  parts.push(...furniture('bench', 1.0, roofTop, -0.2, 'roof', false, '#ffb000'));
  parts.push(bx([-hw + 0.6, roofTop + 0.3, hd - 0.6], [0.5, 0.6, 0.5], '#6d8b3a', 'roof'));
  // Escalera exterior pegada a la pared +X: sube de delante (+Z) hacia el fondo y un rellano.
  const sx = hw + 0.6, start = hd - 0.2, landing = 1.0, run = D - 0.2 - landing;
  parts.push(...stairs(sx, start, 0, roofTop, run, 1.1, -1, '#78909c', 'base'));
  parts.push(bx([sx, roofTop - 0.1, -hd + landing / 2], [1.1, 0.2, landing], '#78909c', 'base'));
  parts.push(bx([sx + 0.6, roofTop + 0.45, -hd + landing / 2 + 0.6], [0.08, 0.9, landing + 1.2], accent, 'base'));
  // Interior: sofá, mesa baja y estantería (pasillo libre desde la puerta).
  parts.push(...furniture('sofa', 1.6, 0, -hd + T + 0.45, 'base'));
  parts.push(...furniture('table', 1.6, 0, -0.4, 'base', false, '#eceff1'));
  parts.push(...furniture('shelf', hw - T - 0.25, 0, 1.2, 'base', true));
  return { id: 'small-modern', parts, clearRadius: Math.hypot(hw + 1.2, hd) + 2,
    nav: { door: { x: door, z: hd + 1.2 }, inside: { x: door, z: hd - 1.0 }, climbs: [[{ x: sx, y: 0, z: hd + 0.9 }, { x: sx, y: roofTop, z: -hd + landing / 2 }, { x: hw - 0.8, y: roofTop, z: -hd + landing / 2 }]] },
    interior: { min: { x: -hw + T - 0.1, y: -0.5, z: -hd + T - 0.1 }, max: { x: hw - T + 0.1, y: H - 0.4, z: hd - T + 0.1 } } };
}

/** Casa de dos plantas con balcón delantero (puerta en la planta alta) y escalera interior. */
function createBalcony(pal: { wall: string; roof: string; trim: string }): PrefabDef {
  const { w: W, d: D, h: G, door } = EXTRA_SIZE.balcony;
  const U = 2.6, top = G + U, hw = W / 2, hd = D / 2, parts: PrefabPart[] = [];
  const wall = pal.wall, upper = '#f6efe1';
  floorSlab(parts, W, D, pal.trim, '#b88a5e');
  sideWalls(parts, W, D, 0, G, wall, 'base');
  frontWall(parts, W, D, 0, G, door, 1.3, 2.2, wall, pal.trim, 'base');
  sideWalls(parts, W, D, G, U, upper, 'upper');
  frontWall(parts, W, D, G, U, 0, 1.2, 2.1, upper, pal.trim, 'upper');
  for (const [layer, y] of [['base', 1.5], ['upper', G + 1.4]] as const) {
    windowAt(parts, hw, y, -1.2, RIGHT, layer); windowAt(parts, -hw, y, 1.2, LEFT, layer); windowAt(parts, 1.5, y, -hd, BACK, layer);
  }
  windowAt(parts, -1.6, 1.5, hd, FRONT, 'base');
  // Planta alta: losa con hueco sobre la escalera (columna izquierda) y barandilla.
  // El hueco es 0,3 m más ancho que la escalera: subir pegado al borde no roza la losa.
  const stairW = 1.2, x0 = -hw + T, x1 = x0 + stairW + 0.3, landing = 1.0, zTop = -hd + T + landing;
  const inner = hw - T - x1;
  parts.push(bx([x1 + inner / 2, G - 0.1, 0], [inner, 0.2, D - 2 * T], '#b88a5e', 'upper'));
  parts.push(bx([(x0 + x1) / 2, G - 0.1, (-hd + T + zTop) / 2], [x1 - x0, 0.2, landing], '#b88a5e', 'upper'));
  parts.push(bx([x1 + 0.05, G + 0.5, (zTop + hd - T) / 2 + 0.3], [0.1, 1, hd - T - zTop - 0.6], pal.trim, 'upper'));
  const start = hd - T - 0.5;
  parts.push(...stairs(x0 + stairW / 2, start, 0, G, start - zTop, stairW, -1, '#9b6a43', 'base'));
  // Balcón delantero a la altura de la planta alta.
  const bw = 3.2, bd = 1.4;
  parts.push(bx([0, G - 0.1, hd - T + (bd + T) / 2], [bw, 0.2, bd + T], '#9b6a43', 'upper', { facing: FRONT }));
  rail(parts, 0, G, hd + bd - 0.05, bw, 0.1, pal.trim, 'upper', 1);
  for (const sx of [-1, 1]) rail(parts, sx * (bw / 2 - 0.05), G, hd + bd / 2, 0.1, bd, pal.trim, 'upper', 1);
  for (const sx of [-1, 1]) parts.push(bx([sx * (bw / 2 - 0.1), (G - 0.2) / 2, hd + bd - 0.1], [0.16, G - 0.2, 0.16], pal.trim, 'base', { facing: FRONT }));
  // Tejado a dos aguas sólido.
  const roofH = 1.6;
  for (const z of [hd - T, -hd]) parts.push({ kind: 'gable', y: top, z, halfWidth: hw, height: roofH, thickness: T, color: upper, layer: 'roof' });
  const slope = Math.atan2(roofH, hw), slab = Math.hypot(hw, roofH) + 0.35;
  for (const sx of [-1, 1]) parts.push(bx([(sx * hw) / 2 + sx * 0.04, top + roofH / 2 + 0.1, 0], [slab, 0.18, D + 0.5], pal.roof, 'roof', { rot: [0, 0, -sx * slope] }));
  // Muebles: abajo mesa y sillas; arriba cama y estantería.
  parts.push(...furniture('table', 0.5, 0, -1.3, 'base'));
  parts.push(...furniture('chair', 0.5, 0, -0.55, 'base'));
  parts.push(...furniture('shelf', hw - T - 0.25, 0, 1.1, 'base', true));
  parts.push(...furniture('bed', 0.2, G, -hd + T + 1.05, 'upper', false, '#d9e4c4'));
  parts.push(...furniture('shelf', hw - T - 0.25, G, 0.9, 'upper', true));
  return { id: 'small-balcony', parts, clearRadius: Math.hypot(hw, hd + bd) + 2,
    nav: { door: { x: door, z: hd + 1.2 }, inside: { x: door, z: hd - 1.0 }, climbs: [[{ x: x0 + 0.7, y: 0, z: start + 0.3 }, { x: x0 + 0.7, y: G, z: -hd + T + 0.5 }, { x: x1 + 0.6, y: G, z: -hd + T + 0.5 }]] },
    interior: { min: { x: -hw + T - 0.1, y: -0.5, z: -hd + T - 0.1 }, max: { x: hw - T + 0.1, y: top - 0.4, z: hd - T + 0.1 }, upperFloorY: G } };
}

/** Almacén/garaje: nave diáfana con portón ancho, coche, estanterías y cajas. Azotea plana. */
function createGarage(_pal: { wall: string; roof: string; trim: string }): PrefabDef {
  const { w: W, d: D, h: H } = EXTRA_SIZE.garage;
  const hw = W / 2, hd = D / 2, parts: PrefabPart[] = [];
  const wall = '#c9c4b8', metal = '#7d8790';
  floorSlab(parts, W, D, '#5a5a5a', '#9e9e9e');
  sideWalls(parts, W, D, 0, H, wall, 'base');
  frontWall(parts, W, D, 0, H, 0, 3.2, 2.8, wall, metal, 'base');
  // Portón enrollado (visual, arriba del hueco) y franjas.
  parts.push(bx([0, 2.95, hd + 0.05], [3.3, 0.3, 0.12], metal, 'base', { collide: false, facing: FRONT }));
  for (const z of [-2, 1]) { windowAt(parts, hw, 2.3, z, RIGHT, 'base', '#9ad1e6', 1.4); windowAt(parts, -hw, 2.3, z, LEFT, 'base', '#9ad1e6', 1.4); }
  // Cubierta plana sólida con un remate.
  parts.push(bx([0, H + 0.1, 0], [W + 0.3, 0.2, D + 0.3], metal, 'roof'));
  parts.push(bx([0, H + 0.3, 0], [W + 0.3, 0.2, 0.2], '#5f6870', 'roof'));
  // Dentro: coche a la derecha, estanterías al fondo, banco de trabajo y cajas a la izquierda.
  parts.push(...furniture('car', 1.9, 0, 0.2, 'base'));
  parts.push(...furniture('shelf', -0.4, 0, -hd + T + 0.25, 'base'));
  parts.push(...furniture('shelf', 1.3, 0, -hd + T + 0.25, 'base'));
  parts.push(...furniture('bench', -hw + T + 0.35, 0, 0.6, 'base', true));
  parts.push(...furniture('crate', -hw + T + 0.45, 0, 3.2, 'base'));
  parts.push(...furniture('crate', -hw + T + 0.45, 0.8, 3.2, 'base', false, '#b97a3e'));
  parts.push(...furniture('crate', 2.8, 0, -hd + T + 0.45, 'base'));
  return { id: 'small-garage', parts, clearRadius: Math.hypot(hw, hd) + 2,
    nav: { door: { x: -0.6, z: hd + 1.2 }, inside: { x: -0.6, z: hd - 1.2 }, climbs: [] },
    interior: { min: { x: -hw + T - 0.1, y: -0.5, z: -hd + T - 0.1 }, max: { x: hw - T + 0.1, y: H - 0.4, z: hd - T + 0.1 } } };
}

/**
 * Edificio abandonado: paredes rotas (huecos por los que se entra), media cubierta que se
 * mantiene y una losa caída que sirve de rampa hasta ella; escombros y ventanas tapiadas.
 */
function createRuin(): PrefabDef {
  const { w: W, d: D, h: H, door } = EXTRA_SIZE.ruin;
  const hw = W / 2, hd = D / 2, parts: PrefabPart[] = [];
  const wall = '#a8a29a', dark = '#7b756d', plank = '#7a5634';
  parts.push(bx([0, 0.03, 0], [W + 0.3, 0.06, D + 0.3], '#6f6a62', 'base', { collide: false }));
  // Fondo entero; izquierda con un gran boquete; derecha medio derrumbada.
  parts.push(bx([0, H / 2, -hd + T / 2], [W, H, T], wall, 'base', { facing: BACK }));
  parts.push(bx([-hw + T / 2, H / 2, -hd + 1.2], [T, H, 2.4], wall, 'base', { facing: LEFT }));
  parts.push(bx([-hw + T / 2, H / 2, hd - 0.9], [T, H, 1.8], wall, 'base', { facing: LEFT }));
  parts.push(bx([-hw + T / 2, H - 0.4, 0.3], [T, 0.8, 1.8], wall, 'base', { facing: LEFT }));
  parts.push(bx([hw - T / 2, H / 2, -hd + 1.6], [T, H, 3.2], wall, 'base', { facing: RIGHT }));
  parts.push(bx([hw - T / 2, 0.6, hd - 1.4], [T, 1.2, 2.8], dark, 'base', { facing: RIGHT }));
  frontWall(parts, W, D, 0, H, door, 1.3, 2.2, wall, plank, 'base');
  // Ventanas tapiadas con tablas.
  for (const y of [1.3, 1.6]) parts.push(bx([1.6, y, hd + 0.04], [1.1, 0.14, 0.05], plank, 'base', { collide: false, facing: FRONT, rot: [0, 0, y === 1.3 ? 0.15 : -0.12] }));
  parts.push(bx([0.4, 1.5, -hd - 0.04], [1.0, 0.8, 0.05], '#3b3b3b', 'base', { collide: false, facing: BACK }));
  // Media cubierta (mitad trasera), transitable, y losa caída que sube hasta ella desde dentro.
  const roofD = 2;
  parts.push(bx([0, H + 0.1, -hd + roofD / 2], [W + 0.2, 0.2, roofD + 0.1], dark, 'roof'));
  parts.push(bx([-1.2, H + 0.08, -hd + roofD + 0.2], [2.2, 0.16, 0.6], dark, 'roof', { rot: [0.25, 0, 0] }));
  // 39° (< PLAYER.maxSlopeDeg): el extremo alto toca el borde de la media cubierta.
  const slopeLen = 4.6, rise = H + 0.2, ang = Math.asin(rise / slopeLen);
  parts.push(bx([1.2, rise / 2 - 0.05, -hd + roofD + 0.05 + (Math.cos(ang) * slopeLen) / 2], [1.4, 0.2, slopeLen], dark, 'base', { rot: [ang, 0, 0] }));
  // Escombros (bajos: se suben con el autoescalón) y un mueble volcado.
  parts.push(...furniture('rubble', -1.6, 0, 1.6, 'base'));
  parts.push(...furniture('rubble', 2.2, 0, -2.2, 'base', true));
  parts.push(...furniture('table', 0, 0, -hd + T + 0.45, 'base', false, '#6b5a45'));
  return { id: 'small-ruin', parts, clearRadius: Math.hypot(hw, hd) + 2,
    nav: { door: { x: door, z: hd + 1.2 }, inside: { x: door, z: hd - 1.0 }, climbs: [[{ x: 1.2, y: 0, z: 2.3 }, { x: 1.2, y: rise, z: -1.6 }]] },
    interior: { min: { x: -hw + T - 0.1, y: -0.5, z: -hd + T - 0.1 }, max: { x: hw - T + 0.1, y: H - 0.4, z: hd - T + 0.1 } } };
}

export function createExtraDef(variant: ExtraVariant, pal: { wall: string; roof: string; trim: string }): PrefabDef {
  switch (variant) {
    case 'modern': return createModern(pal);
    case 'balcony': return createBalcony(pal);
    case 'garage': return createGarage(pal);
    case 'ruin': return createRuin();
  }
}

/** Cofres dentro de cada diseño nuevo (locales; `y` = altura del suelo). El primero es el principal. */
export function extraChestSpots(variant: ExtraVariant): { x: number; y: number; z: number; yaw: number }[] {
  const { w, d, h } = EXTRA_SIZE[variant];
  const bx0 = -w / 2 + T + 0.65, bz0 = -d / 2 + T + 0.5;
  switch (variant) {
    case 'modern': return [{ x: bx0, y: 0, z: bz0, yaw: 0 }, { x: -w / 2 + 1.2, y: h + 0.2, z: -d / 2 + 0.9, yaw: 0 }];
    case 'balcony': return [{ x: w / 2 - T - 0.65, y: 0, z: -d / 2 + T + 0.5, yaw: 0 }, { x: w / 2 - T - 0.65, y: h, z: -d / 2 + T + 0.5, yaw: 0 }];
    case 'garage': return [{ x: bx0, y: 0, z: bz0, yaw: 0 }, { x: -w / 2 + T + 0.65, y: 0, z: 2.1, yaw: Math.PI / 2 }];
    case 'ruin': return [{ x: bx0, y: 0, z: bz0, yaw: 0 }];
  }
}
