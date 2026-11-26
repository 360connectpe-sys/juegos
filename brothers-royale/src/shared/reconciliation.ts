import type { MotorModifiers, MotorState } from './movement';
import type { PlayerState, Vec3 } from './types';

/**
 * Estado autoritativo privado del propietario, al terminar lastProcessedSeq.
 * El servidor debe enviar también el motor (velocidades, yaw, suelo, coyote,
 * búfer y flanco de salto) y los modificadores vigentes en ese tick.
 * La velocidad pública tras colisiones puede diferir de la intención del motor.
 * Requiere el mismo mapa, colisionadores y paso fijo en ambos extremos.
 */
export interface CharacterSnapshot {
  position: Vec3;
  motor: MotorState;
  modifiers: MotorModifiers;
  velocity: Vec3;
  locomotion: PlayerState['locomotion'];
  lastProcessedSeq: number;
}
