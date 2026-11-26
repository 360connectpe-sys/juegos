import { EventBus } from '@/core/EventBus';
import { Engine } from '@/engine/Engine';
import { FixedStepLoop } from '@/engine/FixedStepLoop';
import { Lighting } from '@/engine/Lighting';
import type { QualitySettings } from '@/engine/quality';
import type { GameSession } from '@/net/GameSession';
import { OfflineSession } from '@/net/OfflineSession';
import { loadRapier, PhysicsWorld } from '@/physics/PhysicsWorld';
import { SIMULATION } from '@shared/constants';
import type { InsideState } from '@shared/world/prefab';
import { worldColliders } from '@shared/world/colliders';
import { generateWorldLayout, type WorldLayout } from '@shared/world/layout';
import { terrainHeight } from '@shared/world/terrain';
import { PlayerAvatar } from './entities/PlayerAvatar';
import { InputManager } from './input/InputManager';
import type { InputDevice } from './input/sources';
import { PrefabView } from './world/PrefabView';
import { createTerrainMesh, createWater } from './world/Terrain';
import { createTrees } from './world/Trees';

export interface GameStats {
  fps: number;
  frameMs: number;
  worstMs: number;
  tier: QualitySettings['tier'];
  pixelRatio: number;
  drawCalls: number;
  triangles: number;
  tick: number;
}

export type GameEvents = {
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
  private loop: FixedStepLoop | null = null;
  private layout: WorldLayout | null = null;
  private readonly structures: PrefabView[] = [];
  private statsTimer = 0;
  private disposed = false;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly quality: QualitySettings,
    initialDevice: InputDevice = 'keyboard',
  ) {
    this.engine = new Engine(canvas, quality);
    this.input = new InputManager(window, undefined, initialDevice);
    this.input.onDeviceChange = (d) => this.events.emit('device', d);
  }

  async init(): Promise<void> {
    const report = (value: number, label: string) => this.events.emit('progress', { value, label });
    try {
      report(0.1, 'Preparando la isla');
      this.lighting = new Lighting(this.engine.scene, this.quality);
      const layout = generateWorldLayout({ treeCount: Math.round(140 * this.quality.treeDensity) });
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
      this.avatar = new PlayerAvatar(undefined, this.quality.shadows, !this.quality.shadows);
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
    for (const placed of layout.structures) {
      const view = new PrefabView(placed, this.quality.shadows);
      this.structures.push(view);
      scene.add(view.root);
    }
    scene.add(createTrees(layout.trees, layout.seed, this.quality.shadows));
  }

  private step(dt: number): void {
    if (!this.session || !this.avatar) return;
    this.session.tick(this.input.sample(), dt);
    const local = this.session.localPlayer();
    if (local) this.avatar.pushState(local);
  }

  private render(alpha: number, dt: number): void {
    const avatar = this.avatar;
    if (!avatar) return;
    avatar.render(alpha, dt);
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
        tier: this.quality.tier,
        pixelRatio: f.pixelRatio,
        drawCalls: f.drawCalls,
        triangles: f.triangles,
        tick: this.loop?.ticks ?? 0,
      });
    }
  }

  /** Para depuración y pruebas e2e (?debug). */
  debugState(): {
    trees: number;
    structures: { id: string; inside: InsideState }[];
    players: readonly import('@shared/types').PlayerState[];
    zoom: number;
  } {
    return {
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
    this.engine.dispose();
    this.input.dispose();
    this.session?.dispose();
    this.physics?.dispose();
    this.events.clear();
  }
}
