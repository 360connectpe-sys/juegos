import { BattleRound } from '@shared/battle/BattleRound';
import { DEFAULT_MODIFIERS } from '@shared/movement';
import type { Circle } from '@shared/battle/zone';
/**
 * Mundo autoritativo del servidor. No depende de Colyseus ni del DOM: se
 * prueba en Node directamente y la sala (BrothersRoom) solo lo conecta a la red.
 * Reutiliza EXACTAMENTE la misma simulación que el cliente (mapa por semilla,
 * colisionadores, CharacterBody y validación de entradas).
 */
import { BuildingWorld } from '@/physics/BuildingWorld';
import { CharacterBody } from '@/physics/CharacterBody';
import { loadRapier, PhysicsWorld } from '@/physics/PhysicsWorld';
import { SIMULATION, WORLD } from '@shared/constants';
import { isValidPlayerInput } from '@shared/inputValidation';
import { packPlayer } from '@shared/netcodec';
import { NET, type RosterEntry, type SnapshotMessage } from '@shared/protocol';
import type { CharacterSnapshot } from '@shared/reconciliation';
import { MatchState, type LineOfSight, type MatchEvent } from '@shared/match/MatchState';
import { CombatState, type AttackContext, type CombatEvent, type TargetPose } from '@shared/combat/CombatState';
import { PoseHistory } from '@shared/combat/lagcomp';
import { addItem } from '@shared/inventory';
import { ITEMS } from '@shared/items';
import { Buttons, hasButton, type PlayerInput } from '@shared/types';
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
  /** Botón de interacción pulsado en la entrada anterior (detección de flanco). */
  interactHeld: boolean;
}

/** Entrada neutra que se simula mientras el jugador está eliminado (consume su secuencia). */
const deadInput = (input: PlayerInput): PlayerInput => ({ seq: input.seq, moveX: 0, moveZ: 0, buttons: 0, aimYaw: input.aimYaw });

export type QueueResult = 'queued' | 'invalid' | 'dropped' | 'unknown-player';

export class ServerWorld {
  readonly physics: PhysicsWorld;
  readonly layout: WorldLayout;
  readonly players = new Map<string, ServerPlayer>();
  /** Cofres, objetos e inventarios: SOLO el servidor los modifica. */
  readonly match: MatchState;
  readonly los: LineOfSight;
  /** Disparos, salud, curación y muertes: SOLO el servidor los decide. */
  readonly combat: CombatState;
  readonly building: BuildingWorld;
  readonly round: BattleRound;
  resetRevision = 0;
  /** Poses recientes de todos para la compensación de latencia. */
  readonly history = new PoseHistory();
  tick = 0;
  private spawnCounter = 0;
  private readonly ctx: AttackContext;

  private constructor(physics: PhysicsWorld, layout: WorldLayout, matchSeed: number) {
    this.physics = physics;
    this.layout = layout;
    this.match = new MatchState(layout.chests, matchSeed);
    this.building = new BuildingWorld(physics, layout, () => [...this.players.values()].map(p => p.body.state.position));
    this.combat = new CombatState(this.match, matchSeed);
    this.los = (from, to) => physics.lineOfSight(from, to);
    this.ctx = {
      feet: { x: 0, y: 0, z: 0 },
      grounded: true,
      speed: 0,
      dt: SIMULATION.fixedDt,
      tick: 0,
      targets: (viewTick) => this.targetsAt(viewTick),
      damageObstacle: (by, o, d, max, damage, axe) => this.building.damageRay(by, o, d, max, damage, axe),
      castStatic: (o, d, max) => physics.castStatic(o, d, max),
    };
    this.round = new BattleRound(this.combat, layout.terrain.size, matchSeed, {
      actors: () => [...this.players.values()].map(p => ({ id: p.id, name: p.name, feet: p.body.state.position, grounded: p.body.state.grounded, connected: p.connected })),
      reset: ids => this.resetRound(ids),
      spawn: (id, zone, index) => { const p = this.players.get(id); if (p) this.spawnSky(p, zone, index); },
    });
    this.combat.onRespawn = id => this.round.respawn(id);
  }

