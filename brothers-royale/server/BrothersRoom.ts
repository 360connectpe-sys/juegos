import type { WebSocketClient } from '@colyseus/ws-transport';
import { type Client, Room, ServerError } from '@colyseus/core';
import { FixedStepLoop } from '@/engine/FixedStepLoop';
import { SIMULATION } from '@shared/constants';
import { CloseCodes, isPublicMatchEvent, NET, PROTOCOL_VERSION, type PublicMatchEvent, type WelcomeMessage } from '@shared/protocol';
import { sanitizeRoomCode, uniqueName, validateJoinOptions } from '@shared/session';
import { ServerWorld } from './ServerWorld';

interface ClientMeta {
  ready: boolean;
  msgWindowStart: number;
  msgCount: number;
  floodStrikes: number;
}

export interface CreateOptions {
  code?: string;
}

/**
 * Sala de partida: servidor autoritativo a 30 Hz.
 *  - Identificación: sessionId de Colyseus + netId corto + nombre único + color.
 *  - Entradas validadas (shared/inputValidation) con cola, presupuesto por tick
 *    y límite de mensajes; los clientes que abusan son expulsados.
 *  - Snapshot público compacto a toda la sala en cada tick y corrección
 *    privada a cada propietario cuando su estado cambia.
 *  - Caídas de conexión: el personaje se conserva NET.reconnectSeconds.
 */
export class BrothersRoom extends Room {
  maxClients: number = NET.maxPlayersPerRoom;
  maxMessagesPerSecond = NET.maxMessagesPerSecond * 2; // Límite bruto antes de decodificar, incluidos tipos desconocidos.
  patchRate: number | null = null; // sin estado Schema: enviamos snapshots propios
  autoDispose = true;

  world!: ServerWorld;
  code = '';
  private loop!: FixedStepLoop;
  private readonly meta = new Map<string, ClientMeta>();
  private readonly skipScratch: Client[] = [];

  async onCreate(options: CreateOptions = {}): Promise<void> {
    this.code = sanitizeRoomCode(options.code);
    this.world = await ServerWorld.create();
    await this.setMetadata({ code: this.code });

    this.onMessage('*', (client) => {
      if (!this.countMessage(client)) return;
      const player = this.world.players.get(client.sessionId);
      if (player && ++player.invalidInputs > NET.maxInvalidInputs) {
        client.leave(CloseCodes.INVALID_INPUT, 'Tipo de mensaje inválido');
      }
    });
    this.onMessage('ready', (client) => this.handleReady(client));
    this.onMessage('input', (client, message) => this.handleInput(client, message));
    this.onMessage('select', (client, message: { slot?: unknown }) => {
      if (!this.countMessage(client) || !this.meta.get(client.sessionId)?.ready) return;
      this.world.selectSlot(client.sessionId, message?.slot);
    });
    this.onMessage('ping', (client, message: { t?: unknown }) => {
      if (!this.countMessage(client)) return;
      const t = typeof message?.t === 'number' && Number.isFinite(message.t) ? message.t : 0;
      client.send('pong', { t, tick: this.world.tick });
    });

    this.loop = new FixedStepLoop(SIMULATION.fixedDt, { step: () => this.tick(), render: () => undefined });
    // Medimos el tiempo real nosotros: el reloj de la sala se avanza también
    // desde otros puntos de Colyseus y su deltaTime no es fiable aquí.
    let last = performance.now();
    this.setSimulationInterval(() => {
      const now = performance.now();
      this.loop.advance((now - last) / 1000);
      last = now;
    }, 1000 / NET.tickRate);
  }

  onJoin(client: Client, options: unknown): void {
    const v = validateJoinOptions(options);
    if (!v.ok) {
      throw new ServerError(CloseCodes.PROTOCOL_MISMATCH, v.reason === 'protocol' ? `Versión de protocolo distinta (servidor ${PROTOCOL_VERSION})` : 'Opciones de unión inválidas');
    }
    const name = uniqueName(v.options.name, [...this.world.players.values()].map((p) => p.name));
    const player = this.world.addPlayer(client.sessionId, name);
    this.meta.set(client.sessionId, { ready: false, msgWindowStart: Date.now(), msgCount: 0, floodStrikes: 0 });
    this.broadcast('join', this.world.rosterEntry(player), { except: client });
  }

