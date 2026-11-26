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
 * Entrada del jugador ya convertida a ejes del MUNDO (no de pantalla).
 * Es lo que el cliente enviará al servidor en cada tick.
 */
export interface PlayerInput {
  /** Número de secuencia para reconciliación del lado del cliente. */
  seq: number;
  /** Dirección de movimiento en el plano XZ del mundo, magnitud 0..1. */
  moveX: number;
  moveZ: number;
  sprint: boolean;
  jump: boolean;
}

/** Estado autoritativo de un jugador (lo que el servidor difundirá). */
export interface PlayerState {
  id: PlayerId;
  name: string;
  position: Vec3;
  velocity: Vec3;
  /** Orientación en radianes alrededor de Y. */
  yaw: number;
  grounded: boolean;
  /** Última entrada procesada (para reconciliación). */
  lastProcessedSeq: number;
}

export const emptyInput = (seq = 0): PlayerInput => ({
  seq,
  moveX: 0,
  moveZ: 0,
  sprint: false,
  jump: false,
});
