import type { PlayerId, PlayerInput, PlayerState } from '@shared/types';

/**
 * Frontera entre el juego y la red. El juego solo habla con esta interfaz:
 *  - OfflineSession (hoy): simula todo localmente.
 *  - ColyseusSession (fase multijugador): envía cada `PlayerInput` al servidor,
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
  dispose(): void;
}
