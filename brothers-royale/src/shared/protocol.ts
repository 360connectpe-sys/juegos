import type { Profile } from './lobby/profile';
import type { LobbySnapshot } from './lobby/LobbyState';
import type { RoundSnapshot } from './battle/BattleRound';
import type { BuildingSnapshot, BuildRequest } from './building/BuildingState';
/**
 * Contrato de red cliente ↔ servidor (Colyseus).
 * Mensajes pequeños y planos: el servidor emite a 30 Hz y el cliente envía
 * una entrada por tick. Los estados públicos viajan cuantizados (netcodec.ts).
 */
import type { CombatEvent, Vitals } from './combat/CombatState';
import type { CharacterSnapshot } from './reconciliation';
import type { Inventory } from './inventory';
import type { MatchEvent, MatchSnapshot, NoticeCode } from './match/MatchState';
import type { PlayerInput } from './types';

/**
 * v5 (fase 6): entrada con aimPitch y viewTick, estado de combate en los flags
 * del snapshot y mensajes `combat`, `hits` y `vitals`.
 * v6 (fase 7): materiales, árboles destructibles y construcciones autoritativas.
 * v7 (fase 8): vidas finitas, descenso, protección, tormenta y resultados de ronda.
 * v8 (fase 9): perfiles cosméticos, permisos del lobby y estadísticas finales.
 * v9 (fase 12): avión de transporte (planes/air en la ronda), modificadores aéreos, zombis.
 */
export const PROTOCOL_VERSION = 9;

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
  /** El servidor alcanzó su límite de salas simultáneas (MAX_ROOMS). */
  SERVER_FULL: 4105,
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
    case CloseCodes.SERVER_FULL:
      return 'El servidor está lleno ahora mismo; prueba en unos minutos o juega sin conexión';
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
  skin?: number;
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
  profile:Profile;
  lobbyReady:{ready:boolean};
  start:Record<string,never>;
  rematch:Record<string,never>;
  returnLobby:Record<string,never>;
  build: BuildRequest;
  input: PlayerInput;
  /** Elegir hueco del inventario (0..4). */
  select: { slot: number };
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
  /**
   * Cofres abiertos y objetos en el suelo en este momento. El servidor lo envía
   * siempre; es opcional en el tipo porque el cliente lo valida antes de usarlo.
   */
  match?: MatchSnapshot;
  /** Inventario propio (siempre enviado; validado en el cliente). */
  inventory?: Inventory;
  /** Salud y acciones propias (siempre enviado; validado en el cliente). */
  vitals?: Vitals;
  building?: BuildingSnapshot;
  battle?: RoundSnapshot;
  lobby?: LobbySnapshot;
}

/** Combate visible para toda la sala: disparos, golpes, eliminaciones y vueltas. */
export type PublicCombatEvent = Extract<CombatEvent, { type: 'shot' | 'melee' | 'death' | 'respawn' }>;

export const isPublicCombatEvent = (e: CombatEvent): e is PublicCombatEvent =>
  e.type === 'shot' || e.type === 'melee' || e.type === 'death' || e.type === 'respawn';

/** Daño: solo lo reciben el atacante (marcador) y la víctima (indicador). */
export type DamageEvent = Extract<CombatEvent, { type: 'damage' }>;

/** Cambios públicos de la partida (se agrupan por tick). */
export type PublicMatchEvent = Extract<MatchEvent, { type: 'chestOpened' | 'pickupAdded' | 'pickupRemoved' | 'pickupUpdated' }>;

export const isPublicMatchEvent = (e: MatchEvent): e is PublicMatchEvent =>
  e.type === 'chestOpened' || e.type === 'pickupAdded' || e.type === 'pickupRemoved' || e.type === 'pickupUpdated';

/** Snapshot público compacto (ver netcodec.ts). */
export interface SnapshotMessage {
  tick: number;
  /** Jugadores empaquetados: PackedPlayer[] aplanado. */
  p: number[];
  /** Fase 12: zombis empaquetados ([num, x, y, z (cm), yaw (mrad), anim, hp] cada uno). */
  z?: number[];
}

/** Estado privado del propietario al final de su última entrada procesada. */
export interface CorrectionMessage {
  tick: number;
  state: CharacterSnapshot;
}

export interface ServerMessages {
  lobby: LobbySnapshot;
  lobbyError: { message: string };
  battle: RoundSnapshot;
  building: BuildingSnapshot;
  welcome: WelcomeMessage;
  snapshot: SnapshotMessage;
  correction: CorrectionMessage;
  join: RosterEntry;
  leave: { id: string; netId: number };
  /** Cambios públicos de cofres y objetos de un tick. */
  match: { tick: number; events: PublicMatchEvent[] };
  /** Inventario propio (solo al dueño). */
  inventory: Inventory;
  /** Aviso solo para el dueño (inventario lleno, cofre ya abierto…). */
  notice: { code: NoticeCode };
  /** Combate público de un tick. */
  combat: { tick: number; events: PublicCombatEvent[] };
  /** Daños en los que participa el receptor (como atacante o víctima). */
  hits: { tick: number; events: DamageEvent[] };
  /** Salud y acciones propias (al cambiar). */
  vitals: Vitals;
  /** Curación terminada o arma sin balas (solo al dueño). */
  self: { type: 'healed'; amount: number } | { type: 'empty' };
  pong: { t: number; tick: number };
}
