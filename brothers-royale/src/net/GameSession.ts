import type { PublicZombie } from '@/physics/ZombieDirector';
import type { Profile } from '@shared/lobby/profile';
import type { LobbySnapshot } from '@shared/lobby/LobbyState';
import type { RoundSnapshot } from '@shared/battle/BattleRound';
import type { BuildingWorld } from '@/physics/BuildingWorld';
import type { BuildRequest } from '@shared/building/BuildingState';
import type { PlayerId, PlayerInput, PlayerState } from '@shared/types';
import type { ClientCombatEvent, CombatView } from './CombatView';
import type { ClientMatchEvent, MatchView } from './MatchView';

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
  readonly lobby?:LobbySnapshot;
  lobbyReady?(ready:boolean):void;
  setProfile?(profile:Profile):boolean;
  returnToLobby?():boolean;
  rematch?():boolean;
  readonly battle?: RoundSnapshot;
  startRound?(): boolean;
  readonly building?: BuildingWorld;
  requestBuild?(request: BuildRequest): boolean;
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
  /** Cofres, objetos en el suelo e inventario propio (lo decide la autoridad). */
  readonly match: MatchView;
  /** Avisa de cambios de la partida (para actualizar vistas y HUD). */
  onMatchEvent: ((e: ClientMatchEvent) => void) | null;
  /** Pide cambiar el hueco seleccionado del inventario (lo valida la autoridad). */
  selectSlot(slot: number): void;
  /** Salud y acciones propias (lo decide la autoridad). */
  readonly combat: CombatView;
  /** Disparos, daño, bajas y salud (para FX, sonido y HUD). */
  onCombatEvent: ((e: ClientCombatEvent) => void) | null;
  /** Fase 12: zombis visibles (lo decide la autoridad). */
  zombies?(): readonly PublicZombie[];
  dispose(): void;
}
