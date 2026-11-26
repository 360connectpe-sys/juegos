import { PLAYER, SIMULATION } from './constants';
import { rotateTowards } from './math';
import { Buttons, hasButton, type Locomotion, type PlayerInput, type Vec2 } from './types';

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

/**
 * Modificadores externos del movimiento. Hoy siempre neutros; los usarán
 * combate (apuntar ralentiza), construcción, daño, vehículos, etc.
 */
export interface MotorModifiers {
  speedMultiplier: number;
  canSprint: boolean;
  canJump: boolean;
  /** Si es false el personaje no gira solo hacia donde camina (p. ej. al apuntar). */
  faceMovement: boolean;
}

export const DEFAULT_MODIFIERS: Readonly<MotorModifiers> = {
  speedMultiplier: 1,
  canSprint: true,
  canJump: true,
  faceMovement: true,
};

/**
 * Estado interno del motor: TODO lo necesario para reproducir la simulación.
 * Es serializable, así se puede guardar/restaurar para predicción y
 * reconciliación en red.
 */
export interface MotorState {
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  grounded: boolean;
  /** Tiempo restante de "coyote time". */
  coyote: number;
  /** Tiempo restante del salto en búfer. */
  jumpBuffer: number;
  /** El botón de salto estaba pulsado el tick anterior (detección de flanco). */
  jumpHeld: boolean;
}

export const initialMotorState = (yaw = 0): MotorState => ({
  vx: 0,
  vy: 0,
  vz: 0,
  yaw,
  grounded: false,
  coyote: 0,
  jumpBuffer: 0,
  jumpHeld: false,
});

/** Velocidad horizontal objetivo (m/s) para una entrada. Pura y determinista. */
export function desiredHorizontalVelocity(input: PlayerInput, mods: MotorModifiers = DEFAULT_MODIFIERS): Vec2 {
  const len = Math.hypot(input.moveX, input.moveZ);
  if (len < 1e-4) return { x: 0, y: 0 };
  const mag = Math.min(len, 1);
  const sprint = mods.canSprint && hasButton(input.buttons, Buttons.SPRINT);
  const speed = (sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed) * mods.speedMultiplier;
  return { x: (input.moveX / len) * mag * speed, y: (input.moveZ / len) * mag * speed };
}

/** Acerca `v` a `target` como máximo `maxDelta` (en 2D, conservando dirección). */
function approach2(vx: number, vz: number, tx: number, tz: number, maxDelta: number): Vec2 {
  const dx = tx - vx;
  const dz = tz - vz;
  const d = Math.hypot(dx, dz);
  if (d <= maxDelta || d < 1e-9) return { x: tx, y: tz };
  return { x: vx + (dx / d) * maxDelta, y: vz + (dz / d) * maxDelta };
}

/** Yaw (rotación en Y) que mira hacia la dirección XZ dada; convención de Three.js (+Z adelante). */
export const yawFromDirection = (x: number, z: number): number => Math.atan2(x, z);

/** Nuevo yaw tras girar hacia la dirección dada durante `dt`. */
export function stepYaw(currentYaw: number, moveX: number, moveZ: number, dt: number): number {
  if (Math.hypot(moveX, moveZ) < 1e-4) return currentYaw;
  return rotateTowards(currentYaw, yawFromDirection(moveX, moveZ), PLAYER.turnSpeed * dt);
}

/**
 * Paso del motor ANTES de resolver colisiones: calcula velocidad deseada,
 * salto (con coyote time y búfer), gravedad y giro. Muta y devuelve `s`.
 * La física (Rapier) luego mueve la cápsula con `v * dt` y llama a
 * `applyCollisionResult` con lo que realmente ocurrió.
 */
export function motorIntent(
  s: MotorState,
  input: PlayerInput,
  dt: number,
  mods: MotorModifiers = DEFAULT_MODIFIERS,
): { jumped: boolean } {
  // Horizontal con aceleración (control total en suelo, reducido en el aire).
  const target = desiredHorizontalVelocity(input, mods);
  const moving = target.x !== 0 || target.y !== 0;
  const accel = s.grounded ? (moving ? PLAYER.groundAccel : PLAYER.groundDecel) : PLAYER.airAccel;
  const h = approach2(s.vx, s.vz, target.x, target.y, accel * dt);
  s.vx = h.x;
  s.vz = h.y;

  // Salto: flanco de pulsación → búfer; se consume si hay suelo o coyote time.
  const jumpDown = hasButton(input.buttons, Buttons.JUMP);
  if (jumpDown && !s.jumpHeld) s.jumpBuffer = PLAYER.jumpBuffer;
  s.jumpHeld = jumpDown;
  s.coyote = s.grounded ? PLAYER.coyoteTime : Math.max(0, s.coyote - dt);
  let jumped = false;
  if (mods.canJump && s.jumpBuffer > 0 && s.coyote > 0) {
    s.vy = PLAYER.jumpVelocity;
    s.jumpBuffer = 0;
    s.coyote = 0;
    s.grounded = false;
    jumped = true;
  } else {
    s.jumpBuffer = Math.max(0, s.jumpBuffer - dt);
  }

  // Gravedad (más fuerte al caer) con velocidad terminal.
  const g = SIMULATION.gravity * (s.vy < 0 ? PLAYER.fallGravityMultiplier : 1);
  s.vy = Math.max(PLAYER.terminalVelocity, s.vy + g * dt);
  // En el suelo mantenemos una pequeña velocidad hacia abajo para seguir pendientes.
  if (s.grounded && s.vy < 0) s.vy = -2;

  // Giro suave: hacia donde apunta (AIM) o hacia donde camina.
  if (hasButton(input.buttons, Buttons.AIM)) {
    s.yaw = rotateTowards(s.yaw, input.aimYaw, PLAYER.turnSpeed * 1.5 * dt);
  } else if (mods.faceMovement && moving) {
    s.yaw = stepYaw(s.yaw, target.x, target.y, dt);
  }
  return { jumped };
}

/**
 * Ajusta el estado con el desplazamiento REAL tras las colisiones.
 * `desired` y `actual` son desplazamientos del tick (m).
 */
export function applyCollisionResult(
  s: MotorState,
  desired: { x: number; y: number; z: number },
  actual: { x: number; y: number; z: number },
  grounded: boolean,
  dt: number,
): void {
  const wasGrounded = s.grounded;
  s.grounded = grounded;
  if (grounded && s.vy < 0) s.vy = 0;
  // Techo: la subida se ha cortado.
  if (desired.y > 0 && actual.y < desired.y * 0.5) s.vy = Math.min(s.vy, 0);
  // Pared: conserva solo la componente horizontal que realmente se movió.
  if (Math.abs(desired.x) > 1e-6 && Math.abs(actual.x) < Math.abs(desired.x) * 0.5) s.vx = actual.x / dt;
  if (Math.abs(desired.z) > 1e-6 && Math.abs(actual.z) < Math.abs(desired.z) * 0.5) s.vz = actual.z / dt;
  if (!wasGrounded && grounded) s.coyote = PLAYER.coyoteTime;
}

/** Estado de animación/locomoción derivado (lo pueden calcular también los clientes remotos). */
export function deriveLocomotion(grounded: boolean, vx: number, vy: number, vz: number): Locomotion {
  if (!grounded) return vy > 0.5 ? 'jump' : 'fall';
  const speed = Math.hypot(vx, vz);
  if (speed < 0.3) return 'idle';
  return speed >= PLAYER.runThreshold ? 'run' : 'walk';
}
