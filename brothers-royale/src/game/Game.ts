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
import { Vector3 } from 'three';
import { moveToWorld, type CameraMode } from '@/engine/camera/cameraMath';
import { CameraController } from './camera/CameraController';
import type { LookSettings, SampleContext } from './input/InputManager';
import { Buttons, type Vec2 } from '@shared/types';
import { InputManager } from './input/InputManager';
import type { InputDevice } from './input/sources';
import { createStaticPrefabBatch, InteriorBatch, PrefabView } from './world/PrefabView';
import { ChestView, PickupView } from './world/Loot';
import type { ClientMatchEvent } from '@/net/MatchView';
import type { Inventory } from '@shared/inventory';
import { itemName } from '@shared/items';
import { findTarget, type InteractTarget, type NoticeCode } from '@shared/match/MatchState';
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

/** Objetivo de interacción cercano (para el botón Abrir / Recoger). */
export interface InteractInfo {
  type: 'chest' | 'pickup';
  id: number;
  /** Texto del botón: "Abrir" o "Recoger". */
  action: string;
  /** Qué es: "Cofre", "Escopeta rara"… */
  label: string;
}

export type GameEvents = {
  net: NetEvent;
  camera: CameraMode;
  inventory: Inventory;
  interact: InteractInfo | null;
  notice: NoticeCode;
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
  /** Cámaras (isométrica / 3ª / 1ª persona). Se crea con la física (colisión de cámara). */
  private cameras: CameraController | null = null;
  private pendingMode: CameraMode = 'isometric';
  /** Entrada en pausa (Ajustes o editor de HUD abiertos): el personaje no se mueve. */
  private inputSuspended = false;
  private readonly sampleCtx: SampleContext = {
    toWorld: (sx, sy) => moveToWorld(sx, sy, this.cameras?.mode ?? 'isometric', this.cameras?.yaw ?? 0),
    cameraYaw: null,
    alwaysAim: false,
    mouseAim: null,
  };
  private readonly projected = new Vector3();
  private readonly mouseAimVec: Vec2 = { x: 0, y: 0 };
  private chestView: ChestView | null = null;
  private readonly pickupView = new PickupView();
  private interactKey = '';
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
      this.session = new OfflineSession(physics, spawn, 'Jugador', layout.chests);
      this.attachSession(this.session);
      this.avatar = new PlayerAvatar(0, this.quality.shadows);
      this.engine.scene.add(this.avatar.root);
      const first = this.session.localPlayer();
      if (first) this.avatar.pushState(first, true);
      this.avatar.render(1, 0);
      this.cameras = new CameraController(this.engine.iso, (o, d, max, r) => physics.castCameraSphere(o, d, max, r));
      this.engine.onResize = (aspect) => this.cameras?.resize(aspect);
      this.cameras.resize(this.engine.aspect ?? 1);
      this.cameras.setMode(this.pendingMode, first?.yaw ?? 0);
      this.cameras.snapTo(this.avatar.position);
      this.engine.activeCamera = this.cameras.camera;

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
    // Edificios con interior: todos en un BatchedMesh (1 draw call); cada uno con su
    // vista recortable para cuando el jugador entra. El resto (sin interior), en un lote estático.
    const interiors = layout.structures.filter((p) => p.def.interior);
    const buildings = new InteriorBatch(interiors, this.quality.shadows);
    scene.add(buildings.mesh);
    this.shadowCasters.push(buildings.mesh);
    interiors.forEach((placed, i) => {
      const view = new PrefabView(placed, this.quality.shadows, { setVisible: (v) => buildings.setVisible(i, v) });
      this.structures.push(view);
      scene.add(view.root);
      this.shadowCasters.push(...view.root.children);
    });
    const batch = createStaticPrefabBatch(layout.structures.filter((p) => !p.def.interior && p.def.id !== 'chest'), this.quality.shadows);
    if (batch) {
      scene.add(batch);
      this.shadowCasters.push(batch);
    }
    const trees: Group = createTrees(layout.trees, layout.seed, this.quality.shadows);
    scene.add(trees);
    // Cofres y objetos: instanciados (2 + 3 draw calls para todos).
    this.chestView = new ChestView(layout.chests, this.quality.shadows);
    scene.add(this.chestView.body, this.chestView.lid);
    for (const m of Object.values(this.pickupView.meshes)) scene.add(m);
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
    const input = this.input.sample(this.buildSampleContext());
    if (this.engine.contextLost || this.inputSuspended) {
      // Sin gráficos (o con Ajustes abiertos) no se juega a ciegas: entrada neutra
      // (la conexión y la gravedad siguen).
      input.moveX = 0;
      input.moveZ = 0;
      input.buttons = 0;
    }
    const slot = this.input.consumeSlotRequest(session.match.inventory?.selected ?? 0);
    if (slot !== null && !this.inputSuspended) session.selectSlot(slot);
    session.tick(input, dt);
    this.updateInteractTarget(session);
    const local = session.localPlayer();
    if (local) this.avatar.pushState(local);
    this.syncRemotes(session);
  }

  private render(alpha: number, dt: number): void {
    const avatar = this.avatar;
    if (!avatar) return;
    avatar.render(alpha, dt);
    const cameras = this.cameras;
    // Mirada (ratón, táctil, mando, Q/E) a la frecuencia de render: respuesta inmediata.
    if (cameras) {
      const look = this.input.consumeLook(dt);
      if (!this.inputSuspended) cameras.addLook(look.yaw, look.pitch);
    }
    // Los remotos fuera de cámara solo se mueven: no se calcula su animación.
    const cam = cameras ? cameras.camera : this.engine.iso.camera;
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
    if (cameras) {
      if (zoom !== 0 && !this.inputSuspended) cameras.addZoom(zoom);
      cameras.update(p, avatar.velocity.x, avatar.velocity.z, dt);
      this.engine.activeCamera = cameras.camera;
      avatar.root.visible = !cameras.hideAvatar;
      this.lighting.follow(cameras.focus);
    }
    // El "corte" de techos y paredes es propio de la vista isométrica.
    const cutaway = !cameras || cameras.mode === 'isometric';
    for (const s of this.structures) s.update(p.x, p.y, p.z, dt, cutaway);
    this.chestView?.update(dt);
    this.pickupView.animate(dt);

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

  /** Perspectiva actual. */
  get cameraMode(): CameraMode {
    return this.cameras?.mode ?? this.pendingMode;
  }

  /**
   * Cambia la perspectiva (solo desde Ajustes). Es SOLO vista: la simulación,
   * las colisiones y lo que se envía al servidor no cambian de formato.
   */
  setCameraMode(mode: CameraMode): void {
    this.pendingMode = mode;
    const cameras = this.cameras;
    if (!cameras || !this.avatar) return;
    cameras.setMode(mode, this.session?.localPlayer()?.yaw ?? cameras.yaw);
    cameras.snapTo(this.avatar.position);
    this.engine.activeCamera = cameras.camera;
    this.events.emit('camera', mode);
  }

  setLookSettings(s: LookSettings): void {
    this.input.look = { ...s };
  }

  /** Pausa la entrada (Ajustes/editor de HUD abiertos). La partida y la red siguen. */
  setInputSuspended(v: boolean): void {
    this.inputSuspended = v;
    if (v) this.input.touch.reset();
  }

  /** Posiciones para el minimapa (se consulta pocas veces por segundo). */
  minimapState(): {
    size: number;
    local: { x: number; z: number; yaw: number } | null;
    others: { x: number; z: number }[];
    chests: { x: number; z: number; opened: boolean }[];
  } {
    const local = this.session?.localPlayer();
    const m = this.session?.match;
    return {
      size: this.layout?.terrain.size ?? 0,
      local: local ? { x: local.position.x, z: local.position.z, yaw: local.yaw } : null,
      others: [...this.remotes.values()].map((r) => ({ x: r.position.x, z: r.position.z })),
      chests: (m?.chests ?? []).map((c) => ({ x: c.x, z: c.z, opened: m?.opened[c.id] ?? false })),
    };
  }

  /** Inventario propio actual (lo decide la autoridad). */
  get inventory(): Inventory | null {
    return this.session?.match.inventory ?? null;
  }

  /** Elegir hueco desde el HUD (toque/clic en el inventario). */
  selectSlot(slot: number): void {
    if (!this.inputSuspended) this.session?.selectSlot(slot);
  }

  /** Botón Abrir/Recoger del HUD: pulsa la acción de interacción en el próximo tick. */
  pressInteract(): void {
    if (!this.inputSuspended) this.input.pulse(Buttons.INTERACT);
  }

  /** Conecta la sesión con las vistas de cofres/objetos y el HUD. */
  private attachSession(session: GameSession): void {
    session.onMatchEvent = (e) => this.onMatchEvent(e);
    this.chestView?.sync(session.match.opened);
    this.pickupView.reset(session.match.pickups.values());
    this.interactKey = '';
    const inv = session.match.inventory;
    if (inv) this.events.emit('inventory', inv);
  }

  private onMatchEvent(e: ClientMatchEvent): void {
    switch (e.type) {
      case 'chestOpened':
        this.chestView?.setOpened(e.chestId, true);
        break;
      case 'pickupAdded':
      case 'pickupUpdated':
        this.pickupView.add(e.pickup);
        if (e.type === 'pickupUpdated') this.pickupView.update(e.pickup);
        break;
      case 'pickupRemoved':
        this.pickupView.remove(e.id);
        break;
      case 'inventory':
        this.events.emit('inventory', e.inventory);
        break;
      case 'notice':
        this.events.emit('notice', e.code);
        break;
      case 'reset':
        if (this.session) {
          this.chestView?.sync(this.session.match.opened);
          this.pickupView.reset(this.session.match.pickups.values());
          const inv = this.session.match.inventory;
          if (inv) this.events.emit('inventory', inv);
        }
        break;
    }
  }

  /** Calcula (con las mismas reglas que el servidor) qué se puede abrir o recoger. */
  private updateInteractTarget(session: GameSession): void {
    const local = session.localPlayer();
    const physics = this.physics;
    if (!local || !physics) return;
    const m = session.match;
    const t: InteractTarget | null = findTarget(m.chests, m.opened, m.pickups.values(), local.position, (a, b) => physics.lineOfSight(a, b));
    const key = t ? `${t.type}:${t.id}:${t.type === 'pickup' ? m.pickups.get(t.id)?.item.qty : ''}` : '';
    if (key === this.interactKey) return;
    this.interactKey = key;
    if (!t) return this.events.emit('interact', null);
    if (t.type === 'chest') return this.events.emit('interact', { type: 'chest', id: t.id, action: 'Abrir', label: 'Cofre' });
    const p = m.pickups.get(t.id);
    this.events.emit('interact', { type: 'pickup', id: t.id, action: 'Recoger', label: p ? itemName(p.item) : 'Objeto' });
  }

  get worldLayout(): WorldLayout | null {
    return this.layout;
  }

  private buildSampleContext(): SampleContext {
    const c = this.sampleCtx;
    const cameras = this.cameras;
    const mode = cameras?.mode ?? 'isometric';
    c.cameraYaw = mode === 'isometric' ? null : (cameras?.yaw ?? 0);
    c.alwaysAim = mode === 'first';
    c.mouseAim = null;
    // Isométrica + botón derecho: apuntar hacia el cursor (respecto al personaje en pantalla).
    if (mode === 'isometric' && this.input.mouse.aimHeld && this.avatar && cameras) {
      const rect = this.engine.canvas.getBoundingClientRect();
      this.projected.copy(this.avatar.position).setY(this.avatar.position.y + 1).project(cameras.camera);
      const px = rect.left + ((this.projected.x + 1) / 2) * rect.width;
      const py = rect.top + ((1 - this.projected.y) / 2) * rect.height;
      const dx = this.input.mouse.cursor.x - px;
      const dy = py - this.input.mouse.cursor.y;
      const len = Math.hypot(dx, dy);
      if (len > 8) {
        this.mouseAimVec.x = dx / len;
        this.mouseAimVec.y = dy / len;
        c.mouseAim = this.mouseAimVec;
      }
    }
    return c;
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
        chests: this.layout.chests,
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
      this.attachSession(online);
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
    // Sin conexión la partida empieza de nuevo: cofres cerrados y el hacha de siempre.
    this.session = new OfflineSession(this.physics, pos, 'Jugador', this.layout?.chests ?? []);
    this.attachSession(this.session);
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
    camera: { mode: CameraMode; distance: number; hit: number | null; yaw: number; avatarVisible: boolean };
  } {
    return {
      camera: {
        mode: this.cameraMode,
        distance: this.cameras?.distance ?? 0,
        hit: this.cameras?.lastHit ?? null,
        yaw: this.cameras?.yaw ?? 0,
        avatarVisible: this.avatar?.root.visible ?? true,
      },
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
