import { PLAYER } from './constants';
import { rotateTowards } from './math';
import type { PlayerInput, Vec2 } from './types';

/**
 * Proyección isométrica: la cámara mira desde (+1,+1,+1) hacia el origen.
 * "Arriba" en pantalla corresponde a la dirección (-1,0,-1) del mundo y
 * "derecha" en pantalla a (+1,0,-1).
 */
const INV_SQRT2 = Math.SQRT1_2;
export const ISO_SCREEN_UP: Readonly<Vec2> = { x: -INV_SQRT2, y: -INV_SQRT2 }; // (x, z)
export const ISO_SCREEN_RIGHT: Readonly<Vec2> = { x: INV_SQRT2, y: -INV_SQRT2 };

/**
 * Convierte un vector de pantalla (x→derecha, y→arriba) a dirección XZ del mundo.
 * La magnitud se limita a 1 (el joystick analógico conserva su intensidad).
 */
export function screenToWorld(screenX: number, screenY: number): Vec2 {
  let x = ISO_SCREEN_RIGHT.x * screenX + ISO_SCREEN_UP.x * screenY;
  let z = ISO_SCREEN_RIGHT.y * screenX + ISO_SCREEN_UP.y * screenY;
  const len = Math.hypot(x, z);
  if (len > 1) {
    x /= len;
    z /= len;
  }
  return { x, y: z };
}

/** Velocidad horizontal deseada (m/s) para una entrada. Pura y determinista. */
export function desiredHorizontalVelocity(input: PlayerInput): Vec2 {
  const len = Math.hypot(input.moveX, input.moveZ);
  if (len < 1e-4) return { x: 0, y: 0 };
  const mag = Math.min(len, 1);
  const speed = input.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
  return { x: (input.moveX / len) * mag * speed, y: (input.moveZ / len) * mag * speed };
}

/** Yaw (rotación en Y) que mira hacia la dirección XZ dada; convención de Three.js (+Z adelante). */
export const yawFromDirection = (x: number, z: number): number => Math.atan2(x, z);

/** Nuevo yaw tras girar hacia la dirección de movimiento durante `dt`. */
export function stepYaw(currentYaw: number, moveX: number, moveZ: number, dt: number): number {
  if (Math.hypot(moveX, moveZ) < 1e-4) return currentYaw;
  return rotateTowards(currentYaw, yawFromDirection(moveX, moveZ), PLAYER.turnSpeed * dt);
}
