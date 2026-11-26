import type { Quat } from '../math';
import type { Vec3 } from '../types';
import type { TreePlacement, WorldLayout } from './layout';
import { placePart, type PlacedPrefab } from './prefab';

/**
 * Capas de colisión. Las construcciones y proyectiles (fases futuras) tendrán
 * su propia capa para filtrar consultas (p. ej. balas que atraviesan follaje).
 */
export type CollisionLayer = 'world' | 'structure' | 'build' | 'player';

/** Descripción de colisionadores estáticos, independiente del motor de física. */
export type StaticColliderSpec =
  | { kind: 'box'; center: Vec3; halfExtents: Vec3; rotation: Quat; layer: CollisionLayer; interactionTarget?: boolean }
  | { kind: 'cylinder'; center: Vec3; radius: number; halfHeight: number; layer: CollisionLayer; interactionTarget?: boolean };

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** Colisionadores de un prefab colocado (las mismas cajas que se dibujan). */
export function prefabColliders(p: PlacedPrefab, layer: CollisionLayer = 'structure'): StaticColliderSpec[] {
  const out: StaticColliderSpec[] = [];
  for (const part of p.def.parts) {
    if (part.kind !== 'box' || !part.collide) continue;
    const { center, rotation } = placePart(p, part);
    out.push({
      kind: 'box',
      center,
      halfExtents: { x: part.size.x / 2, y: part.size.y / 2, z: part.size.z / 2 },
      rotation,
      layer,
      interactionTarget: p.def.id === 'chest',
    });
  }
  return out;
}

export const treeCollider = (t: TreePlacement): StaticColliderSpec => ({
  kind: 'cylinder',
  center: { x: t.x, y: t.y + 1.2 * t.scale, z: t.z },
  radius: 0.3 * t.scale,
  halfHeight: 1.2 * t.scale,
  layer: 'world',
});

/** Muros invisibles en el borde del mapa para no caer fuera del heightfield. */
export function boundaryColliders(size: number, inset = 2): StaticColliderSpec[] {
  const half = size / 2 - inset;
  const e = 0.5;
  const wall = (x: number, z: number, ex: number, ez: number): StaticColliderSpec => ({
    kind: 'box',
    center: { x, y: 5, z },
    halfExtents: { x: ex, y: 10, z: ez },
    rotation: IDENTITY,
    layer: 'world',
  });
  return [wall(0, -half - e, half, e), wall(0, half + e, half, e), wall(-half - e, 0, e, half), wall(half + e, 0, e, half)];
}

export function worldColliders(layout: WorldLayout): StaticColliderSpec[] {
  return [
    ...layout.structures.flatMap((s) => prefabColliders(s)),
    ...layout.trees.map(treeCollider),
    ...boundaryColliders(layout.terrain.size),
  ];
}
