/**
 * Contrato de red (preparado para Colyseus, aún sin implementar).
 * Mantener estos mensajes pequeños y planos: se envían ~30 veces por segundo.
 */
import type { PlayerId, PlayerInput, PlayerState } from './types';

export const PROTOCOL_VERSION = 1;

export type ClientMessage =
  | { type: 'input'; input: PlayerInput }
  | { type: 'ping'; t: number };

export type ServerMessage =
  | { type: 'welcome'; protocol: number; playerId: PlayerId; seed: number; tick: number }
  | { type: 'snapshot'; tick: number; players: PlayerState[] }
  | { type: 'pong'; t: number };
