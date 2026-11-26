/**
 * Matemática pura de cámaras (sin Three.js): perspectivas, ejes de movimiento
 * relativos a la cámara, límites de inclinación y colisión de cámara.
 *
 * Convención de yaw = la del personaje (`yawFromDirection`): yaw 0 mira a +Z,
 * yaw π/2 mira a +X. Así el yaw de la cámara sirve tal cual como `aimYaw`.
 */
import { CAMERA_RIG } from '@shared/constants';
import { clamp, wrapAngle } from '@shared/math';
import { screenToWorld } from '@shared/movement';
import type { Vec2, Vec3 } from '@shared/types';

export type CameraMode = 'isometric' | 'third' | 'first';
export const CAMERA_MODES: readonly CameraMode[] = ['isometric', 'third', 'first'];
export const CAMERA_MODE_LABEL: Record<CameraMode, string> = {
  isometric: 'Isométrica',
  third: 'Tercera persona',
  first: 'Primera persona',
};

export const isCameraMode = (v: unknown): v is CameraMode => v === 'isometric' || v === 'third' || v === 'first';

/** Dirección "adelante" en XZ para un yaw. */
export const forwardFromYaw = (yaw: number): Vec2 => ({ x: Math.sin(yaw), y: Math.cos(yaw) });

/**
 * Convierte el vector de mando en pantalla (x derecha, y adelante) a una
 * dirección XZ del mundo según la perspectiva. Magnitud conservada (≤ 1).
 * Isométrica: ejes fijos de pantalla. 3ª/1ª persona: relativo al yaw de la cámara.
 */
export function moveToWorld(sx: number, sy: number, mode: CameraMode, cameraYaw: number): Vec2 {
  if (mode === 'isometric') return screenToWorld(sx, sy);
  const f = forwardFromYaw(cameraYaw);
  // Derecha = adelante girado -90° alrededor de Y (mirando a +Z, la derecha es -X).
  const r = { x: -f.y, y: f.x };
  let x = r.x * sx + f.x * sy;
  let z = r.y * sx + f.y * sy;
  const len = Math.hypot(x, z);
  if (len > 1) {
    x /= len;
    z /= len;
  }
  return { x, y: z };
}

export interface LookState {
  yaw: number;
  pitch: number;
}

/** Límites de inclinación (rad) por perspectiva. Positivo = mirar hacia abajo. */
export function pitchLimits(mode: CameraMode): { min: number; max: number } {
  return mode === 'first' ? CAMERA_RIG.firstPitch : CAMERA_RIG.thirdPitch;
}

/** Aplica un giro de mirada (rad) respetando límites. Muta y devuelve `s`. */
export function applyLook(s: LookState, dYaw: number, dPitch: number, mode: CameraMode): LookState {
  if (!Number.isFinite(dYaw) || !Number.isFinite(dPitch)) return s;
  const lim = pitchLimits(mode);
  s.yaw = wrapAngle(s.yaw + dYaw);
  s.pitch = clamp(s.pitch + dPitch, lim.min, lim.max);
  return s;
}

/** Punto de pivote (cabeza/hombro) a partir de los pies del jugador. */
export function pivotPoint(feet: Vec3, mode: CameraMode): Vec3 {
  const h = mode === 'first' ? CAMERA_RIG.eyeHeight : CAMERA_RIG.shoulderHeight;
  return { x: feet.x, y: feet.y + h, z: feet.z };
}

/**
 * Dirección unitaria desde el pivote hacia la cámara de 3ª persona: detrás
 * del personaje (opuesta a donde mira) y elevada según la inclinación.
 */
export function thirdPersonDirection(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}

/**
 * Colisión de cámara: distancia final a la que colocar la cámara.
 * `hitDistance` es la distancia al primer obstáculo en la dirección de la
 * cámara (null si no hay). Se separa `radius` del obstáculo y nunca se acerca
 * más de `minDistance` (la cámara entra "en el hombro" en vez de atravesar).
 */
export function resolveCameraDistance(desired: number, hitDistance: number | null, radius: number, minDistance: number): number {
  if (hitDistance === null || !Number.isFinite(hitDistance) || hitDistance >= desired + radius) return desired;
  return clamp(hitDistance - radius, minDistance, desired);
}

/** Suavizado asimétrico: la cámara se acerca al instante (no atraviesa) y se aleja suave. */
export function smoothCameraDistance(current: number, target: number, dt: number, outSpeed = 6): number {
  if (target <= current) return target;
  return current + (target - current) * (1 - Math.exp(-outSpeed * dt));
}

/** ¿Debe ocultarse el avatar propio? (1ª persona, o cámara pegada al personaje). */
export function hideOwnAvatar(mode: CameraMode, cameraDistance: number): boolean {
  if (mode === 'first') return true;
  if (mode === 'third') return cameraDistance < CAMERA_RIG.hideAvatarBelow;
  return false;
}

/** Yaw de apuntado en modo isométrico a partir de un vector de pantalla (stick/arrastre/ratón). */
export function isoAimYaw(sx: number, sy: number): number | null {
  if (Math.hypot(sx, sy) < 0.2) return null;
  const w = screenToWorld(sx, sy);
  return Math.atan2(w.x, w.y);
}
