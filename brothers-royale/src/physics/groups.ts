import type { CollisionLayer } from '@shared/world/colliders';

/** Bits de capa (16 bits de pertenencia + 16 de filtro, formato de Rapier). */
export const LAYER_BITS: Record<CollisionLayer, number> = {
  world: 1 << 0,
  structure: 1 << 1,
  build: 1 << 2,
  player: 1 << 3,
};

export const interactionGroups = (membership: number, filter: number): number => ((membership & 0xffff) << 16) | (filter & 0xffff);

/** Lo estático choca con todo. */
export const staticGroups = (layer: CollisionLayer): number => interactionGroups(LAYER_BITS[layer], 0xffff);

/** El jugador choca con mundo, estructuras y construcciones (no con otros jugadores por ahora). */
export const PLAYER_GROUPS = interactionGroups(
  LAYER_BITS.player,
  LAYER_BITS.world | LAYER_BITS.structure | LAYER_BITS.build,
);

/** Consultas de cámara: chocan con mundo, estructuras y construcciones, nunca con jugadores. */
export const CAMERA_QUERY_GROUPS = interactionGroups(0xffff, LAYER_BITS.world | LAYER_BITS.structure | LAYER_BITS.build);
