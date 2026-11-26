import type { Vec3 } from '../types';
import type { HousePlacement, TreePlacement, WorldLayout } from './layout';

/** Descripción de colisionadores estáticos, independiente del motor de física. */
export type StaticColliderSpec =
  | { kind: 'box'; center: Vec3; halfExtents: Vec3; rotationY: number }
  | { kind: 'cylinder'; center: Vec3; radius: number; halfHeight: number };

export const HOUSE_STYLE = {
  wallThickness: 0.3,
  doorWidth: 1.6,
  doorHeight: 2.2,
  floorHeight: 0.15,
} as const;

/** Rota un punto local (x, z) de la casa al mundo. */
function toWorld(h: HousePlacement, lx: number, ly: number, lz: number): Vec3 {
  const c = Math.cos(h.rotation);
  const s = Math.sin(h.rotation);
  return { x: h.x + lx * c + lz * s, y: ly, z: h.z - lx * s + lz * c };
}

/** Paredes de la casa con hueco de puerta en la fachada (+Z local). */
export function houseColliders(h: HousePlacement, baseY = 0): StaticColliderSpec[] {
  const t = HOUSE_STYLE.wallThickness;
  const hw = h.width / 2;
  const hd = h.depth / 2;
  const hh = h.wallHeight / 2;
  const y = baseY + hh;
  const box = (lx: number, lz: number, ex: number, ez: number): StaticColliderSpec => ({
    kind: 'box',
    center: toWorld(h, lx, y, lz),
    halfExtents: { x: ex, y: hh, z: ez },
    rotationY: h.rotation,
  });
  const doorHalf = HOUSE_STYLE.doorWidth / 2;
  const sideLen = (hw - doorHalf) / 2; // media longitud de cada tramo de fachada
  return [
    box(0, -hd + t / 2, hw, t / 2), // trasera
    box(-hw + t / 2, 0, t / 2, hd), // izquierda
    box(hw - t / 2, 0, t / 2, hd), // derecha
    box(-doorHalf - sideLen, hd - t / 2, sideLen, t / 2), // fachada izq.
    box(doorHalf + sideLen, hd - t / 2, sideLen, t / 2), // fachada der.
  ];
}

export const treeCollider = (t: TreePlacement): StaticColliderSpec => ({
  kind: 'cylinder',
  center: { x: t.x, y: t.y + 1.2 * t.scale, z: t.z },
  radius: 0.3 * t.scale,
  halfHeight: 1.2 * t.scale,
});

/** Muros invisibles en el borde del mapa para no caer fuera del heightfield. */
export function boundaryColliders(size: number, inset = 2): StaticColliderSpec[] {
  const half = size / 2 - inset;
  const e = 0.5;
  const wall = (x: number, z: number, ex: number, ez: number): StaticColliderSpec => ({
    kind: 'box',
    center: { x, y: 5, z },
    halfExtents: { x: ex, y: 10, z: ez },
    rotationY: 0,
  });
  return [wall(0, -half - e, half, e), wall(0, half + e, half, e), wall(-half - e, 0, e, half), wall(half + e, 0, e, half)];
}

export function worldColliders(layout: WorldLayout): StaticColliderSpec[] {
  return [
    ...houseColliders(layout.house),
    ...layout.trees.map(treeCollider),
    ...boundaryColliders(layout.terrain.size),
  ];
}
