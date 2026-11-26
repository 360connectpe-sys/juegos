import { EventBus } from '@/core/EventBus';
import { Engine } from '@/engine/Engine';
import { FixedStepLoop } from '@/engine/FixedStepLoop';
import { Lighting } from '@/engine/Lighting';
import type { ContextStatus } from '@/engine/ContextLossMonitor';
import { buildQuality, saveQuality, type QualitySettings, type QualityTier } from '@/engine/quality';
import type { GameSession } from '@/net/GameSession';
import { OfflineSession } from '@/net/OfflineSession';
// Solo tipos: el SDK de Colyseus se descarga cuando el jugador pide jugar en línea.
import type { OnlineInfo, OnlineSession, OnlineStatus } from '@/net/OnlineSession';
import { loadRapier, PhysicsWorld } from '@/physics/PhysicsWorld';
import { SIMULATION } from '@shared/constants';
import type { InsideState } from '@shared/world/prefab';
import { worldColliders } from '@shared/world/colliders';
import { generateWorldLayout, type WorldLayout } from '@shared/world/layout';
import { terrainHeight } from '@shared/world/terrain';
import { Frustum, Matrix4, Sphere, type Group, type Object3D } from 'three';
import { BlobShadows, disposeAvatarResources, PlayerAvatar } from './entities/PlayerAvatar';
import { InputManager } from './input/InputManager';
import type { InputDevice } from './input/sources';
import { createStaticPrefabBatch, PrefabView } from './world/PrefabView';
import { createTerrainMesh, createWater } from './world/Terrain';
import { createTrees } from './world/Trees';

export interface GameStats {
  fps: number;
  frameMs: number;
  worstMs: number;
  /** CPU por frame (lógica + envío a GPU), ms. */
  cpuMs: number;
  refreshHz: number;
  tier: QualitySettings['tier'];
  pixelRatio: number;
  drawCalls: number;
  triangles: number;
  tick: number;
}

export type NetStatus = 'offline' | OnlineStatus;

export interface NetEvent extends Partial<Omit<OnlineInfo, 'status'>> {
  status: NetStatus;
}

export interface OnlineRequest {
  url: string;
  name: string;
  code?: string;
}

export type GameEvents = {
  net: NetEvent;
  /** Estado del contexto WebGL (pérdida/recuperación). */
  graphics: ContextStatus;
  quality: QualityTier;
  progress: { value: number; label: string };
  ready: undefined;
  stats: GameStats;
  device: InputDevice;
  error: { message: string };
};

/** Orquestador: une motor, física, mundo, sesión, entrada y cámara. */
export class Game {
  readonly events = new EventBus<GameEvents>();
  readonly input: InputManager;
  private readonly engine: Engine;
  private lighting!: Lighting;
  private physics: PhysicsWorld | null = null;
  private session: GameSession | null = null;
  private avatar: PlayerAvatar | null = null;
  private readonly remotes = new Map<string, PlayerAvatar>();
  private fallbackReason: string | null = null;
  private connecting = false;
  private connectionAbort: AbortController | null = null;
  private loop: FixedStepLoop | null = null;
  private layout: WorldLayout | null = null;
  private readonly structures: PrefabView[] = [];
  /** Objetos que proyectan sombra en calidad Normal (se activan/desactivan en vivo). */
  private readonly shadowCasters: Object3D[] = [];
  private readonly blobs = new BlobShadows();
  private readonly seenRemotes = new Set<string>();
  private readonly frustum = new Frustum();
  private readonly projScreen = new Matrix4();
  private readonly cullSphere = new Sphere();
  private statsTimer = 0;
  private disposed = false;

  constructor(
    canvas: HTMLCanvasElement,
    private quality: QualitySettings,
    initialDevice: InputDevice = 'keyboard',
    private readonly isTouch = initialDevice === 'touch',
  ) {
    this.engine = new Engine(canvas, quality);
    this.engine.onContextChange = (s) => this.events.emit('graphics', s);
    this.blobs.visible = quality.blobShadows;
    this.engine.scene.add(this.blobs.mesh);
    this.input = new InputManager(window, undefined, initialDevice);
    this.input.onDeviceChange = (d) => this.events.emit('device', d);
  }

