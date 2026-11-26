import type { Vec3 } from '../types';
import type { BoxPart, PartLayer, PrefabDef, PrefabPart } from './prefab';

/** Ayudante para declarar cajas de forma compacta. */
function bx(
  center: [number, number, number],
  size: [number, number, number],
  color: string,
  layer: PartLayer,
  opts: Partial<Pick<BoxPart, 'collide' | 'visible' | 'facing'>> & { rot?: [number, number, number] } = {},
): BoxPart {
  const v = (a: [number, number, number]): Vec3 => ({ x: a[0], y: a[1], z: a[2] });
  const part: BoxPart = {
    kind: 'box',
    center: v(center),
    size: v(size),
    color,
    layer,
    collide: opts.collide ?? true,
    visible: opts.visible ?? true,
  };
  if (opts.rot) part.rot = v(opts.rot);
  if (opts.facing) part.facing = opts.facing;
  return part;
}

/**
 * Escalera recta: peldaños visuales sólidos (también colisionan, y el
 * autostep los sube) más una rampa invisible encima que hace la subida suave.
 * Sube desde `start` en la dirección -Z local (o +Z si dir = 1).
 */
export function stairs(
  x: number,
  startZ: number,
  baseY: number,
  rise: number,
  run: number,
  width: number,
  dir: 1 | -1,
  color: string,
  layer: PartLayer,
): PrefabPart[] {
  const steps = Math.max(2, Math.round(rise / 0.25));
  const stepRise = rise / steps;
  const stepRun = run / steps;
  const parts: PrefabPart[] = [];
  for (let i = 0; i < steps; i++) {
    const top = baseY + stepRise * (i + 1);
    const zCenter = startZ + dir * stepRun * (i + 0.5);
    parts.push(bx([x, baseY + (top - baseY) / 2, zCenter], [width, top - baseY, stepRun], color, layer));
  }
  // Rampa: su cara superior une el borde de cada peldaño.
  const angle = Math.atan2(rise, run);
  const len = Math.hypot(rise, run) + 0.3;
  const thick = 0.2;
  // La rampa sobresale 0,3 m solo por abajo (bajo el suelo), nunca por arriba.
  const ext = 0.15;
  const midZ = startZ + (dir * run) / 2 - dir * Math.cos(angle) * ext;
  const midY = baseY + rise / 2 - Math.sin(angle) * ext;
  // Normal de la cara superior de la rampa (en y, z).
  const ny = Math.cos(angle);
  const nz = -dir * Math.sin(angle);
  parts.push(
    bx([x, midY - (ny * thick) / 2, midZ - (nz * thick) / 2], [width, thick, len], color, layer, {
      visible: false,
      rot: [-dir * angle, 0, 0],
    }),
  );
  return parts;
}

const HOUSE_COLORS = {
  wall: '#f4e3c3',
  wallUpper: '#efd9b0',
  trim: '#8a5a3b',
  roof: '#d9534f',
  roofDark: '#b23a37',
  floor: '#b88a5e',
  window: '#5bc0eb',
  stairs: '#9b6a43',
  chimney: '#9c9c9c',
};

export const HOUSE = {
  width: 10,
  depth: 9,
  wallThickness: 0.3,
  groundHeight: 2.8,
  upperHeight: 2.6,
  doorWidth: 1.6,
  doorHeight: 2.3,
  /** Fondo de la planta alta (entreplanta en la mitad trasera). */
  loftDepth: 4,
  roofHeight: 2,
} as const;

/**
 * Casa de dos plantas: planta baja completa, entreplanta trasera con
 * barandilla, escalera interior junto a la pared izquierda y puerta en +Z.
 */
