import type { PlayerId, PlayerInput, PlayerState } from '@shared/types';

/**
 * Frontera entre el juego y la red. El juego solo habla con esta interfaz:
 *  - OfflineSession (hoy): simula todo localmente.
 *  - ColyseusSession (fase multijugador): envía entradas al servidor, predice
 *    al jugador local con la MISMA simulación (CharacterBody) y reconcilia con
 *    las instantáneas autoritativas; los demás jugadores se interpolan.
 */
export interface GameSession {
  readonly kind: 'offline' | 'online';
  readonly localPlayerId: PlayerId;
  /** Avanza un tick fijo con la entrada local. */
  tick(input: PlayerInput, dt: number): void;
  /** Estado actual (predicho/autoritativo) de todos los jugadores visibles. */
  players(): readonly PlayerState[];
  dispose(): void;
}