  async init(): Promise<void> {
    const report = (value: number, label: string) => this.events.emit('progress', { value, label });
    try {
      report(0.1, 'Preparando la isla');
      this.lighting = new Lighting(this.engine.scene, this.quality);
      // La calidad solo cambia el render: todos ven y chocan con los mismos árboles.
      const layout = generateWorldLayout();
      this.layout = layout;
      this.buildWorldVisuals(layout);

      report(0.4, 'Cargando física');
      const R = await loadRapier();
      if (this.disposed) return;
      const physics = new PhysicsWorld(R);
      physics.addTerrain(layout.terrain);
      worldColliders(layout).forEach((c) => physics.addStatic(c));
      this.physics = physics;

      report(0.8, 'Llamando a tu personaje');
      const spawn = { x: layout.spawn.x, y: terrainHeight(layout.spawn.x, layout.spawn.z, layout.terrain) + 0.1, z: layout.spawn.z };
      this.session = new OfflineSession(physics, spawn);
      this.avatar = new PlayerAvatar(0, this.quality.shadows);
      this.engine.scene.add(this.avatar.root);
      const first = this.session.localPlayer();
      if (first) this.avatar.pushState(first, true);
      this.avatar.render(1, 0);
      this.engine.iso.snapTo(this.avatar.position);

      this.loop = new FixedStepLoop(SIMULATION.fixedDt, {
        step: (dt) => this.step(dt),
        render: (alpha, dt) => this.render(alpha, dt),
      });
      this.engine.start((dt) => this.loop?.advance(dt));
      report(1, 'Listo');
      this.events.emit('ready', undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.events.emit('error', { message });
      throw err;
    }
  }

  private buildWorldVisuals(layout: WorldLayout): void {
    const scene = this.engine.scene;
    scene.add(createWater(layout.terrain.size));
    scene.add(createTerrainMesh(layout.terrain));
    // Edificios con interior: vista propia (techos que se ocultan). El resto, en un solo lote.
    for (const placed of layout.structures.filter((p) => p.def.interior)) {
      const view = new PrefabView(placed, this.quality.shadows);
      this.structures.push(view);
      scene.add(view.root);
      this.shadowCasters.push(...view.root.children);
    }
    const batch = createStaticPrefabBatch(layout.structures.filter((p) => !p.def.interior), this.quality.shadows);
    if (batch) {
      scene.add(batch);
      this.shadowCasters.push(batch);
    }
    const trees: Group = createTrees(layout.trees, layout.seed, this.quality.shadows);
    scene.add(trees);
    this.shadowCasters.push(...trees.children);
  }

  private step(dt: number): void {
    if (!this.session || !this.avatar) return;
    if (this.fallbackReason !== null) {
      const reason = this.fallbackReason;
      this.fallbackReason = null;
      this.goOffline(reason);
    }
    const session = this.session;
    const input = this.input.sample();
    if (this.engine.contextLost) {
      // Sin gráficos no se juega a ciegas: entrada neutra (la conexión y la gravedad siguen).
      input.moveX = 0;
      input.moveZ = 0;
      input.buttons = 0;
    }
    session.tick(input, dt);
    const local = session.localPlayer();
    if (local) this.avatar.pushState(local);
    this.syncRemotes(session);
  }

  private render(alpha: number, dt: number): void {
    const avatar = this.avatar;
    if (!avatar) return;
    avatar.render(alpha, dt);
    // Los remotos fuera de cámara solo se mueven: no se calcula su animación.
    const cam = this.engine.iso.camera;
    this.projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    for (const r of this.remotes.values()) {
      this.cullSphere.set(r.position, 1.5);
      this.cullSphere.center.y += 1;
      r.render(alpha, dt, this.frustum.intersectsSphere(this.cullSphere));
    }
    if (this.quality.blobShadows) this.blobs.update(this.allAvatars());
    const p = avatar.position;
    const zoom = this.input.consumeZoom();
    if (zoom !== 0) this.engine.iso.addZoom(zoom);
    this.engine.iso.follow(p, avatar.velocity.x, avatar.velocity.z, dt);
    this.lighting.follow(this.engine.iso.focus);
    for (const s of this.structures) s.update(p.x, p.y, p.z, dt);

    this.statsTimer += dt;
    if (this.statsTimer >= 0.5) {
      this.statsTimer = 0;
      const f = this.engine.frameInfo();
      this.events.emit('stats', {
        fps: f.fps,
        frameMs: f.frameMs,
        worstMs: f.worstMs,
        cpuMs: f.cpuMs,
        refreshHz: f.refreshHz,
        tier: this.quality.tier,
        pixelRatio: f.pixelRatio,
        drawCalls: f.drawCalls,
        triangles: f.triangles,
        tick: this.loop?.ticks ?? 0,
      });
    }
  }

  /** Crea, actualiza y retira los avatares de los demás jugadores. */
  private *allAvatars(): Generator<PlayerAvatar> {
    if (this.avatar) yield this.avatar;
    yield* this.remotes.values();
  }

  get qualityTier(): QualityTier {
    return this.quality.tier;
  }

  /**
   * Cambia la calidad en vivo (sin recargar). Solo cambia el render: el mundo,
   * las colisiones y la cámara siguen idénticos.
   */
  setQuality(tier: QualityTier): void {
    if (tier === this.quality.tier) return;
    const q = buildQuality(tier, window.devicePixelRatio || 1, this.isTouch);
    this.quality = q;
    this.engine.setQuality(q);
    this.lighting?.setShadows(q);
    for (const o of this.shadowCasters) o.castShadow = q.shadows;
    for (const a of this.allAvatars()) a.castShadow = q.shadows;
    this.blobs.visible = q.blobShadows;
    saveQuality(tier);
    this.events.emit('quality', tier);
  }

  private syncRemotes(session: GameSession): void {
    const seen = this.seenRemotes;
    seen.clear();
    for (const st of session.players()) {
      if (st.id === session.localPlayerId) continue;
      seen.add(st.id);
      let av = this.remotes.get(st.id);
      if (!av) {
        av = new PlayerAvatar(session.identity(st.id).color, this.quality.shadows);
        av.root.name = `remote:${st.id}`;
        this.engine.scene.add(av.root);
        this.remotes.set(st.id, av);
        av.pushState(st, true);
      } else {
        av.pushState(st);
      }
    }
    for (const [id, av] of this.remotes) {
      if (seen.has(id)) continue;
      av.dispose();
      this.remotes.delete(id);
    }
  }

  private clearRemotes(): void {
    for (const av of this.remotes.values()) av.dispose();
    this.remotes.clear();
  }

  /** Sustituye el avatar local (p. ej. para usar el color asignado por la sala). */
  private replaceLocalAvatar(color: number): void {
    const local = this.session?.localPlayer();
    if (!local) return;
    this.avatar?.dispose();
    this.avatar = new PlayerAvatar(color, this.quality.shadows);
    this.engine.scene.add(this.avatar.root);
    this.avatar.pushState(local, true);
    this.avatar.render(1, 0);
  }

  private online(): OnlineSession | null {
    return this.session?.kind === 'online' ? (this.session as OnlineSession) : null;
  }

  get netStatus(): NetStatus {
    return this.online()?.status ?? 'offline';
  }

  /**
   * Pasa al modo en línea. Si falla, sigue en modo offline y emite el motivo.
   * El mundo local (mapa, física) se reutiliza: solo cambia la sesión.
   */
  async goOnline(req: OnlineRequest): Promise<void> {
    if (!this.physics || !this.layout || this.connecting || this.online()) return;
    this.connecting = true;
    const abort = new AbortController();
    this.connectionAbort = abort;
    this.events.emit('net', { status: 'connecting' });
    let current: OnlineSession | null = null;
    try {
      const { OnlineSession } = await import('@/net/OnlineSession');
      const online = await OnlineSession.connect({
        signal: abort.signal,
        url: req.url,
        name: req.name,
        code: req.code ?? '',
        physics: this.physics,
        seed: this.layout.seed,
        onInfo: (info) => {
          // Solo cuenta cuando ya es la sesión activa (evita eventos durante la conexión).
          if (!current || this.session !== current) return;
          this.events.emit('net', info);
          if (info.status === 'disconnected') this.fallbackReason = info.reason ?? 'Conexión perdida';
        },
      });
      if (this.disposed) {
        online.dispose();
        return;
      }
      const old = this.session;
      this.session = online;
      current = online;
      old?.dispose();
      this.replaceLocalAvatar(online.identity(online.localPlayerId).color);
      if (this.avatar) this.engine.iso.snapTo(this.avatar.position);
      this.events.emit('net', { ...online.info });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.events.emit('net', { status: 'offline', reason });
    } finally {
      this.connecting = false;
      if (this.connectionAbort === abort) this.connectionAbort = null;
    }
  }

  /** Vuelve al modo offline conservando la posición actual del jugador. */
  goOffline(reason?: string): void {
    const online = this.online();
    if (!this.physics || !online) return;
    const pos = { ...online.localPlayer().position };
    online.dispose();
    this.clearRemotes();
    this.session = new OfflineSession(this.physics, pos);
    this.replaceLocalAvatar(0);
    this.events.emit('net', reason ? { status: 'offline', reason } : { status: 'offline' });
  }

  /** Para depuración y pruebas e2e (?debug). */
  debugState(): {
    trees: number;
    structures: { id: string; inside: InsideState }[];
    players: readonly import('@shared/types').PlayerState[];
    zoom: number;
    net: NetStatus;
    remoteAvatars: number;
  } {
    return {
      net: this.netStatus,
      remoteAvatars: this.remotes.size,
      trees: this.layout?.trees.length ?? 0,
      structures: this.structures.map((s) => ({ id: s.placed.def.id, inside: s.state })),
      players: this.session?.players() ?? [],
      zoom: this.engine.iso.zoom,
    };
  }

  /** Solo depuración: teletransporta al jugador local. */
  debugTeleport(x: number, y: number, z: number): void {
    if (this.session instanceof OfflineSession) this.session.local.teleport({ x, y, z });
  }

  dispose(): void {
    this.disposed = true;
    this.connectionAbort?.abort();
    this.clearRemotes();
    this.avatar?.dispose();
    this.engine.dispose();
    this.input.dispose();
    this.session?.dispose();
    this.physics?.dispose();
    disposeAvatarResources();
    this.events.clear();
  }
}
