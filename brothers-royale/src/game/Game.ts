import { NameTags } from './entities/NameTags';
import type { Profile } from '@shared/lobby/profile';
import { loadProfile } from './profile';
import { StormView } from './world/StormView';
import { contains } from '@shared/battle/zone';
import { BuildingWorld } from '@/physics/BuildingWorld';
import { BuildingView } from './world/BuildingView';
import { buildTop, type BuildKind, type BuildRequest } from '@shared/building/BuildingState';
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
import { PerspectiveCamera, Frustum, Matrix4, Sphere, type Group, type Object3D } from 'three';
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
import { addItem, type Inventory } from '@shared/inventory';
import { itemName } from '@shared/items';
import { findTarget, type InteractTarget, type NoticeCode } from '@shared/match/MatchState';
import { createTerrainMesh, createWater } from './world/Terrain';
import { CombatFx } from './combat/CombatFx';
import { CombatOverlay } from './combat/CombatOverlay';
import { LocalWeapon } from './combat/LocalWeapon';
import { SoundFx, type SoundName } from './combat/SoundFx';
import { GRIP_IN_ARM, heldKey, MUZZLE, WeaponBatch, type HeldKind } from './combat/WeaponModels';
import type { ClientCombatEvent } from '@/net/CombatView';
import { fullVitals } from '@/net/CombatView';
import type { Vitals } from '@shared/combat/CombatState';
import { packGear, unpackGear } from '@shared/combat/gear';
import { applySpread, rayHitbox } from '@shared/combat/hitscan';
import { AIM_PITCH_LIMIT, directionFromAim, EYE_HEIGHT, MELEE, rarityOf, WEAPON_STATS } from '@shared/combat/weapons';
import { createRng } from '@shared/random';
import { wrapAngle } from '@shared/math';
import type { PlayerInput } from '@shared/types';
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
  skin?:number;
  mode?:'create'|'join'|'quick';
  visibility?:'private'|'public';
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

/** Entrada del registro de bajas visible (killfeed). */
export interface KillFeedEntry {
  killer: string;
  victim: string;
  weapon: string;
  /** La baja la hizo el jugador local / el eliminado es el jugador local. */
  mine: boolean;
  me: boolean;
}

