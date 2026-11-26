/**
 * Mundo autoritativo del servidor. No depende de Colyseus ni del DOM: se
 * prueba en Node directamente y la sala (BrothersRoom) solo lo conecta a la red.
 * Reutiliza EXACTAMENTE la misma simulación que el cliente (mapa por semilla,
 * colisionadores, CharacterBody y validación de entradas).
 */
import { CharacterBody } from '@/physics/CharacterBody';
import { loadRapier, PhysicsWorld } from '@/physics/PhysicsWorld';
import { SIMULATION, WORLD } from '@shared/constants';
import { isValidPlayerInput } from '@shared/inputValidation';
import { packPlayer } from '@shared/netcodec';
import { NET, type RosterEntry, type SnapshotMessage } from '@shared/protocol';
import type { CharacterSnapshot } from '@shared/reconciliation';
import type { PlayerInput } from '@shared/types';
import { worldColliders } from '@shared/world/colliders';
import { generateWorldLayout, spawnPoint, type WorldLayout } from '@shared/world/layout';
import { terrainHeight } from '@shared/world/terrain';

export const AVATAR_COLORS = 8;

export interface ServerPlayer {
  readonly id: string;
  readonly netId: number;
  readonly name: string;
  readonly color: number;
  readonly body: CharacterBody;
  /** Entradas válidas pendientes de simular (orden de secuencia). */
  readonly queue: PlayerInput[];
  /** Última secuencia aceptada en cola (para validar las siguientes). */
  lastQueuedSeq: number;
  /** Presupuesto de entradas por tick (anti "speed hack"). */
  credits: number;
  idleTicks: number;
  invalidInputs: number;
  droppedInputs: number;
  /** Hay estado nuevo que enviar al propietario. */
  correctionDirty: boolean;
  connected: boolean;
}

export type QueueResult = 'queued' | 'invalid' | 'dropped' | 'unknown-player';

export class ServerWorld {
  readonly physics: PhysicsWorld;
  readonly layout: WorldLayout;
  readonly players = new Map<string, ServerPlayer>();
  tick = 0;
  private spawnCounter = 0;

  private constructor(physics: PhysicsWorld, layout: WorldLayout) {
    this.physics = physics;
    this.layout = layout;
  }

  static async create(seed: number = WORLD.seed): Promise<ServerWorld> {
    const R = await loadRapier();
    const layout = generateWorldLayout({ seed });
    const physics = new PhysicsWorld(R);
    physics.addTerrain(layout.terrain);
    worldColliders(layout).forEach((c) => physics.addStatic(c));
    physics.step();
    return new ServerWorld(physics, layout);
  }

  get seed(): number {
    return this.layout.seed;
  }

  private allocNetId(): number {
    const used = new Set([...this.players.values()].map((p) => p.netId));
    for (let i = 0; i < 256; i++) if (!used.has(i)) return i;
    throw new Error('Sin identificadores libres en la sala');
  }

  addPlayer(id: string, name: string): ServerPlayer {
    if (this.players.size >= NET.maxPlayersPerRoom) throw new Error('Sala llena (máximo 8 jugadores)');
    if (this.players.has(id)) throw new Error(`Jugador duplicado: ${id}`);
    const netId = this.allocNetId();
    const spawn = spawnPoint(this.layout, this.spawnCounter++);
    const y = terrainHeight(spawn.x, spawn.z, this.layout.terrain) + 0.05;
    const body = new CharacterBody(this.physics, id, name, { x: spawn.x, y, z: spawn.z });
    // Posa al personaje en el suelo antes de que nadie lo vea.
    for (let i = 0; i < 3; i++) body.stepIdle();
    const player: ServerPlayer = {
      id,
      netId,
      name,
      color: netId % AVATAR_COLORS,
      body,
      queue: [],
      lastQueuedSeq: 0,
      credits: 1,
      idleTicks: 0,
      invalidInputs: 0,
      droppedInputs: 0,
      correctionDirty: true,
      connected: true,
    };
    this.players.set(id, player);
    return player;
  }

  removePlayer(id: string): ServerPlayer | undefined {
    const p = this.players.get(id);
    if (!p) return undefined;
    p.body.dispose();
    this.players.delete(id);
    return p;
  }

  /** Valida y encola una entrada recibida por la red. */
  queueInput(id: string, raw: unknown): QueueResult {
    const p = this.players.get(id);
    if (!p) return 'unknown-player';
    const after = Math.max(p.lastQueuedSeq, p.body.state.lastProcessedSeq);
    if (!isValidPlayerInput(raw, after)) {
      p.invalidInputs++;
      return 'invalid';
    }
    if (p.queue.length >= NET.maxQueuedInputs) {
      p.droppedInputs++;
      return 'dropped';
    }
    // Copia campo a campo: no guardamos propiedades extra que mande el cliente.
    const { seq, moveX, moveZ, buttons, aimYaw } = raw;
    p.queue.push({ seq, moveX, moveZ, buttons, aimYaw });
    p.lastQueuedSeq = seq;
    return 'queued';
  }

  /** Avanza un tick de simulación autoritativa. */
  step(dt: number = SIMULATION.fixedDt): void {
    for (const p of this.players.values()) {
      p.credits = Math.min(p.credits + 1, NET.maxInputsPerTick);
      let processed = 0;
      while (p.credits > 0 && p.queue.length > 0) {
        const input = p.queue.shift()!;
        p.body.step(input, dt);
        p.credits--;
        processed++;
      }
      if (processed > 0) {
        p.idleTicks = 0;
        p.correctionDirty = true;
      } else if (++p.idleTicks >= NET.idleAfterTicks) {
        // Sin entradas (lag fuerte, pestaña en segundo plano, desconexión):
        // la gravedad sigue actuando, sin consumir secuencia.
        p.body.stepIdle(dt);
        p.credits = 0; // Este tick ya avanzó la simulación: no se puede gastar dos veces.
        p.correctionDirty = true;
      }
      if (p.body.state.position.y < -20) {
        const s = spawnPoint(this.layout, p.netId);
        p.body.teleport({ x: s.x, y: terrainHeight(s.x, s.z, this.layout.terrain) + 0.1, z: s.z });
        p.correctionDirty = true;
      }
    }
    this.physics.step();
    this.tick++;
  }

  /** Snapshot público de todos los jugadores (se difunde a la sala). */
  snapshot(): SnapshotMessage {
    const p: number[] = [];
    for (const pl of this.players.values()) packPlayer(p, pl.netId, pl.body.state);
    return { tick: this.tick, p };
  }

  /** Estado privado para el propietario si cambió desde el último envío. */
  takeCorrection(id: string): CharacterSnapshot | null {
    const p = this.players.get(id);
    if (!p || !p.correctionDirty) return null;
    p.correctionDirty = false;
    return p.body.snapshot();
  }

  rosterEntry(p: ServerPlayer): RosterEntry {
    return { id: p.id, netId: p.netId, name: p.name, color: p.color };
  }

  roster(): RosterEntry[] {
    return [...this.players.values()].map((p) => this.rosterEntry(p));
  }

  dispose(): void {
    for (const p of this.players.values()) p.body.dispose();
    this.players.clear();
    this.physics.dispose();
  }
}