  /** Objetivos rebobinados al tick que veía el atacante (limitado a LAG_COMPENSATION). */
  targetsAt(viewTick: number | undefined): Iterable<TargetPose> {
    return this.history.at(this.tick, viewTick, [...this.players.keys()].filter(id => !this.combat.isDead(id)));
  }

  /** Eventos de combate pendientes. */
  drainCombatEvents(): CombatEvent[] {
    return this.combat.drain();
  }

  /**
   * @param matchSeed Semilla del botín de ESTA partida (aleatoria por sala;
   * fija en las pruebas para reproducirlas).
   */
  static async create(seed: number = WORLD.seed, matchSeed: number = randomSeed()): Promise<ServerWorld> {
    const R = await loadRapier();
    const layout = generateWorldLayout({ seed });
    const physics = new PhysicsWorld(R);
    physics.addTerrain(layout.terrain);
    worldColliders(layout, true).forEach((c) => physics.addStatic(c));
    physics.step();
    return new ServerWorld(physics, layout, matchSeed);
  }

  /** Eventos de partida pendientes (cofres, objetos, inventarios, avisos). */
  drainMatchEvents(): MatchEvent[] {
    return this.match.drain();
  }

  /** Pruebas de carga: un arma (según netId) con munición, ya en la mano. */
  giveBenchLoadout(id: string, netId: number): void {
    const kinds = ['rifle', 'smg', 'pistol', 'shotgun'] as const;
    const kind = kinds[netId % kinds.length]!;
    const ammo = ITEMS[kind].ammo!;
    let inv = this.match.inventory(id);
    if (!inv) return;
    inv = addItem(inv, { kind, qty: 1, rarity: 'rare' }).inventory;
    inv = addItem(inv, { kind: ammo, qty: ITEMS[ammo].stack }).inventory;
    this.match.setInventory(id, inv);
    this.match.selectSlot(id, 1);
  }

