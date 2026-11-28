import { LobbyState } from '@shared/lobby/LobbyState';
import { validProfile } from '@shared/lobby/profile';
import type { WebSocketClient } from '@colyseus/ws-transport';
import { type Client, Room, ServerError } from '@colyseus/core';
import { FixedStepLoop } from '@/engine/FixedStepLoop';
import { SIMULATION } from '@shared/constants';
import {
  CloseCodes,
  isPublicCombatEvent,
  isPublicMatchEvent,
  NET,
  PROTOCOL_VERSION,
  type DamageEvent,
  type PublicCombatEvent,
  type PublicMatchEvent,
  type WelcomeMessage,
} from '@shared/protocol';
import { sanitizeName, sanitizeRoomCode, uniqueName, validateJoinOptions } from '@shared/session';
import { benchPrefix } from './bench';
import { ServerWorld } from './ServerWorld';
import { roomBudget } from './capacity';

const privateCodes=new Map<string,string>();

interface ClientMeta {
  ready: boolean;
  msgWindowStart: number;
  msgCount: number;
  floodStrikes: number;
}

export interface CreateOptions {
  code?: string;
  mode?: 'create'|'join'|'quick';
  visibility?: 'private'|'public';
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
  lobby!: LobbyState;
  private lobbyRevision=-1;
  private lobbyPhase='';
  private loop!: FixedStepLoop;
  private readonly meta = new Map<string, ClientMeta>();
  private readonly skipScratch: Client[] = [];

  /** Esta sala ocupa una plaza de MAX_ROOMS. */
  private holdsBudget = false;

  async onCreate(options: CreateOptions = {}): Promise<void> {
    // Límite de salas del proceso (MAX_ROOMS): protege instancias gratuitas.
    if (!roomBudget.tryAcquire()) throw new ServerError(CloseCodes.SERVER_FULL, 'Servidor lleno: límite de salas alcanzado');
    this.holdsBudget = true;
    try {
      await this.setup(options);
    } catch (e) {
      // Colyseus descarta la sala sin llamar a onDispose: devolver la plaza aquí.
      this.holdsBudget = false;
      roomBudget.release();
      throw e;
    }
  }