export function createHouseDef(): PrefabDef {
  const C = HOUSE_COLORS;
  const { width: W, depth: D, wallThickness: t, groundHeight: G, upperHeight: U, doorWidth, doorHeight, loftDepth, roofHeight } = HOUSE;
  const hw = W / 2;
  const hd = D / 2;
  const top = G + U;
  const parts: PrefabPart[] = [];
  const FRONT = { x: 0, y: 1 };
  const BACK = { x: 0, y: -1 };
  const LEFT = { x: -1, y: 0 };
  const RIGHT = { x: 1, y: 0 };

  // Suelo (solo visual: el terreno ya es plano aquí)
  parts.push(bx([0, 0.03, 0], [W + 0.4, 0.06, D + 0.4], C.trim, 'base', { collide: false }));
  parts.push(bx([0, 0.07, 0], [W - 2 * t, 0.04, D - 2 * t], C.floor, 'base', { collide: false }));

  // Paredes por planta: [capa, y0, alto, color]
  const floors: [PartLayer, number, number, string][] = [
    ['base', 0, G, C.wall],
    ['upper', G, U, C.wallUpper],
  ];
  for (const [layer, y0, h, color] of floors) {
    const cy = y0 + h / 2;
    parts.push(bx([0, cy, -hd + t / 2], [W, h, t], color, layer, { facing: BACK }));
    parts.push(bx([-hw + t / 2, cy, 0], [t, h, D], color, layer, { facing: LEFT }));
    parts.push(bx([hw - t / 2, cy, 0], [t, h, D], color, layer, { facing: RIGHT }));
    if (layer === 'base') {
      const seg = hw - doorWidth / 2;
      parts.push(bx([-doorWidth / 2 - seg / 2, cy, hd - t / 2], [seg, h, t], color, layer, { facing: FRONT }));
      parts.push(bx([doorWidth / 2 + seg / 2, cy, hd - t / 2], [seg, h, t], color, layer, { facing: FRONT }));
      parts.push(bx([0, doorHeight + (G - doorHeight) / 2, hd - t / 2], [doorWidth, G - doorHeight, t], color, layer, { facing: FRONT }));
      // Marco de la puerta
      parts.push(bx([-doorWidth / 2, doorHeight / 2, hd - t / 2], [0.12, doorHeight, t + 0.08], C.trim, layer, { collide: false, facing: FRONT }));
      parts.push(bx([doorWidth / 2, doorHeight / 2, hd - t / 2], [0.12, doorHeight, t + 0.08], C.trim, layer, { collide: false, facing: FRONT }));
      parts.push(bx([0, doorHeight, hd - t / 2], [doorWidth + 0.12, 0.12, t + 0.08], C.trim, layer, { collide: false, facing: FRONT }));
    } else {
      parts.push(bx([0, cy, hd - t / 2], [W, h, t], color, layer, { facing: FRONT }));
    }
    // Ventanas (relieve exterior, no colisionan)
    const wy = y0 + h * 0.58;
    const win = (x: number, z: number, horizontal: boolean, facing: { x: number; y: number }) => {
      const size: [number, number, number] = horizontal ? [1.1, 0.9, 0.06] : [0.06, 0.9, 1.1];
      parts.push(bx([x, wy, z], size, C.window, layer, { collide: false, facing }));
      const sill: [number, number, number] = horizontal ? [1.3, 0.12, 0.12] : [0.12, 0.12, 1.3];
      parts.push(bx([x, wy - 0.51, z], sill, C.trim, layer, { collide: false, facing }));
    };
    win(-hw + 2, hd + 0.02, true, FRONT);
    win(hw - 2, hd + 0.02, true, FRONT);
    win(-2.2, -hd - 0.02, true, BACK);
    win(2.2, -hd - 0.02, true, BACK);
    win(hw + 0.02, -1.5, false, RIGHT);
    win(hw + 0.02, 1.8, false, RIGHT);
    win(-hw - 0.02, 1.8, false, LEFT);
  }

  // Esquinas de madera (las dos plantas)
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      parts.push(
        bx([sx * (hw - 0.05), G / 2, sz * (hd - 0.05)], [0.24, G, 0.24], C.trim, 'base', { collide: false, facing: { x: sx, y: sz } }),
        bx([sx * (hw - 0.05), G + U / 2, sz * (hd - 0.05)], [0.24, U, 0.24], C.trim, 'upper', { collide: false, facing: { x: sx, y: sz } }),
      );

  // Entreplanta (mitad trasera) y barandilla con hueco para la escalera
  const innerW = W - 2 * t;
  const stairW = 1.2;
  const stairX = -hw + t + stairW / 2;
  const loftZ0 = -hd + t;
  const loftZ1 = -hd + loftDepth;
  parts.push(bx([0, G - 0.1, (loftZ0 + loftZ1) / 2], [innerW, 0.2, loftZ1 - loftZ0], C.floor, 'upper'));
  const railX0 = -hw + t + stairW;
  const railLen = hw - t - railX0;
  parts.push(bx([railX0 + railLen / 2, G + 0.5, loftZ1 - 0.05], [railLen, 1, 0.1], C.trim, 'upper', { facing: FRONT }));

  // Escalera interior: sube desde cerca de la puerta (+Z) hacia la entreplanta (-Z)
  // Rellano de 1 m entre la fachada y el primer peldaño.
  const stairStartZ = hd - t - 1;
  const run = stairStartZ - loftZ1;
  parts.push(...stairs(stairX, stairStartZ, 0, G, run, stairW, -1, C.stairs, 'base'));

  // Tejado a dos aguas (cumbrera en Z)
  for (const z of [hd - t, -hd]) {
    parts.push({ kind: 'gable', y: top, z, halfWidth: hw, height: roofHeight, thickness: t, color: C.wallUpper, layer: 'roof' });
  }
  const slope = Math.atan2(roofHeight, hw);
  const slab = Math.hypot(hw, roofHeight) + 0.5;
  for (const sx of [-1, 1]) {
    parts.push(
      bx([(sx * hw) / 2 + sx * 0.05, top + roofHeight / 2 + 0.12, 0], [slab, 0.22, D + 0.8], sx < 0 ? C.roof : C.roofDark, 'roof', {
        collide: false,
        rot: [0, 0, -sx * slope],
      }),
    );
  }
  parts.push(bx([0, top + roofHeight + 0.12, 0], [0.3, 0.3, D + 0.9], C.trim, 'roof', { collide: false }));
  parts.push(bx([hw * 0.45, top + roofHeight * 0.8, -hd * 0.4], [0.6, 1.4, 0.6], C.chimney, 'roof', { collide: false }));

  return {
    id: 'house',
    parts,
    clearRadius: 9,
    interior: {
      min: { x: -hw + t - 0.1, y: -0.5, z: -hd + t - 0.1 },
      max: { x: hw - t + 0.1, y: top, z: hd - t + 0.1 },
      upperFloorY: G,
    },
  };
}

