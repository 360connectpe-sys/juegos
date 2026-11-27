import type { RoundSnapshot } from '@shared/battle/BattleRound';
import { validRound } from '@shared/battle/validation';
import type { BuildingWorld } from '@/physics/BuildingWorld';
import type { BuildingSnapshot, BuildRequest } from '@shared/building/BuildingState';
import { Client, type Room } from '@colyseus/sdk';
import { CharacterBody } from '@/physics/CharacterBody';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { SIMULATION } from '@shared/constants';
import { isValidPlayerInput } from '@shared/inputValidation';
import { toPlayerState, unpackPlayers, writePlayerState, type PublicPlayer } from '@shared/netcodec';
import {
  closeReason,
  CloseCodes,
  NET,
  PROTOCOL_VERSION,
  ROOM_NAME,
  type CorrectionMessage,
  type JoinOptions,
  type RosterEntry,
  type SnapshotMessage,
  type WelcomeMessage,
} from '@shared/protocol';
import type { CharacterSnapshot } from '@shared/reconciliation';
import type { PlayerInput, PlayerState } from '@shared/types';
import type { GameSession, PlayerIdentity } from './GameSession';
import { ReplicatedMatch, type ClientMatchEvent, type MatchView } from './MatchView';
import { fullVitals, isValidCombatEvent, isValidDamageEvent, isValidVitals, type ClientCombatEvent, type CombatView } from './CombatView';
import type { Vitals } from '@shared/combat/CombatState';
import type { ChestPlacement } from '@shared/world/layout';
import type { NoticeCode } from '@shared/match/MatchState';
import type { DamageEvent, PublicCombatEvent, PublicMatchEvent } from '@shared/protocol';
import { sanitizeRoomCode } from '@shared/session';
import { SnapshotInterpolator } from './Interpolation';
import { PredictionController } from './Prediction';

export type OnlineStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface OnlineInfo {
  status: OnlineStatus;
  roomId: string;
  code: string;
  players: number;
  /** Ida y vuelta medido con ping/pong (ms). */
  rtt: number;
  /** Error de la última corrección del servidor (m). */
  correction: number;
  reason?: string;
}