  private async setup(options: CreateOptions): Promise<void> {
    this.code = sanitizeRoomCode(options.code);
    if(options.visibility!==undefined&&!['private','public'].includes(options.visibility)||options.visibility==='private'&&!this.code||options.visibility==='public'&&!!this.code)throw new ServerError(4105,'Visibilidad o código inválido');
    if(this.code){
      if(privateCodes.has(this.code))throw new ServerError(4105,'Ese código ya existe');
      privateCodes.set(this.code,this.roomId);
    }
    try{this.world = await ServerWorld.create();}catch(error){if(privateCodes.get(this.code)===this.roomId)privateCodes.delete(this.code);throw error;}
    this.world.round.managed=true;
    this.lobby=new LobbyState(this.code,()=>this.world.round.phase);
    await this.setMatchmaking({code:this.code,unlisted:!!this.code,metadata:{code:this.code,visibility:this.code?'private':'public'}});

    this.onMessage('*', (client) => {
      if (!this.countMessage(client)) return;
      const player = this.world.players.get(client.sessionId);
      if (player && ++player.invalidInputs > NET.maxInvalidInputs) {
        client.leave(CloseCodes.INVALID_INPUT, 'Tipo de mensaje inválido');
      }
    });
    this.onMessage('lobbyReady',(client,message:unknown)=>{
      if(!this.countMessage(client)||!this.meta.get(client.sessionId)?.ready)return;
      if(!message||typeof message!=='object'||!this.lobby.ready(client.sessionId,(message as {ready?:unknown}).ready))this.lobbyError(client,'No se puede cambiar Listo ahora');
    });
    this.onMessage('profile',(client,message:unknown)=>{
      if(!this.countMessage(client)||!this.meta.get(client.sessionId)?.ready)return;
      if(!validProfile(message)||this.world.round.phase!=='waiting'){this.lobbyError(client,'Perfil o estado no válido');return;}
      const p=this.world.players.get(client.sessionId);if(!p)return;
      const name=uniqueName(sanitizeName(message.name),[...this.world.players.values()].filter(q=>q.id!==p.id).map(q=>q.name));
      if(this.lobby.profile(p.id,name,message.skin)){p.name=p.body.state.name=name;p.color=message.skin;}
    });
    this.onMessage('start',(client)=>{
      if(!this.countMessage(client)||!this.meta.get(client.sessionId)?.ready)return;
      if(!this.lobby.mayStart(client.sessionId)||!this.world.round.requestCountdown())this.lobbyError(client,'Solo el anfitrión puede iniciar con todos listos');
    });
    this.onMessage('rematch',(client)=>{
      if(!this.countMessage(client)||!this.meta.get(client.sessionId)?.ready)return;
      // La primera petición abre un lobby limpio; cada participante confirma su propia revancha.
      if(this.world.round.phase==='finished'){this.world.round.returnToLobby();this.lobby.resetReady();}
      if(!this.lobby.ready(client.sessionId,true))this.lobbyError(client,'No se puede pedir revancha durante una partida');
    });
    this.onMessage('returnLobby',(client)=>{
      if(!this.countMessage(client)||!this.meta.get(client.sessionId)?.ready)return;
      if(this.world.round.phase==='finished'){this.world.round.returnToLobby();this.lobby.resetReady();}
      else if(this.world.round.phase==='waiting')this.lobby.ready(client.sessionId,false);
      else this.lobbyError(client,'La partida todavía no ha terminado');
    });
    this.onMessage('ready', (client) => this.handleReady(client));
    this.onMessage('input', (client, message) => this.handleInput(client, message));
    this.onMessage('build', (client, message: unknown) => {
      if (!this.countMessage(client) || !this.meta.get(client.sessionId)?.ready || !this.world.canBuild(client.sessionId)) return;
      const p = this.world.players.get(client.sessionId);
      if (p) this.world.building.state.place(p.id, message, p.body.state.position);
    });
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
      this.world.round.syncWallTime(now / 1000);
      this.loop.advance((now - last) / 1000);
      last = now;
    }, 1000 / NET.tickRate);
  }

  onJoin(client: Client, options: unknown): void {
    const v = validateJoinOptions(options);
    if (!v.ok) {
      throw new ServerError(CloseCodes.PROTOCOL_MISMATCH, v.reason === 'protocol' ? `Versión de protocolo distinta (servidor ${PROTOCOL_VERSION})` : 'Opciones de unión inválidas');
    }
    if(v.options.code!==this.code)throw new ServerError(4105,'Código de sala incorrecto');
    const name = uniqueName(v.options.name, [...this.world.players.values()].map((p) => p.name));
    const player = this.world.addPlayer(client.sessionId, name);
    player.color=v.options.skin;
    this.lobby.add(player.id,player.name,player.color);
    // SOLO pruebas de carga (variable de entorno del SERVIDOR, nunca del cliente):
    // los jugadores cuyo nombre empiece por ese prefijo (p. ej. "Bot") entran
    // armados para medir el combate.
    const bench = benchPrefix();
    if (bench && name.startsWith(bench)) this.world.giveBenchLoadout(player.id, player.netId);
    this.meta.set(client.sessionId, { ready: false, msgWindowStart: Date.now(), msgCount: 0, floodStrikes: 0 });
    this.broadcast('join', this.world.rosterEntry(player), { except: client });
  }

  /** El cliente ya registró sus manejadores: le mandamos la bienvenida. */
  private handleReady(client: Client): void {
    const meta = this.meta.get(client.sessionId);
    const player = this.world.players.get(client.sessionId);
    if (!this.countMessage(client) || !meta || !player || meta.ready) return;
    meta.ready = true;
    this.lobby.loaded(client.sessionId);
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
      vitals: this.world.combat.vitals(player.id)!,
      building: this.world.building.state.snapshot(),
      battle: this.world.round.snapshot(),
      lobby: this.lobby.snapshot(),
    };
    client.send('welcome', welcome);
    player.correctionDirty = false;
  }

  private lobbyError(client:Client,message:string):void{client.send('lobbyError',{message});}

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

  private buildingRevision = -1;
  private resetRevision = 0;
  private tick(): void {
    if(this.world.round.phase==='countdown'&&!this.lobby.canStart)this.world.round.cancelCountdown();
    this.world.step();
    if(this.lobbyRevision!==this.lobby.revision||this.lobbyPhase!==this.world.round.phase){
      this.lobbyRevision=this.lobby.revision;this.lobbyPhase=this.world.round.phase;
      this.broadcast('lobby',this.lobby.snapshot(),{except:this.clients.filter(c=>!this.meta.get(c.sessionId)?.ready)});
    }
    if (this.clients.length === 0) {
      this.world.drainMatchEvents();
      this.world.drainCombatEvents();
      return;
    }
    if (this.resetRevision !== this.world.resetRevision) {
      this.resetRevision = this.world.resetRevision;
      for (const client of this.clients) {
        const meta = this.meta.get(client.sessionId);
        if (meta?.ready) { meta.ready = false; this.handleReady(client); }
      }
    }
    if (this.world.tick % 10 === 0) this.broadcast('battle', this.world.round.snapshot(), { except: this.clients.filter(c => !this.meta.get(c.sessionId)?.ready) });
    if (this.buildingRevision !== this.world.building.state.revision) {
      this.buildingRevision = this.world.building.state.revision;
      this.broadcast('building', this.world.building.state.snapshot(), { except: this.clients.filter(c => !this.meta.get(c.sessionId)?.ready) });
    }
    this.sendMatchEvents();
    this.sendCombatEvents();
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

  /**
   * Combate: disparos, golpes, bajas y vueltas en un mensaje por tick para la
   * sala; el daño solo al atacante y a la víctima; salud y avisos al dueño.
   */
  private sendCombatEvents(): void {
    const events = this.world.drainCombatEvents();
    if (events.length === 0) return;
    const pub: PublicCombatEvent[] = [];
    const hits = new Map<string, DamageEvent[]>();
    const ready = (id: string) => {
      const client = this.clients.find((c) => c.sessionId === id);
      return client && this.meta.get(id)?.ready ? client : null;
    };
    for (const e of events) {
      if (isPublicCombatEvent(e)) pub.push(e);
      else if (e.type === 'damage') {
        for (const id of new Set([e.by, e.victim])) {
          const list = hits.get(id) ?? [];
          list.push(e);
          hits.set(id, list);
        }
      } else if (e.type === 'vitals') ready(e.id)?.send('vitals', e.vitals);
      else if (e.type === 'healed') ready(e.id)?.send('self', { type: 'healed', amount: e.amount });
      else if (e.type === 'empty') ready(e.id)?.send('self', { type: 'empty' });
    }
    for (const [id, list] of hits) ready(id)?.send('hits', { tick: this.world.tick, events: list });
    if (pub.length === 0) return;
    const notReady = this.clients.filter((c) => !this.meta.get(c.sessionId)?.ready);
    this.broadcast('combat', { tick: this.world.tick, events: pub }, notReady.length ? { except: notReady } : undefined);
  }

  async onDrop(client: Client): Promise<void> {
    const p = this.world.players.get(client.sessionId);
    if (p) {
      p.connected = false;
      this.lobby.connected(client.sessionId,false);
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
    if (p) {p.connected = true;this.lobby.connected(client.sessionId,true);}
    const meta = this.meta.get(client.sessionId);
    if (meta) meta.ready = false; // el cliente vuelve a pedir la bienvenida
  }

  onLeave(client: Client): void {
    const p = this.world.removePlayer(client.sessionId);
    this.meta.delete(client.sessionId);
    this.lobby.remove(client.sessionId);
    if (p) this.broadcast('leave', { id: p.id, netId: p.netId });
  }

  onDispose(): void {
    if (this.holdsBudget) {
      this.holdsBudget = false;
      roomBudget.release();
    }
    if(privateCodes.get(this.code)===this.roomId)privateCodes.delete(this.code);
    this.world?.dispose();
  }
}