export const TOWER = { size: 3.2, height: 2.6, stairRun: 3.6, stairWidth: 1.1 } as const;

/** Mirador: plataforma elevada sobre pilares con barandilla y escalera exterior. */
export function createTowerDef(): PrefabDef {
  const { size: S, height: H, stairRun, stairWidth } = TOWER;
  const h = S / 2;
  const wood = '#a8743f';
  const dark = '#6e4524';
  const parts: PrefabPart[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(bx([sx * (h - 0.15), H / 2, sz * (h - 0.15)], [0.3, H, 0.3], dark, 'base'));
  parts.push(bx([0, H - 0.1, 0], [S, 0.2, S], wood, 'base'));
  // Barandillas (la cara +Z queda abierta para la escalera, en su lado izquierdo)
  const railH = 1;
  parts.push(bx([0, H + railH / 2, -h + 0.05], [S, railH, 0.1], dark, 'base'));
  parts.push(bx([-h + 0.05, H + railH / 2, 0], [0.1, railH, S], dark, 'base'));
  parts.push(bx([h - 0.05, H + railH / 2, 0], [0.1, railH, S], dark, 'base'));
  const gap = stairWidth;
  parts.push(bx([gap / 2, H + railH / 2, h - 0.05], [S - gap, railH, 0.1], dark, 'base'));
  // Escalera hacia +Z desde el borde de la plataforma, bajando
  const sx = -h + gap / 2;
  parts.push(...stairs(sx, h + stairRun, 0, H, stairRun, stairWidth, -1, wood, 'base'));
  // Bandera para reconocerlo de lejos (sin colisión)
  parts.push(bx([h - 0.15, H + 1.8, -h + 0.15], [0.08, 2.4, 0.08], dark, 'base', { collide: false }));
  parts.push(bx([h - 0.15 + 0.5, H + 2.7, -h + 0.15], [0.9, 0.55, 0.04], '#ff5a5f', 'base', { collide: false }));
  return { id: 'tower', parts, clearRadius: 6 };
}

/** Pila de cajas: superficies elevadas a las que se sube saltando. */
export function createCratesDef(): PrefabDef {
  const c = '#c98b4a';
  const d = '#9a6533';
  return {
    id: 'crates',
    clearRadius: 3,
    parts: [
      bx([0, 0.45, 0], [0.9, 0.9, 0.9], c, 'base'),
      bx([0.95, 0.45, 0.1], [0.9, 0.9, 0.9], d, 'base', { rot: [0, 0.2, 0] }),
      bx([0.45, 1.35, 0.05], [0.9, 0.9, 0.9], c, 'base', { rot: [0, -0.15, 0] }),
      bx([-0.1, 0.3, 1.0], [0.6, 0.6, 0.6], d, 'base'),
    ],
  };
}
