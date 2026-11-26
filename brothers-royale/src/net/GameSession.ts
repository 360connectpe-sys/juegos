import type { PlayerId, PlayerInput, PlayerState } from '@shared/types';

/** Identidad visible de un jugador (para pintar su avatar). */
export interface PlayerIdentity {
  name: string;
  /** Índice de color del avatar. */
  color: number;
}

/**
 * Frontera entre el juego y la red. El juego solo habla con esta interfaz:
 *  - OfflineSession: simula todo localmente (modo por defecto).
 *  - OnlineSession (Colyseus): envía cada `PlayerInput` al servidor,
 *    predice al jugador local con la MISMA simulación (CharacterBody +
 *    PredictionController) y reconcilia con las instantáneas autoritativas;
 *    los demás jugadores se interpolan con `PlayerAvatar`.
 */
export interface GameSession {
  readonly kind: 'offline' | 'online';
  readonly localPlayerId: PlayerId;
  /** Avanza un tick fijo con la entrada local. */
  tick(input: PlayerInput, dt: number): void;
  /** Estado actual (predicho/autoritativo) de todos los jugadores visibles. */
  players(): readonly PlayerState[];
  /** Estado del jugador local (atajo). */
  localPlayer(): PlayerState | undefined;
  /** Nombre y color de un jugador visible. */
  identity(id: PlayerId): PlayerIdentity;
  dispose(): void;
}
