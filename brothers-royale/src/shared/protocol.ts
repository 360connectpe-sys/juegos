/**
 * Contrato de red cliente ↔ servidor (Colyseus).
 * Mensajes pequeños y planos: el servidor emite a 30 Hz y el cliente envía
 * una entrada por tick. Los estados públicos viajan cuantizados (netcodec.ts).
 */
import type { CharacterSnapshot } from './reconciliation';
import type { PlayerInput } from './types';

export const PROTOCOL_VERSION = 3;

/** Nombre de la sala registrada en el servidor. */
export const ROOM_NAME = 'brothers';

export const NET = {
  /** Ticks por segundo del servidor (mismo paso fijo que el cliente). */
  tickRate: 30,
  defaultPort: 2567,
  maxPlayersPerRoom: 8,
  /** Entradas en cola por jugador; las que excedan se descartan. */
  maxQueuedInputs: 12,
  /** Entradas que puede procesar un jugador por tick si llegan en ráfaga. */
  maxInputsPerTick: 3,
  /** Ticks sin entradas antes de simular al jugador "en reposo" (gravedad). */
  idleAfterTicks: 6,
  /** Mensajes por segundo tolerados antes de descartar (y luego expulsar). */
  maxMessagesPerSecond: 90,
  /** Entradas inválidas toleradas antes de expulsar al cliente. */
  maxInvalidInputs: 30,
  /** Segundos para reconectar tras una caída sin perder el personaje. */
  reconnectSeconds: 15,
  /** Retardo de interpolación de jugadores remotos (ticks). */
  interpolationDelayTicks: 3,
} as const;

/**
 * Códigos de cierre propios. Colyseus ya usa 4000-4010 (4001 = servidor
 * apagado, 4002 = error, …), así que los nuestros empiezan en 4100.
 */
export const CloseCodes = {
  PROTOCOL_MISMATCH: 4100,
  INVALID_INPUT: 4101,
  FLOODING: 4102,
  SLOW_CONSUMER: 4103,
  ROOM_CAPACITY: 4104,
} as const;

/** Mensaje claro para el jugador según cómo se cerró la conexión. */
export function closeReason(code: number, reason?: string): string {
  switch (code) {
    case 4000:
    case 1000:
      return 'Saliste de la sala';
    case 4001:
      return 'El servidor se apagó';
    case 4003:
    case 1006:
      return 'Se perdió la conexión con el servidor';
    case CloseCodes.PROTOCOL_MISMATCH:
      return 'Tu versión del juego no coincide con la del servidor; recarga la página';
    case CloseCodes.INVALID_INPUT:
      return 'El servidor rechazó demasiados datos de control no válidos';
    case CloseCodes.ROOM_CAPACITY:
      return 'La sala supera el máximo de 8 jugadores';
    case CloseCodes.SLOW_CONSUMER:
      return 'La conexión no puede recibir el estado del juego a tiempo';
    case CloseCodes.FLOODING:
      return 'Se enviaron demasiados mensajes al servidor';
    default:
      return reason ? `Conexión cerrada: ${reason}` : `Conexión cerrada (código ${code})`;
  }
}

/** Opciones que el cliente manda al unirse. */
export interface JoinOptions {
  protocol: number;
  name: string;
  /** Código de sala (vacío = sala pública). */
  code?: string;
}

/** Entrada del roster: identidad pública de un jugador en la sala. */
export interface RosterEntry {
  /** sessionId de Colyseus: identificador estable durante la sesión. */
  id: string;
  /** Índice corto (0-255) usado en los snapshots cuantizados. */
  netId: number;
  name: string;
  /** Índice de color del avatar. */
  color: number;
}

// --- Cliente → servidor ----------------------------------------------------
export interface ClientMessages {
  input: PlayerInput;
  ping: { t: number };
}

// --- Servidor → cliente ----------------------------------------------------
export interface WelcomeMessage {
  protocol: number;
  playerId: string;
  netId: number;
  roomId: string;
  code: string;
  seed: number;
  tick: number;
  tickRate: number;
  roster: RosterEntry[];
  /** Estado inicial completo del propio personaje. */
  state: CharacterSnapshot;
}

/** Snapshot público compacto (ver netcodec.ts). */
export interface SnapshotMessage {
  tick: number;
  /** Jugadores empaquetados: PackedPlayer[] aplanado. */
  p: number[];
}

/** Estado privado del propietario al final de su última entrada procesada. */
export interface CorrectionMessage {
  tick: number;
  state: CharacterSnapshot;
}

export interface ServerMessages {
  welcome: WelcomeMessage;
  snapshot: SnapshotMessage;
  correction: CorrectionMessage;
  join: RosterEntry;
  leave: { id: string; netId: number };
  pong: { t: number; tick: number };
}