export type GameEvents = {
  vitals: Vitals;
  killfeed: KillFeedEntry;
  /** Te eliminó… (nombre de quien lo hizo). */
  eliminated: { by: string };
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
  private buildingWorld: BuildingWorld | null = null;
  private buildingView: BuildingView | null = null;
  private stormView: StormView | null = null;
  private spectatedId: string | null = null;
  private buildOpen = false;
  private buildKind: BuildKind = 'wall';
  private buildRotation = 0;
  private buildLevel = 0;
  private buildHeld = false;
  private buildFireHeld = false;
  private buildCandidate: BuildRequest | null = null;
  private buildValid = false;
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
  // --- Combate (fase 6): solo vista, sonido y predicción visual ---------------
  /** Lo que llevan en la mano: se aloja en el lote de edificios al crear el mundo. */
  private weapons = new WeaponBatch();
  private readonly fx = new CombatFx();
  readonly sound = new SoundFx();
  private readonly nameTags=typeof document==='undefined'?null:new NameTags();
  private readonly overlay: CombatOverlay | null = typeof document === 'undefined' ? null : new CombatOverlay();
  private readonly localWeapon = new LocalWeapon();
  private vitals: Vitals = fullVitals();
  private readonly fxRng = createRng(0xf00d);
  /** Matriz de lo que lleva en la mano cada avatar (para la boca del cañón). */
  private readonly heldMatrix = new Map<string, Matrix4>();
  private readonly mTmp = new Matrix4();
  private readonly vTmp = new Vector3();
  private readonly viewmodel = new Matrix4();
  private kickBack = 0;
  private lastAiming = false;
  private statsTimer = 0;
  private disposed = false;
  private presentation=false;
  private readonly lobbyCamera=new PerspectiveCamera(34,1,.1,180);
  private localColor=0;
  private sessionSerial=0;
  private readonly remoteColors=new Map<string,number>();

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
    this.engine.scene.add(this.fx.mesh);
  }

  /** Capa DOM del combate (mira, números de daño) sobre el lienzo. */
  attachOverlay(parent: HTMLElement): void {
    this.overlay?.attach(parent);
    if(this.nameTags)parent.append(this.nameTags.root);
  }

  setVolume(v: number): void {
    this.sound.volume = v;
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
      worldColliders(layout, true).forEach((c) => physics.addStatic(c));
      this.physics = physics;
      this.buildingWorld = new BuildingWorld(physics, layout, () => this.session?.players().map(p => p.position) ?? []);

      report(0.8, 'Llamando a tu personaje');
      const spawn = { x: layout.spawn.x, y: terrainHeight(layout.spawn.x, layout.spawn.z, layout.terrain) + 0.1, z: layout.spawn.z };
      this.session = new OfflineSession(physics, spawn, 'Jugador', layout.chests, undefined, this.dummySpots(layout), this.buildingWorld);
      this.attachSession(this.session);
      const profile=loadProfile();this.session.setProfile?.(profile);this.localColor=profile.skin;
      this.avatar = new PlayerAvatar(profile.skin, this.quality.shadows);
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

  /** Muñecos de práctica sin conexión: delante del punto de aparición, en el suelo. */
  private dummySpots(layout: WorldLayout): { x: number; y: number; z: number }[] {
    const s = layout.spawn;
    return [
      { x: s.x + 7, z: s.z + 4 },
      { x: s.x + 9, z: s.z - 1.5 },
      { x: s.x + 13, z: s.z + 2 },
    ].map((p) => ({ ...p, y: terrainHeight(p.x, p.z, layout.terrain) }));
  }

  private buildWorldVisuals(layout: WorldLayout): void {
    const scene = this.engine.scene;
    scene.add(createWater(layout.terrain.size));
    scene.add(createTerrainMesh(layout.terrain));
    // Edificios con interior: todos en un BatchedMesh (1 draw call); cada uno con su
    // vista recortable para cuando el jugador entra. El resto (sin interior), en un lote estático.
    const interiors = layout.structures.filter((p) => p.def.interior);
    const buildings = new InteriorBatch(interiors, this.quality.shadows, WeaponBatch.reserve());
    scene.add(buildings.mesh);
    // Armas, hacha y botiquines en la mano: en el MISMO lote (0 draw calls extra).
    this.weapons.dispose();
    this.weapons = new WeaponBatch(buildings.mesh);
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
    this.stormView = new StormView(layout.terrain); scene.add(this.stormView.line);
    this.buildingView = new BuildingView(layout.trees, trees);
    scene.add(this.buildingView.root);
    this.buildingView.setShadows(this.quality.shadows);
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
    if (this.vitals.dead || session.battle?.phase === 'finished') {
      // Eliminado: no se mueve ni actúa (la autoridad hace lo mismo).
      input.moveX = 0;
      input.moveZ = 0;
      input.buttons = 0;
    }
    const slot = this.input.consumeSlotRequest(session.match.inventory?.selected ?? 0);
    if (slot !== null && !this.inputSuspended) session.selectSlot(slot);
    this.computeAim(session, input);
    this.buildStep(input);
    const attack = this.localWeapon.tick(input, session.match.inventory, this.vitals, dt);
    if (attack) this.playLocalAttack(session, input, attack.type === 'shot' ? attack.weapon : 'axe');
    this.lastAiming = (input.buttons & Buttons.AIM) !== 0;
    session.tick(input, dt);
    this.updateInteractTarget(session);
    const local = session.localPlayer();
    if (local) {
      local.gear = this.localGear(session);
      this.avatar.pushState(local);
    }
    const color=session.identity(session.localPlayerId).color;
    if(color!==this.localColor)this.replaceLocalAvatar(color);
    this.syncRemotes(session);
  }

  /** Vista y controles del constructor; la autoridad vuelve a validar cada petición. */
  get buildingUi() {
    return { open: this.buildOpen, kind: this.buildKind, rotation: this.buildRotation, level: this.buildLevel,
      wood: this.buildingWorld?.state.wood.get(this.session?.localPlayerId ?? '') ?? 0, valid: this.buildValid };
  }
  configureBuild(kind?: BuildKind, rotate = false, levelDelta = 0): void {
    if (kind) { this.buildKind = kind; this.buildOpen = true; }
    if (rotate) this.buildRotation = (this.buildRotation + 1) % 4;
    this.buildLevel = Math.max(0, Math.min(4, this.buildLevel + levelDelta));
  }
  toggleBuild(): void { this.buildOpen = !this.buildOpen; }
  placeBuild(): boolean {
    return !!this.buildCandidate && !!this.session?.requestBuild?.(this.buildCandidate);
  }
  private buildStep(input: PlayerInput): void {
    const toggle = (input.buttons & Buttons.BUILD) !== 0;
    if (toggle && !this.buildHeld) this.toggleBuild();
    this.buildHeld = toggle;
    const fire = (input.buttons & Buttons.FIRE) !== 0;
    const feet = this.session?.localPlayer()?.position;
    const world = this.buildingWorld;
    if (feet && world && this.buildOpen) {
      const x = Math.round((feet.x + Math.sin(input.aimYaw) * 4) / 3) * 3;
      const z = Math.round((feet.z + Math.cos(input.aimYaw) * 4) / 3) * 3;
      const ground = terrainHeight(x, z, world.layout.terrain);
      let base = ground;
      for (const p of world.state.pieces.values()) if (Math.abs(p.x - x) < 1.6 && Math.abs(p.z - z) < 1.6 && buildTop(p) <= feet.y + 3.1) base = Math.max(base, buildTop(p));
      this.buildCandidate = { kind: this.buildKind, x, y: base + this.buildLevel * 3, z, rotation: this.buildRotation };
      this.buildValid = !this.vitals.dead && this.session?.battle?.phase !== 'finished' && world.state.canPlace(this.session!.localPlayerId, this.buildCandidate, feet);
      if (fire && !this.buildFireHeld && this.buildValid) this.placeBuild();
      input.buttons &= ~Buttons.FIRE;
    }
    this.buildFireHeld = fire;
  }

  /** Estado de combate visible del jugador local (lo mismo que verán los demás). */
  private localGear(session: GameSession): number {
    const inv = session.match.inventory;
    const item = inv?.slots[inv.selected] ?? null;
    const v = this.vitals;
    const action = v.reload > 0 ? 'reload' : v.heal > 0 ? 'heal' : this.lastAiming ? 'aim' : 'none';
    return packGear({ held: item?.kind ?? null, rarity: rarityOf(item?.rarity), action, dead: v.dead });
  }

  /**
   * Dirección del disparo (yaw + pitch desde los ojos). En 1ª/3ª persona: hacia
   * el punto que hay en el centro de la pantalla (lo que tapa una pared, lo
   * tapa también para el servidor). En isométrica: el yaw de apuntado y una
   * ligera ayuda vertical hacia el pecho del rival más alineado.
   */
  private computeAim(session: GameSession, input: PlayerInput): void {
    const local = session.localPlayer();
    const cams = this.cameras;
    const physics = this.physics;
    if (!local || !cams || !physics) return;
    const ex = local.position.x;
    const ey = local.position.y + EYE_HEIGHT;
    const ez = local.position.z;
    if (cams.mode !== 'isometric') {
      const cam = cams.perspective;
      const o = cam.position;
      const f = cams.forward();
      const origin = { x: o.x, y: o.y, z: o.z };
      const dir = { x: f.x, y: f.y, z: f.z };
      let t = physics.castStatic(origin, dir, 150) ?? 150;
      for (const st of session.players()) {
        if (st.id === session.localPlayerId) continue;
        const h = rayHitbox(origin, dir, st.position, t);
        if (h !== null) t = h;
      }
      let dx = o.x + f.x * t - ex;
      let dy = o.y + f.y * t - ey;
      let dz = o.z + f.z * t - ez;
      if (dx * f.x + dy * f.y + dz * f.z < 1) {
        dx = f.x;
        dy = f.y;
        dz = f.z;
      }
      input.aimYaw = wrapAngle(Math.atan2(dx, dz));
      input.aimPitch = Math.max(-AIM_PITCH_LIMIT, Math.min(AIM_PITCH_LIMIT, Math.atan2(dy, Math.hypot(dx, dz))));
      return;
    }
    // Isométrica: sin apuntar se dispara hacia donde mira el personaje.
    if ((input.buttons & Buttons.AIM) === 0) input.aimYaw = local.yaw;
    let best = 0.2; // ±11° de ayuda vertical (nunca cambia el yaw)
    let pitch = 0;
    for (const st of session.players()) {
      if (st.id === session.localPlayerId) continue;
      if (unpackGear(st.gear).dead) continue;
      const dx = st.position.x - ex;
      const dz = st.position.z - ez;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.5 || dist > 50) continue;
      const off = Math.abs(wrapAngle(Math.atan2(dx, dz) - input.aimYaw));
      if (off >= best) continue;
      best = off;
      pitch = Math.atan2(st.position.y + 1.0 - ey, dist);
    }
    input.aimPitch = Math.max(-AIM_PITCH_LIMIT, Math.min(AIM_PITCH_LIMIT, pitch));
  }

  /** Efectos inmediatos del ataque propio (predicción visual: el servidor decide si acierta). */
  private playLocalAttack(session: GameSession, input: PlayerInput, weapon: HeldKind | 'axe'): void {
    const local = session.localPlayer();
    const physics = this.physics;
    if (!local || !physics) return;
    const eye = { x: local.position.x, y: local.position.y + EYE_HEIGHT, z: local.position.z };
    if (weapon === 'axe') {
      this.avatar?.swing();
      this.sound.play('axe');
      this.kickBack = MELEE.kick;
      return;
    }
    if (weapon === 'medkit') return;
    const kind = weapon;
    const inv = session.match.inventory;
    const s = WEAPON_STATS[kind];
    const muzzle = this.muzzleOf(session.localPlayerId, kind) ?? eye;
    const base = directionFromAim(input.aimYaw, input.aimPitch ?? 0);
    const spread = this.localWeapon.spread(inv, (input.buttons & Buttons.AIM) !== 0, Math.hypot(local.velocity.x, local.velocity.z), local.grounded);
    const pellets = Math.min(s.pellets, 5);
    for (let i = 0; i < pellets; i++) {
      const d = applySpread(base, spread, this.fxRng);
      let t = physics.castStatic(eye, d, s.range) ?? s.range;
      let onPlayer = false;
      for (const st of session.players()) {
        if (st.id === session.localPlayerId) continue;
        const h = rayHitbox(eye, d, st.position, t);
        if (h !== null) {
          t = h;
          onPlayer = true;
        }
      }
      const end = { x: eye.x + d.x * t, y: eye.y + d.y * t, z: eye.z + d.z * t };
      this.fx.tracer(muzzle, end);
      if (t < s.range) this.fx.impact(end, onPlayer);
    }
    this.fx.flash(muzzle, kind === 'shotgun' ? 0.14 : 0.09);
    this.sound.play(kind);
    this.avatar?.kick();
    this.kickBack = s.kick;
    // Retroceso visual de la cámara (solo vista, la dispersión real la decide el servidor).
    this.cameras?.addLook((this.fxRng() - 0.5) * s.kick * 0.4, -s.kick);
  }

  /** Boca del cañón de lo que lleva en la mano `owner` (último frame dibujado). */
  private muzzleOf(owner: string, kind: HeldKind): { x: number; y: number; z: number } | null {
    const m = this.heldMatrix.get(owner);
    if (!m) return null;
    const v = this.vTmp.set(0, 0.06, MUZZLE[kind]).applyMatrix4(m);
    return { x: v.x, y: v.y, z: v.z };
  }

  /** Eventos de combate autoritativos: FX de los demás, daño, bajas, salud y sonidos. */
  private onCombatEvent(e: ClientCombatEvent): void {
    const session = this.session;
    if (!session) return;
    const me = session.localPlayerId;
    switch (e.type) {
      case 'vitals': {
        const started = e.vitals.reload > 0 && this.vitals.reload <= 0;
        this.vitals = e.vitals;
        if (started) this.sound.play('reload');
        this.events.emit('vitals', e.vitals);
        break;
      }
      case 'shot': {
        if (e.by === me) break; // ya se mostró con la predicción visual
        const muzzle = this.muzzleOf(e.by, e.weapon) ?? e.origin;
        const step = Math.max(1, Math.floor(e.ends.length / 4)); // escopeta: unas pocas trazadoras
        for (let i = 0; i < e.ends.length; i += step) {
          this.fx.tracer(muzzle, e.ends[i]!);
          this.fx.impact(e.ends[i]!, e.hits[i]!);
        }
        this.fx.flash(muzzle, e.weapon === 'shotgun' ? 0.14 : 0.09);
        this.remotes.get(e.by)?.kick();
        this.playAt(e.weapon, e.origin);
        break;
      }
      case 'melee':
        if (e.by === me) break;
        this.remotes.get(e.by)?.swing();
        if (e.hit) this.fx.impact(e.end, true);
        this.playAt('axe', e.origin);
        break;
      case 'damage':
        if (e.by === me) {
          this.overlay?.damage(e.at, e.amount, e.hp <= 0);
          this.overlay?.hit(e.hp <= 0);
          this.sound.play(e.hp <= 0 ? 'kill' : 'hit');
        }
        if (e.victim === me) {
          this.overlay?.hurtFlash();
          this.sound.play('hurt');
        }
        break;
      case 'death': {
        const killer = e.weapon === 'storm' ? 'Tormenta' : e.weapon === 'fall' ? 'Caída' : e.killer === me ? 'Tú' : session.identity(e.killer).name;
        const victim = e.victim === me ? 'ti' : session.identity(e.victim).name;
        this.events.emit('killfeed', { killer, victim, weapon: e.weapon, mine: e.killer === me, me: e.victim === me });
        if (e.victim === me) this.events.emit('eliminated', { by: e.killer === me ? 'ti mismo' : killer });
        break;
      }
      case 'healed':
        this.sound.play('heal');
        break;
      case 'empty':
        this.sound.play('empty');
        break;
      case 'respawn':
        break;
    }
  }

  /** Sonido posicional sencillo respecto al jugador local y la cámara. */
  private playAt(name: SoundName, at: { x: number; y: number; z: number }): void {
    const p = this.avatar?.position;
    if (!p) return this.sound.play(name);
    const dx = at.x - p.x;
    const dz = at.z - p.z;
    const dist = Math.hypot(dx, dz);
    // Derecha de la cámara: en isométrica es (+1, 0, -1)/√2; en perspectiva, según su yaw.
    const yaw = this.cameras && this.cameras.mode !== 'isometric' ? this.cameras.yaw : Math.PI * 0.75;
    const rx = -Math.cos(yaw);
    const rz = Math.sin(yaw);
    const pan = dist > 0.5 ? (dx * rx + dz * rz) / dist : 0;
    this.sound.play(name, dist, pan * 0.8);
  }

  /** Coloca armas, hacha y botiquines en la mano de todos (y el arma de 1ª persona). */
  private placeHeldItems(dt: number): void {
    const w = this.weapons;
    w.begin();
    const session = this.session;
    const cams = this.cameras;
    const first = cams?.mode === 'first';
    const place = (owner: string, av: PlayerAvatar) => {
      const g = av.gear;
      if (!g.held || av.downed || !av.root.visible) return;
      av.root.updateMatrixWorld(true);
      const m = this.heldMatrix.get(owner) ?? new Matrix4();
      m.multiplyMatrices(av.handBone.matrixWorld, GRIP_IN_ARM);
      this.heldMatrix.set(owner, m);
      w.place(owner, heldKey(g.held as HeldKind, g.rarity), m);
    };
    if (session && this.avatar) {
      if (first && cams && !this.vitals.dead) {
        // 1ª persona: el arma delante de la cámara, con retroceso y bajada al recargar.
        const g = this.avatar.gear;
        if (g.held) {
          this.kickBack = Math.max(0, this.kickBack - dt * 0.6);
          const reload = g.action === 'reload' ? 0.12 : 0;
          const cam = cams.perspective;
          cam.updateMatrixWorld();
          this.mTmp.makeRotationY(Math.PI).scale(this.vTmp.set(0.72, 0.72, 0.72));
          this.viewmodel.makeTranslation(0.19, -0.19 - reload, -0.3 + this.kickBack * 1.2).multiply(this.mTmp);
          this.viewmodel.premultiply(cam.matrixWorld);
          const m = this.heldMatrix.get(session.localPlayerId) ?? new Matrix4();
          m.copy(this.viewmodel);
          this.heldMatrix.set(session.localPlayerId, m);
          w.place(session.localPlayerId, heldKey(g.held as HeldKind, g.rarity), m);
        }
      } else {
        place(session.localPlayerId, this.avatar);
      }
    }
    for (const [id, av] of this.remotes) place(id, av);
    w.end();
  }

  private render(alpha: number, dt: number): void {
    const avatar = this.avatar;
    if (!avatar) return;
    avatar.render(alpha, dt);
    if (this.buildingWorld) this.buildingView?.update(this.buildingWorld.state.snapshot(), dt);
    this.buildingView?.preview(this.buildOpen ? this.buildCandidate : null, this.buildValid);
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
    const battle = this.session?.battle;
    const spectator = (this.vitals.lives ?? 3) === 0;
    const targets = spectator ? [...this.remotes.keys()].filter(id => (battle?.players.find(p => p.id === id)?.lives ?? 0) > 0) : [];
    if (!spectator) this.spectatedId = null;
    else if (!this.spectatedId || !targets.includes(this.spectatedId)) this.spectatedId = targets[0] ?? null;
    const watched = this.spectatedId ? this.remotes.get(this.spectatedId) : null;
    const followed = watched ?? avatar;
    const p = followed.position;
    this.stormView?.update(battle?.phase === 'running' ? battle.zone.current : null);
    const zoom = this.input.consumeZoom();
    if (cameras) {
      if (zoom !== 0 && !this.inputSuspended) cameras.addZoom(zoom);
      cameras.update(p, followed.velocity.x, followed.velocity.z, dt);
      this.engine.activeCamera = cameras.camera;
      avatar.root.visible = !spectator && !cameras.hideAvatar;
      for (const [id, remote] of this.remotes) remote.root.visible = !(spectator && id === this.spectatedId && cameras.mode === 'first');
      this.lighting.follow(cameras.focus);
    }
    if(this.presentation){
      this.lobbyCamera.aspect=this.engine.aspect??1;this.lobbyCamera.updateProjectionMatrix();
      this.lobbyCamera.position.set(avatar.position.x+2.8,avatar.position.y+1.7,avatar.position.z+4.3);
      this.lobbyCamera.lookAt(avatar.position.x,avatar.position.y+1,avatar.position.z);
      this.engine.activeCamera=this.lobbyCamera;avatar.root.visible=true;
      for(const av of this.remotes.values())av.root.visible=false;
    }
    // El "corte" de techos y paredes es propio de la vista isométrica.
    const cutaway = !cameras || cameras.mode === 'isometric';
    for (const s of this.structures) s.update(p.x, p.y, p.z, dt, cutaway);
    this.chestView?.update(dt);
    this.pickupView.animate(dt);
    this.placeHeldItems(dt);
    this.fx.update(dt);
    if (cameras) cameras.aiming = this.lastAiming && !this.vitals.dead;
    if (this.overlay) {
      const rect = this.engine.canvas.getBoundingClientRect();
      let gap = 0;
      const inv = this.session?.match.inventory ?? null;
      const item = inv?.slots[inv.selected];
      if (cameras && cameras.mode !== 'isometric' && item && (item.kind === 'axe' || WEAPON_STATS[item.kind as keyof typeof WEAPON_STATS]) && !this.vitals.dead) {
        const spread = this.localWeapon.spread(inv, this.lastAiming, Math.hypot(avatar.velocity.x, avatar.velocity.z), true);
        const half = ((cameras.perspective.fov * Math.PI) / 180) / 2;
        gap = 5 + (Math.tan(spread) / Math.tan(half)) * (rect.height / 2);
      }
      this.overlay.root.style.visibility=this.presentation?'hidden':'visible';
      this.overlay.frame(cam, rect.width, rect.height, dt, gap);
    }

    if(this.nameTags){
      this.nameTags.root.hidden=this.presentation;
      if(!this.presentation){
        const session=this.session,all=this.allAvatars();
        const entries=function*(){for(const av of all){const id=av===avatar?session?.localPlayerId??'':av.root.name.replace('remote:','');yield{id,name:session?.identity(id).name??'',position:av.position,shown:av.root.visible};}};
        const rect=this.engine.canvas.getBoundingClientRect();
        this.nameTags.frame(entries(),this.engine.activeCamera??cam,rect.width,rect.height,dt,(a,b)=>this.physics?.lineOfSight(a,b)??false);
      }
    }
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
    zone?: import('@shared/battle/zone').ZoneState;
  } {
    const local = this.session?.localPlayer();
    const m = this.session?.match;
    return {
      size: this.layout?.terrain.size ?? 0,
      zone: this.session?.battle?.phase === 'running' ? this.session.battle.zone : undefined,
      local: local ? { x: local.position.x, z: local.position.z, yaw: local.yaw } : null,
      others: [...this.remotes.values()].map((r) => ({ x: r.position.x, z: r.position.z })),
      chests: (m?.chests ?? []).map((c) => ({ x: c.x, z: c.z, opened: m?.opened[c.id] ?? false })),
    };
  }

  setPresentation(value:boolean):void{this.presentation=value;}
  getFrontendState(){return{...this.lobbyUi,sessionKey:this.sessionSerial};}
  returnToMenu():void{if(this.online())this.goOffline();else (this.session as OfflineSession|null)?.resetPractice?.();}
  get lobbyUi(){return{lobby:this.session?.lobby,localId:this.session?.localPlayerId??'',battle:this.session?.battle,error:this.online()?.lobbyError??'',net:this.netStatus};}
  lobbyReady(ready:boolean):void{this.session?.lobbyReady?.(ready);}
  updateProfile(profile:Profile):void{this.session?.setProfile?.(profile);}
  returnToLobby():boolean{return this.session?.returnToLobby?.()??false;}
  rematch():boolean{return this.session?.rematch?.()??false;}
  get battleUi() {
    const round = this.session?.battle;
    const local = this.session?.localPlayer();
    const player = round?.players.find(p => p.id === this.session?.localPlayerId);
    const viewpoint = this.spectatedId ? this.remotes.get(this.spectatedId)?.position : local?.position;
    return { round, offline: this.session?.kind === 'offline', protection: player?.protection ?? 0,
      descending: player?.descending ?? false, spectator: (this.vitals.lives ?? 3) === 0,
      target: this.spectatedId ? this.session?.identity(this.spectatedId).name : null,
      outside: !!round && round.phase === 'running' && !!viewpoint && !contains(round.zone.current, viewpoint) };
  }
  startRound(): void { this.session?.startRound?.(); }
  spectateNext(direction = 1): void {
    const ids = this.session?.battle?.players.filter(p => p.id !== this.session?.localPlayerId && p.lives > 0).map(p => p.id) ?? [];
    const index = ids.indexOf(this.spectatedId ?? '');
    this.spectatedId = ids[(index + direction + ids.length) % ids.length] ?? null;
  }

  /** Salud y acciones propias actuales (lo decide la autoridad). */
  get currentVitals(): Vitals {
    return this.vitals;
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
    this.sessionSerial++;
    session.onMatchEvent = (e) => this.onMatchEvent(e);
    session.onCombatEvent = (e) => this.onCombatEvent(e);
    this.vitals = { ...session.combat.vitals };
    this.events.emit('vitals', this.vitals);
    this.localWeapon.sync(session.match.inventory);
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
        this.localWeapon.sync(e.inventory);
        this.events.emit('inventory', e.inventory);
        break;
      case 'notice':
        this.events.emit('notice', e.code);
        break;
      case 'reset':
        this.buildOpen = false; this.buildCandidate = null; this.spectatedId = null;
        this.localWeapon.sync(this.session?.match.inventory ?? null);
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
    this.buildingView?.setShadows(q.shadows);
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
      const color=session.identity(st.id).color;
      if(av&&this.remoteColors.get(st.id)!==color){av.dispose();this.remotes.delete(st.id);av=undefined;}
      if (!av) {
        av = new PlayerAvatar(session.identity(st.id).color, this.quality.shadows);
        av.root.name = `remote:${st.id}`;
        this.engine.scene.add(av.root);
        this.remotes.set(st.id, av);
        this.remoteColors.set(st.id,color);
        av.pushState(st, true);
      } else {
        av.pushState(st);
      }
    }
    for (const [id, av] of this.remotes) {
      if (seen.has(id)) continue;
      av.dispose();
      this.remotes.delete(id);
      this.remoteColors.delete(id);
      this.weapons.release(id);
      this.heldMatrix.delete(id);
    }
  }

  private clearRemotes(): void {
    for (const [id, av] of this.remotes) {
      av.dispose();
      this.weapons.release(id);
      this.heldMatrix.delete(id);
    }
    this.remotes.clear();
    this.remoteColors.clear();
  }

  /** Sustituye el avatar local (p. ej. para usar el color asignado por la sala). */
  private replaceLocalAvatar(color: number): void {
    const local = this.session?.localPlayer();
    if (!local) return;
    this.avatar?.dispose();
    this.localColor=color;
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
        building: this.buildingWorld ?? undefined,
        signal: abort.signal,
        url: req.url,
        name: req.name,skin:req.skin??loadProfile().skin,mode:req.mode,visibility:req.visibility,
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
      if (old) {
        this.weapons.release(old.localPlayerId);
        this.heldMatrix.delete(old.localPlayerId);
      }
      this.clearRemotes();
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
    this.weapons.release(online.localPlayerId);
    this.heldMatrix.delete(online.localPlayerId);
    this.session = new OfflineSession(this.physics, pos, 'Jugador', this.layout?.chests ?? [], undefined, this.layout ? this.dummySpots(this.layout) : [], this.buildingWorld ?? undefined);
    this.attachSession(this.session);
    this.session.setProfile?.(loadProfile());
    this.replaceLocalAvatar(loadProfile().skin);
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
    combat: { vitals: Vitals; heldItems: number; fx: number };
  } {
    return {
      combat: { vitals: { ...this.vitals }, heldItems: this.weapons.count, fx: this.fx.active },
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

  /** Solo depuración (?debug, sin conexión): da un objeto al jugador local. */
  debugGive(item: import('@shared/items').ItemStack): void {
    const s = this.session;
    if (!(s instanceof OfflineSession)) return;
    const inv = s.state.inventory(s.localPlayerId);
    if (!inv) return;
    s.state.setInventory(s.localPlayerId, addItem(inv, item).inventory);
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
    this.weapons.dispose();
    this.fx.dispose();
    this.overlay?.dispose();
    this.nameTags?.dispose();
    this.sound.dispose();
    this.stormView?.dispose();
    this.buildingView?.dispose();
    this.engine.dispose();
    this.input.dispose();
    this.session?.dispose();
    this.buildingWorld?.dispose();
    this.physics?.dispose();
    disposeAvatarResources();
    this.events.clear();
  }
}