  /** Selección de hueco del inventario (mensaje validado por la sala). */
  selectSlot(id: string, slot: unknown): boolean {
    return this.match.selectSlot(id, slot);
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
      interactHeld: false,
    };
    this.players.set(id, player);
    this.match.addPlayer(id);
    this.building.state.addPlayer(id);
    this.combat.addFighter(id);
    this.round.joined(id);
    this.history.record(this.tick, id, body.state.position);
    return player;
  }

  removePlayer(id: string): ServerPlayer | undefined {
    const p = this.players.get(id);
    if (!p) return undefined;
    this.round.departed(id);
    this.match.removePlayer(id, p.body.state.position);
    this.combat.removeFighter(id);
    this.building.state.removePlayer(id);
    this.history.forget(id);
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
    const { seq, moveX, moveZ, buttons, aimYaw, aimPitch, viewTick } = raw;
    const input: PlayerInput = { seq, moveX, moveZ, buttons, aimYaw };
    if (aimPitch !== undefined) input.aimPitch = aimPitch;
    if (viewTick !== undefined) input.viewTick = viewTick;
    p.queue.push(input);
    p.lastQueuedSeq = seq;
    return 'queued';
  }

  /** Avanza un tick de simulación autoritativa. */
  step(dt: number = SIMULATION.fixedDt): void {
    this.round.before(dt);
    for (const p of this.players.values()) {
      const vitals = this.combat.vitals(p.id);
      p.body.modifiers = { ...DEFAULT_MODIFIERS, frozen: !this.round.canAct(p.id),
        ...(vitals?.descending ? { descent: this.round.zone.current, canSprint: false, canJump: false } : {}) };
      p.credits = Math.min(p.credits + 1, NET.maxInputsPerTick);
      let processed = 0;
      while (p.credits > 0 && p.queue.length > 0) {
        const raw = p.queue.shift()!;
        // Eliminado: no se mueve ni actúa, pero su secuencia avanza.
        const dead = !this.round.canAct(p.id);
        const input = dead ? deadInput(raw) : raw;
        p.body.step(input, dt);
        if (p.body.state.grounded) this.combat.landed(p.id);
        // Interacción (abrir cofre / recoger): solo en el flanco de pulsación y
        // con la posición AUTORITATIVA tras ese mismo paso.
        const interact = hasButton(input.buttons, Buttons.INTERACT);
        if (interact && !p.interactHeld) this.match.interact(p.id, p.body.state.position, this.los);
        p.interactHeld = interact;
        // Combate con la misma posición autoritativa (y el tick visto, rebobinado).
        if (!dead) this.combat.step(p.id, raw, this.attackContext(p, dt));
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
        this.combat.idle(p.id, dt);
        p.credits = 0; // Este tick ya avanzó la simulación: no se puede gastar dos veces.
        p.correctionDirty = true;
      }
      if (p.body.state.position.y < -20 && !this.combat.isDead(p.id)) this.combat.environmentalDamage(p.id, 100, p.body.state.position, this.tick, 'fall');
    }
    this.physics.step();
    this.round.after(dt, this.tick);
    this.tick++;
    for (const p of this.players.values()) this.history.record(this.tick, p.id, p.body.state.position);
  }

  canAct(id: string): boolean { return this.round.canAct(id); }
  private resetRound(ids: readonly string[]): void {
    this.match.reset(ids); this.building.reset(); this.combat.reset(ids);
    for (const p of this.players.values()) {
      if (!ids.includes(p.id)) { this.match.addPlayer(p.id); this.combat.addFighter(p.id); this.combat.exclude(p.id); }
      this.building.state.addPlayer(p.id);
      p.queue.length = 0; p.credits = 0; p.interactHeld = false;
      p.body.modifiers = { ...DEFAULT_MODIFIERS };
      this.respawnAt(p, p.netId); this.history.forget(p.id);
    }
    this.resetRevision++;
  }
  private spawnSky(p: ServerPlayer, zone: Circle, index: number): void {
    // Lejos del borde y de otros puntos de reaparición; solo coordenadas del servidor.
    const angle = Math.max(0, index) * 2.399963;
    const distance = Math.min(12, zone.radius * .4);
    const x = zone.x + Math.sin(angle) * distance, z = zone.z + Math.cos(angle) * distance;
    const y = (this.physics.groundHeightAt(x, z) ?? terrainHeight(x, z, this.layout.terrain)) + 30;
    p.body.teleport({ x, y, z }); p.correctionDirty = true;
    this.history.forget(p.id); this.history.record(this.tick, p.id, p.body.state.position);
  }

  private respawnAt(p: ServerPlayer, index: number): void {
    const s = spawnPoint(this.layout, index);
    p.body.teleport({ x: s.x, y: terrainHeight(s.x, s.z, this.layout.terrain) + 0.1, z: s.z });
    p.correctionDirty = true;
  }

  private attackContext(p: ServerPlayer, dt: number): AttackContext {
    const c = this.ctx;
    const st = p.body.state;
    c.feet = st.position;
    c.grounded = st.grounded;
    c.speed = Math.hypot(st.velocity.x, st.velocity.z);
    c.dt = dt;
    c.tick = this.tick;
    return c;
  }

  /** Snapshot público de todos los jugadores (se difunde a la sala). */
  snapshot(): SnapshotMessage {
    const p: number[] = [];
    for (const pl of this.players.values()) packPlayer(p, pl.netId, pl.body.state, this.combat.gear(pl.id));
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
    this.building.dispose();
    this.physics.dispose();
  }
}

function randomSeed(): number {
  const c = globalThis.crypto;
  return c?.getRandomValues ? c.getRandomValues(new Uint32Array(1))[0]! : Math.floor(Math.random() * 0xffffffff);
}
