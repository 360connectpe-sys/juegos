/** Tipos de datos serializables: viajan por red tal cual (sin clases ni Three.js). */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type PlayerId = string;

/**
 * Botones como máscara de bits: compacto para red y extensible.
 * Fase 6: FIRE ataca o usa (botiquín), AIM apunta, RELOAD recarga e INTERACT
 * abre/recoge. CROUCH y BUILD siguen reservados.
 */
export const Buttons = {
  JUMP: 1 << 0,
  SPRINT: 1 << 1,
  CROUCH: 1 << 2,
  FIRE: 1 << 3,
  AIM: 1 << 4,
  BUILD: 1 << 5,
  INTERACT: 1 << 6,
  RELOAD: 1 << 7,
} as const;
export type ButtonName = keyof typeof Buttons;

export const hasButton = (buttons: number, b: number): boolean => (buttons & b) !== 0;

/**
 * Entrada de un tick, ya en ejes del MUNDO (no de pantalla).
 * Es exactamente lo que el cliente enviará al servidor.
 */
export interface PlayerInput {
  /** Número de secuencia para reconciliación del lado del cliente. */
  seq: number;
  /** Dirección de movimiento en el plano XZ del mundo, magnitud 0..1 (360° analógico). */
  moveX: number;
  moveZ: number;
  /** Máscara de `Buttons`. */
  buttons: number;
  /** Orientación de apuntado (rad, eje Y). Se usa cuando AIM está activo. */
  aimYaw: number;
  /**
   * Inclinación del apuntado (rad, + arriba). Junto con aimYaw da la dirección
   * del disparo desde los ojos. Opcional: sin ella se dispara en horizontal.
   */
  aimPitch?: number;
  /**
   * Tick del servidor que el cliente estaba viendo de los demás jugadores
   * (interpolación). El servidor rebobina hasta ahí, con un límite, para
   * comprobar los impactos (compensación de latencia).
   */
  viewTick?: number;
}

export type Locomotion = 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'crouch';

/** Estado público de un jugador (lo que el servidor difundirá). */
export interface PlayerState {
  id: PlayerId;
  name: string;
  /** Posición de los pies. */
  position: Vec3;
  velocity: Vec3;
  /** Orientación en radianes alrededor de Y. */
  yaw: number;
  grounded: boolean;
  locomotion: Locomotion;
  /** Última entrada procesada (para reconciliación). */
  lastProcessedSeq: number;
  /** Estado de combate visible (arma en mano, acción, muerte): ver shared/combat/gear.ts. */
  gear?: number;
}

export const emptyInput = (seq = 0): PlayerInput => ({ seq, moveX: 0, moveZ: 0, buttons: 0, aimYaw: 0 });