  /** El cliente ya registró sus manejadores: le mandamos la bienvenida. */
  private handleReady(client: Client): void {
    const meta = this.meta.get(client.sessionId);
    const player = this.world.players.get(client.sessionId);
    if (!this.countMessage(client) || !meta || !player || meta.ready) return;
    meta.ready = true;
    const welcome: WelcomeMessage = {
      protocol: PROTOCOL_VERSION,
      playerId: player.id,
      netId: player.netId,
      roomId: this.roomId,
      code: this.code,
      seed: this.world.seed,
      tick: this.world.tick,
      tickRate: NET.tickRate,
      roster: this.world.roster(),
      state: player.body.snapshot(),
      match: this.world.match.snapshot(),
      inventory: this.world.match.inventory(player.id)!,
    };
    client.send('welcome', welcome);
    player.correctionDirty = false;
  }

  private handleInput(client: Client, message: unknown): void {
    if (!this.countMessage(client) || !this.meta.get(client.sessionId)?.ready) return;
    const result = this.world.queueInput(client.sessionId, message);
    const p = this.world.players.get(client.sessionId);
    if (result === 'invalid' && p && p.invalidInputs > NET.maxInvalidInputs) {
      client.leave(CloseCodes.INVALID_INPUT, 'Demasiadas entradas inválidas');
    }
  }

  /** Límite de mensajes por segundo por cliente. Devuelve false si se descarta. */
  private countMessage(client: Client): boolean {
    const m = this.meta.get(client.sessionId);
    if (!m) return false;
    const now = Date.now();
    if (now - m.msgWindowStart >= 1000) {
      m.msgWindowStart = now;
      m.msgCount = 0;
    }
    if (++m.msgCount <= NET.maxMessagesPerSecond) return true;
    if (m.msgCount === NET.maxMessagesPerSecond + 1 && ++m.floodStrikes >= 3) {
      client.leave(CloseCodes.FLOODING, 'Demasiados mensajes');
    }
    return false;
  }

  private tick(): void {
    this.world.step();
    if (this.clients.length === 0) {
      this.world.drainMatchEvents();
      return;
    }
    this.sendMatchEvents();
    // Fase 3.2: el snapshot se codifica UNA vez y se difunde; antes se codificaba
    // una vez por cliente. Se excluye a quien aún no está listo o va saturado.
    const skip = this.skipScratch;
    skip.length = 0;
    for (const client of this.clients) {
      if ((client as WebSocketClient).ref.bufferedAmount > 256 * 1024) {
        client.leave(CloseCodes.SLOW_CONSUMER, 'Conexión saturada');
        skip.push(client);
      } else if (!this.meta.get(client.sessionId)?.ready) {
        skip.push(client);
      }
    }
    if (skip.length < this.clients.length) {
      this.broadcast('snapshot', this.world.snapshot(), skip.length ? { except: skip } : undefined);
    }
    for (const client of this.clients) {
      if (!this.meta.get(client.sessionId)?.ready) continue;
      const state = this.world.takeCorrection(client.sessionId);
      if (state) client.send('correction', { tick: this.world.tick, state });
    }
  }

  /**
   * Cofres y objetos: un único mensaje por tick para toda la sala. Inventario y
   * avisos: solo al dueño. Quien aún no está listo los recibirá en la bienvenida.
   */
  private sendMatchEvents(): void {
    const events = this.world.drainMatchEvents();
    if (events.length === 0) return;
    const pub: PublicMatchEvent[] = [];
    for (const e of events) {
      if (isPublicMatchEvent(e)) pub.push(e);
      else {
        const client = this.clients.find((c) => c.sessionId === e.playerId);
        if (!client || !this.meta.get(client.sessionId)?.ready) continue;
        if (e.type === 'inventory') client.send('inventory', e.inventory);
        else client.send('notice', { code: e.code });
      }
    }
    if (pub.length === 0) return;
    const notReady = this.clients.filter((c) => !this.meta.get(c.sessionId)?.ready);
    this.broadcast('match', { tick: this.world.tick, events: pub }, notReady.length ? { except: notReady } : undefined);
  }

  async onDrop(client: Client): Promise<void> {
    const p = this.world.players.get(client.sessionId);
    if (p) {
      p.connected = false;
      p.queue.length = 0;
      p.credits = 0;
    }
    try {
      await this.allowReconnection(client, NET.reconnectSeconds);
    } catch {
      // La sala se está cerrando o expiró el plazo: Colyseus llamará a onLeave.
    }
  }

  onReconnect(client: Client): void {
    const p = this.world.players.get(client.sessionId);
    if (p) p.connected = true;
    const meta = this.meta.get(client.sessionId);
    if (meta) meta.ready = false; // el cliente vuelve a pedir la bienvenida
  }

  onLeave(client: Client): void {
    const p = this.world.removePlayer(client.sessionId);
    this.meta.delete(client.sessionId);
    if (p) this.broadcast('leave', { id: p.id, netId: p.netId });
  }

  onDispose(): void {
    this.world?.dispose();
  }
}