export interface OnlineOptions {
  building?: BuildingWorld;
  url: string;
  name: string;
  code?: string;
  physics: PhysicsWorld;
  /** Semilla del mapa del cliente: debe coincidir con la del servidor. */
  seed: number;
  /** Cofres del mapa local (mismos ids que en el servidor). */
  chests?: readonly ChestPlacement[];
  onInfo?: (info: OnlineInfo) => void;
  /** Tiempo máximo para unirse y recibir la bienvenida (ms). */
  timeoutMs?: number;
  signal?: AbortSignal;
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what}: sin respuesta en ${Math.round(ms / 1000)} s`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });

/**
 * Sesión en línea (Colyseus). El jugador local se predice con la MISMA
 * simulación que el servidor y se reconcilia con su corrección privada; los
 * demás se muestran interpolados a partir de los snapshots públicos.
 */
export class OnlineSession implements GameSession {
  readonly kind = 'online' as const;
  localPlayerId: string;
  private readonly netId: number;
  private body: CharacterBody;
  private prediction: PredictionController<CharacterSnapshot>;
  private readonly interp = new SnapshotInterpolator();
  private readonly roster = new Map<number, RosterEntry>();
  private readonly remoteStates = new Map<number, PlayerState>();
  private readonly aliveScratch = new Set<number>();
  private readonly list: PlayerState[] = [];
  private pendingCorrection: CorrectionMessage | null = null;
  private lastSentSeq = 0;
  private lastCorrectionTick = -1;
  private ticksSinceSnapshot = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly scratch: PublicPlayer = { netId: 0, x: 0, y: 0, z: 0, yaw: 0, vx: 0, vy: 0, vz: 0, grounded: true, locomotion: 'idle', lastSeq: 0, gear: 0 };
  /** Tick (de servidor) en el que se están mostrando los demás: va en cada entrada (compensación de latencia). */
  private viewTick = 0;
  private vitalsState: Vitals = fullVitals();
  onCombatEvent: ((e: ClientCombatEvent) => void) | null = null;
  readonly info: OnlineInfo;
  /** Réplica de cofres, objetos e inventario propio (la autoridad es el servidor). */
  private readonly replica: ReplicatedMatch;
  onMatchEvent: ((e: ClientMatchEvent) => void) | null = null;
  private disposed = false;
  battle?: RoundSnapshot;

  private constructor(
    private readonly room: Room,
    private readonly physics: PhysicsWorld,
    welcome: WelcomeMessage,
    private readonly onInfo: ((info: OnlineInfo) => void) | undefined,
    chests: readonly ChestPlacement[] = [],
    readonly building?: BuildingWorld,
  ) {
    this.replica = new ReplicatedMatch(chests);
    this.replica.load(welcome.match, welcome.inventory);
    if (validRound(welcome.battle)) this.battle = welcome.battle;
    if (welcome.building) building?.load(welcome.building);
    if (isValidVitals(welcome.vitals)) this.vitalsState = welcome.vitals;
    if (welcome.roster.length > NET.maxPlayersPerRoom) throw new Error('El servidor supera el máximo de 8 jugadores por sala');
    this.localPlayerId = welcome.playerId;
    this.lastCorrectionTick = welcome.tick;
    this.lastSentSeq = welcome.state.lastProcessedSeq;
    this.netId = welcome.netId;
    const name = welcome.roster.find((r) => r.id === welcome.playerId)?.name ?? 'Jugador';
    this.body = new CharacterBody(physics, welcome.playerId, name, welcome.state.position);
    this.body.restore(welcome.state);
    this.prediction = new PredictionController(this.body, SIMULATION.fixedDt);
    for (const r of welcome.roster) this.roster.set(r.netId, r);
    this.list.push(this.body.state);
    this.info = { status: 'connected', roomId: welcome.roomId, code: welcome.code, players: welcome.roster.length, rtt: 0, correction: 0 };
  }

  /** Conecta, se une (o crea) la sala y espera la bienvenida. */
  static async connect(opts: OnlineOptions): Promise<OnlineSession> {
    opts.signal?.throwIfAborted();
    const timeout = opts.timeoutMs ?? 8000;
    const client = new Client(opts.url);
    const join: JoinOptions = { protocol: PROTOCOL_VERSION, name: opts.name, code: sanitizeRoomCode(opts.code) };
    let expired = false;
    const joining = client.joinOrCreate(ROOM_NAME, join);
    void joining.then((late) => { if (expired) void late.leave(true).catch(() => undefined); }, () => undefined);
    const room = await withTimeout(joining, timeout, 'No se pudo conectar al servidor')
      .catch((error) => { expired = true; throw error; });
    room.reconnection.minUptime = 0;
    room.reconnection.maxDelay = 2000;
    room.reconnection.maxRetries = 10; // Reintentos durante aproximadamente los 15 s reservados por el servidor.
    let session: OnlineSession | null = null;
    const early: { snapshot: SnapshotMessage[]; join: RosterEntry[] } = { snapshot: [], join: [] };

    const welcome = await withTimeout(
      new Promise<WelcomeMessage>((resolve, reject) => {
        room.onMessage('welcome', (w: WelcomeMessage) => {
          if (session) return session.onWelcome(w); // reconexión
          if (w.protocol !== PROTOCOL_VERSION) return reject(new Error('Versión de protocolo distinta'));
          if (w.seed !== opts.seed) return reject(new Error('El servidor usa otro mapa'));
          resolve(w);
        });
        room.onMessage('snapshot', (m: SnapshotMessage) => (session ? session.onSnapshot(m) : early.snapshot.splice(0, early.snapshot.length, m)));
        room.onMessage('correction', (m: CorrectionMessage) => session?.onCorrection(m));
        room.onMessage('join', (m: RosterEntry) => (session ? session.onJoin(m) : early.join.push(m)));
        room.onMessage('leave', (m: { id: string; netId: number }) => session?.onLeave(m.netId));
        room.onMessage('pong', (m: { t: number }) => session?.onPong(m));
        room.onMessage('battle', (s: unknown) => { if (session && validRound(s)) session.battle = s; });
        room.onMessage('building', (s: BuildingSnapshot) => { if (s && session?.building && s.revision >= session.building.state.revision) session.building.load(s); });
        room.onMessage('match', (m: { tick: number; events: PublicMatchEvent[] }) => session?.onMatch(m));
        room.onMessage('inventory', (m: unknown) => session?.onInventory(m));
        room.onMessage('notice', (m: { code: NoticeCode }) => session?.onNotice(m));
        room.onMessage('combat', (m: { events?: unknown }) => session?.onCombat(m));
        room.onMessage('hits', (m: { events?: unknown }) => session?.onHits(m));
        room.onMessage('vitals', (m: unknown) => session?.onVitals(m));
        room.onMessage('self', (m: { type?: unknown; amount?: unknown }) => session?.onSelf(m));
        room.onLeave((code: number, reason?: string) => {
          if (!session) reject(new Error(closeReason(code, reason)));
          else session.onClosed(code, reason);
        });
        room.send('ready');
      }),
      timeout,
      'El servidor no respondió',
    ).catch(async (e) => {
      await room.leave(true).catch(() => undefined);
      throw e;
    });

    try {
      opts.signal?.throwIfAborted();
      session = new OnlineSession(room, opts.physics, welcome, opts.onInfo, opts.chests ?? [], opts.building);
    } catch (error) {
      await room.leave(true).catch(() => undefined);
      throw error;
    }
    early.join.forEach((j) => session!.onJoin(j));
    early.snapshot.forEach((s) => session!.onSnapshot(s));
    room.onDrop(() => session!.setStatus('reconnecting'));
    room.onReconnect(() => {
      room.send('ready'); // pide una bienvenida nueva con el estado actual
    });
    session.startPing();
    session.emit();
    return session;
  }

  // --- GameSession -----------------------------------------------------------

  tick(input: PlayerInput, dt: number): void {
    if (this.pendingCorrection) {
      const c = this.pendingCorrection;
      this.pendingCorrection = null;
      const before = { ...this.body.state.position };
      this.prediction.reconcile(c.state, c.state.lastProcessedSeq);
      this.lastCorrectionTick = c.tick;
      const after = this.body.state.position;
      this.info.correction = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
    }
    if (isValidPlayerInput(input, this.lastSentSeq)) {
      this.lastSentSeq = input.seq;
      input.viewTick = this.viewTick;
      if (this.info.status === 'connected') this.room.send('input', input);
      this.prediction.predict(input);
    }
    this.physics.step();
    this.ticksSinceSnapshot++;
    this.updateRemotes(dt);
  }

  players(): readonly PlayerState[] {
    return this.list;
  }

  localPlayer(): PlayerState {
    return this.body.state;
  }

  get match(): MatchView {
    return this.replica;
  }

  get combat(): CombatView {
    return { vitals: this.vitalsState };
  }

  requestBuild(request: BuildRequest): boolean {
    if (this.info.status !== 'connected') return false;
    this.room.send('build', request); return true;
  }

  selectSlot(slot: number): void {
    if (this.info.status === 'connected' && Number.isInteger(slot)) this.room.send('select', { slot });
  }

  identity(id: string): PlayerIdentity {
    for (const r of this.roster.values()) if (r.id === id) return { name: r.name, color: r.color };
    return { name: 'Jugador', color: 0 };
  }

  get status(): OnlineStatus {
    return this.info.status;
  }

  /** Pruebas/depuración: entradas aún no confirmadas por el servidor. */
  get pendingInputs(): number {
    return this.prediction.history.size;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.room.removeAllListeners();
    void this.room.leave(true).catch(() => undefined);
    this.body.dispose();
  }

  // --- Mensajes del servidor ---------------------------------------------------

  private onMatch(m: { tick: number; events: PublicMatchEvent[] }): void {
    if (!Array.isArray(m?.events)) return;
    for (const e of m.events) {
      const ok = this.replica.apply(e);
      if (ok) this.onMatchEvent?.(ok);
    }
  }

  private onInventory(m: unknown): void {
    const inv = this.replica.setInventory(m);
    if (inv) this.onMatchEvent?.({ type: 'inventory', inventory: inv });
  }

  private onNotice(m: { code: NoticeCode }): void {
    if (m?.code === 'full' || m?.code === 'opened' || m?.code === 'gone') this.onMatchEvent?.({ type: 'notice', code: m.code });
  }

  private onCombat(m: { events?: unknown }): void {
    if (!Array.isArray(m?.events)) return;
    for (const e of m.events.slice(0, 256)) if (isValidCombatEvent(e)) this.onCombatEvent?.(e as PublicCombatEvent);
  }

  private onHits(m: { events?: unknown }): void {
    if (!Array.isArray(m?.events)) return;
    for (const e of m.events.slice(0, 64)) {
      // Solo daños propios (como atacante o víctima): el resto no es asunto de este cliente.
      if (isValidDamageEvent(e) && (e.by === this.localPlayerId || e.victim === this.localPlayerId)) this.onCombatEvent?.(e as DamageEvent);
    }
  }

  private onVitals(m: unknown): void {
    if (!isValidVitals(m)) return;
    this.vitalsState = m;
    this.onCombatEvent?.({ type: 'vitals', vitals: m });
  }

  private onSelf(m: { type?: unknown; amount?: unknown }): void {
    if (m?.type === 'empty') this.onCombatEvent?.({ type: 'empty' });
    else if (m?.type === 'healed' && typeof m.amount === 'number' && Number.isFinite(m.amount) && m.amount >= 0 && m.amount <= 100)
      this.onCombatEvent?.({ type: 'healed', amount: m.amount });
  }

  private onWelcome(w: WelcomeMessage): void {
    if (w.roster.length > NET.maxPlayersPerRoom) {
      this.onClosed(CloseCodes.ROOM_CAPACITY);
      void this.room.leave(true).catch(() => undefined);
      return;
    }
    // Tras reconectar: estado autoritativo fresco y sin entradas pendientes viejas.
    this.replica.load(w.match, w.inventory);
    if (validRound(w.battle)) this.battle = w.battle;
    if (w.building) this.building?.load(w.building);
    this.onMatchEvent?.({ type: 'reset' });
    this.vitalsState = isValidVitals(w.vitals) ? w.vitals : fullVitals();
    this.onCombatEvent?.({ type: 'vitals', vitals: this.vitalsState });
    this.pendingCorrection = null;
    this.lastCorrectionTick = w.tick;
    this.interp.clear();
    this.remoteStates.clear();
    this.ticksSinceSnapshot = 0;
    this.roster.clear();
    for (const r of w.roster) this.roster.set(r.netId, r);
    this.prediction = new PredictionController(this.body, SIMULATION.fixedDt);
    this.body.restore(w.state);
    this.lastSentSeq = Math.max(this.lastSentSeq, w.state.lastProcessedSeq);
    this.info.players = this.roster.size;
    this.setStatus('connected');
  }

  private onSnapshot(m: SnapshotMessage): void {
    if (typeof m?.tick !== 'number') return;
    const players = unpackPlayers(m.p).filter((p) => p.netId !== this.netId);
    this.interp.push(m.tick, players);
    this.ticksSinceSnapshot = 0;
  }

  private onCorrection(m: CorrectionMessage): void {
    if (!m?.state || !Number.isSafeInteger(m.tick) || m.tick <= this.lastCorrectionTick || typeof m.state.lastProcessedSeq !== 'number') return;
    // Se aplica al principio del siguiente tick (nunca a mitad de un frame).
    if (!this.pendingCorrection || m.tick >= this.pendingCorrection.tick) this.pendingCorrection = m;
  }

  private onJoin(r: RosterEntry): void {
    if (!this.roster.has(r.netId) && this.roster.size >= NET.maxPlayersPerRoom) {
      this.onClosed(CloseCodes.ROOM_CAPACITY);
      void this.room.leave(true).catch(() => undefined);
      return;
    }
    this.roster.set(r.netId, r);
    this.info.players = this.roster.size;
    this.emit();
  }

  private onLeave(netId: number): void {
    this.roster.delete(netId);
    this.interp.remove(netId);
    this.remoteStates.delete(netId);
    this.info.players = this.roster.size;
    this.emit();
  }

  private onPong(m: { t: number }): void {
    if (typeof m?.t === 'number') this.info.rtt = Math.max(0, Math.round(performance.now() - m.t));
    this.emit();
  }

  private onClosed(code: number, reason?: string): void {
    this.info.status = 'disconnected';
    this.info.reason = closeReason(code, reason);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.emit();
  }

  // --- Internos ----------------------------------------------------------------

  /** Muestrea a los remotos en el pasado reciente y actualiza la lista visible. */
  private updateRemotes(_dt: number): void {
    const target = Math.min(this.interp.latestTick, this.interp.latestTick - NET.interpolationDelayTicks + this.ticksSinceSnapshot);
    this.viewTick = Math.max(0, Math.round(target));
    // Sin asignaciones por tick: se reutilizan los PlayerState de cada remoto.
    const alive = this.aliveScratch;
    alive.clear();
    for (const netId of this.interp.keys()) {
      const p = this.interp.sample(netId, target, this.scratch);
      const r = this.roster.get(netId);
      if (!p || !r) continue;
      alive.add(netId);
      let s = this.remoteStates.get(netId);
      if (!s) {
        s = toPlayerState(p, r.id, r.name);
        this.remoteStates.set(netId, s);
      } else {
        writePlayerState(s, p, r.id, r.name);
      }
    }
    for (const id of this.remoteStates.keys()) if (!alive.has(id)) this.remoteStates.delete(id);
    this.list.length = 1;
    this.list[0] = this.body.state;
    for (const s of this.remoteStates.values()) this.list.push(s);
  }

  private startPing(): void {
    const ping = () => this.info.status === 'connected' && this.room.send('ping', { t: performance.now() });
    ping();
    this.pingTimer = setInterval(ping, 2000);
  }

  private setStatus(s: OnlineStatus): void {
    this.info.status = s;
    this.emit();
  }

  private emit(): void {
    this.onInfo?.({ ...this.info });
  }
}
