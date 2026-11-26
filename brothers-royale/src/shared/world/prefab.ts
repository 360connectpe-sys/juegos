import { quatFromEuler, quatMultiply, rotateXZ, type Quat } from '../math';
import type { Vec2, Vec3 } from '../types';

/**
 * Prefab: estructura descrita con datos puros. De la MISMA descripción salen
 * la malla visual (cliente) y los colisionadores (cliente y servidor).
 * Las construcciones de los jugadores (fase futura) usarán este mismo formato.
 *
 * Capas visuales (para ocultar al entrar):
 *  - base:  planta baja, siempre visible.
 *  - upper: planta alta; se oculta si el jugador está dentro y abajo.
 *  - roof:  techo; se oculta si el jugador está dentro.
 * `cut`: paredes orientadas a la cámara; se vuelven translúcidas desde dentro.
 */
export type PartLayer = 'base' | 'upper' | 'roof';

export interface BoxPart {
  kind: 'box';
  /** Centro en coordenadas locales del prefab. */
  center: Vec3;
  size: Vec3;
  /** Rotación local en Euler XYZ (rad). */
  rot?: Vec3;
  color: string;
  layer: PartLayer;
  collide: boolean;
  /** false = solo colisión (rampas invisibles bajo escaleras). */
  visible: boolean;
  /** Normal exterior en XZ para paredes (decide si es "cut" según la cámara). */
  facing?: Vec2;
}

/** Hastial triangular (solo visual). Base en y, de -halfWidth a +halfWidth en X, grosor en Z. */
export interface GablePart {
  kind: 'gable';
  y: number;
  z: number;
  halfWidth: number;
  height: number;
  thickness: number;
  color: string;
  layer: PartLayer;
}

export type PrefabPart = BoxPart | GablePart;

/** Volumen interior (local) usado para saber si el jugador está "dentro". */
export interface InteriorZone {
  min: Vec3;
  max: Vec3;
  /** Altura a partir de la cual el jugador está en la planta alta. */
  upperFloorY?: number;
}

export interface PrefabDef {
  id: string;
  parts: PrefabPart[];
  interior?: InteriorZone;
  /** Radio que debe quedar libre de árboles alrededor. */
  clearRadius: number;
}

export interface PlacedPrefab {
  def: PrefabDef;
  x: number;
  y: number;
  z: number;
  rotationY: number;
}

export interface Placement {
  center: Vec3;
  rotation: Quat;
}

/** Transforma una pieza local a mundo (posición + cuaternión). */
export function placePart(p: PlacedPrefab, part: BoxPart): Placement {
  const r = rotateXZ(part.center.x, part.center.z, p.rotationY);
  const local = part.rot ? quatFromEuler(part.rot.x, part.rot.y, part.rot.z) : { x: 0, y: 0, z: 0, w: 1 };
  const yaw = quatFromEuler(0, p.rotationY, 0);
  return {
    center: { x: p.x + r.x, y: p.y + part.center.y, z: p.z + r.z },
    rotation: quatMultiply(yaw, local),
  };
}

/** Pasa un punto del mundo a coordenadas locales del prefab. */
export function worldToLocal(p: PlacedPrefab, x: number, y: number, z: number): Vec3 {
  const r = rotateXZ(x - p.x, z - p.z, -p.rotationY);
  return { x: r.x, y: y - p.y, z: r.z };
}

export type InsideState = 'outside' | 'lower' | 'upper';

/** ¿Está el punto (pies del jugador) dentro del interior? ¿En qué planta? */
export function insideState(p: PlacedPrefab, x: number, y: number, z: number): InsideState {
  const zone = p.def.interior;
  if (!zone) return 'outside';
  const l = worldToLocal(p, x, y, z);
  const inside =
    l.x >= zone.min.x && l.x <= zone.max.x && l.y >= zone.min.y && l.y <= zone.max.y && l.z >= zone.min.z && l.z <= zone.max.z;
  if (!inside) return 'outside';
  return zone.upperFloorY !== undefined && l.y >= zone.upperFloorY - 0.4 ? 'upper' : 'lower';
}

/**
 * ¿La pared mira hacia la cámara? La cámara isométrica está en (+1,+1,+1),
 * así que mira a la cámara toda pared cuya normal exterior apunte a +X/+Z.
 */
export function facesCamera(p: PlacedPrefab, facing: Vec2 | undefined, cam: Vec2 = { x: 1, y: 1 }): boolean {
  if (!facing) return false;
  const n = rotateXZ(facing.x, facing.y, p.rotationY);
  return n.x * cam.x + n.z * cam.y > 0.1;
}
