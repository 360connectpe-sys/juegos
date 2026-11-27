import {
  ACESFilmicToneMapping,
  BufferGeometry,
  BatchedMesh,
  type Camera,
  DirectionalLight,
  InstancedMesh,
  Material,
  Mesh,
  PCFShadowMap,
  Scene,
  SRGBColorSpace,
  Timer,
  WebGLRenderer,
} from 'three';
import { AdaptiveResolution } from './AdaptiveResolution';
import { ContextLossMonitor, type ContextStatus } from './ContextLossMonitor';
import { IsometricCamera } from './IsometricCamera';
import type { QualitySettings } from './quality';

export interface FrameInfo {
  fps: number;
  /** Duración media y peor frame (ms) en la última ventana de medida. */
  frameMs: number;
  worstMs: number;
  /** Tiempo de CPU del frame (lógica + envío a la GPU), media en ms. */
  cpuMs: number;
  pixelRatio: number;
  drawCalls: number;
  triangles: number;
  /** Frecuencia de pantalla estimada (Hz). */
  refreshHz: number;
}

/**
 * Núcleo de render: renderer WebGL, escena, cámara isométrica, bucle RAF,
 * redimensionado, resolución adaptativa, pérdida de contexto y pausa cuando
 * la pestaña no es visible (ahorra batería). Sin límite de FPS: se dibuja a la
 * frecuencia que dé el navegador (requestAnimationFrame).
 */
export class Engine {
  readonly renderer: WebGLRenderer;
  /** ¿La GPU admite WEBGL_multi_draw? (BatchedMesh en 1 draw call). Falso en Safari iOS. */
  readonly multiDraw: boolean;
  readonly scene = new Scene();
  readonly iso: IsometricCamera;
  private readonly timer = new Timer();
  private readonly adaptive: AdaptiveResolution;
  private readonly contextMonitor: ContextLossMonitor;
  private rafId = 0;
  private running = false;
  private onFrame: ((dt: number) => void) | null = null;
  private readonly resizeObserver: ResizeObserver;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private cpuAccum = 0;
  private fps = 0;
  private frameMs = 0;
  private worstMs = 0;
  private worstAccum = 0;
  private cpuMs = 0;
  private frameCount = 0;
  onContextChange: ((s: ContextStatus) => void) | null = null;
  /** Cámara con la que se dibuja (isométrica por defecto; 3ª/1ª persona la cambian). */
  activeCamera: Camera;
  /** Avisa del nuevo aspecto al redimensionar (para cámaras en perspectiva). */
  onResize: ((aspect: number) => void) | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    public quality: QualitySettings,
  ) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    // Safari en iOS no expone WEBGL_multi_draw: sin ella three.js dibuja cada instancia de un
    // BatchedMesh con su propia llamada. El juego elige mallas fusionadas/instanciadas en ese caso.
    this.multiDraw = this.renderer.extensions?.has?.('WEBGL_multi_draw') ?? true;
    this.renderer.shadowMap.type = PCFShadowMap;
    // Las sombras se re-dibujan a mano (cada N frames en móvil).
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.setPixelRatio(quality.pixelRatio);
    this.adaptive = new AdaptiveResolution({ min: quality.minPixelRatio, max: quality.pixelRatio });
    this.contextMonitor = new ContextLossMonitor(canvas, (s) => this.handleContext(s));

    this.iso = new IsometricCamera(1);
    this.activeCamera = this.iso.camera;
    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.timer.connect(document);
  }

  get contextLost(): boolean {
    return this.contextMonitor.lost;
  }

  start(onFrame: (dt: number) => void): void {
    this.onFrame = onFrame;
    this.running = true;
    this.timer.reset();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /** Aplica otra calidad sin recargar: sombras, resolución y presupuesto adaptativo. */
  setQuality(q: QualitySettings): void {
    const shadowsChanged = q.shadows !== this.quality.shadows;
    this.quality = q;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.needsUpdate = q.shadows;
    if (shadowsChanged) {
      // Los shaders con/sin sombras son distintos: forzar su recompilación una vez.
      this.scene.traverse((o) => {
        const m = (o as Mesh).material;
        if (m) (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true));
      });
    }
    this.renderer.setPixelRatio(this.adaptive.setBounds(q.minPixelRatio, q.pixelRatio));
    this.resize();
  }

  frameInfo(): FrameInfo {
    const info = this.renderer.info.render;
    return {
      fps: this.fps,
      frameMs: this.frameMs,
      worstMs: this.worstMs,
      cpuMs: this.cpuMs,
      pixelRatio: this.renderer.getPixelRatio(),
      drawCalls: info.calls,
      triangles: info.triangles,
      refreshHz: this.adaptive.refreshHz,
    };
  }

  private tick = (time: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);
    const t0 = performance.now();
    this.timer.update(time);
    const dt = this.timer.getDelta();

    this.fpsAccum += dt;
    this.fpsFrames++;
    this.worstAccum = Math.max(this.worstAccum, dt);

    // La simulación sigue aunque no haya contexto (la partida en línea no se corta).
    this.onFrame?.(dt);
    if (!this.contextMonitor.lost) {
      const newRatio = this.adaptive.update(dt);
      if (newRatio !== null) {
        this.renderer.setPixelRatio(newRatio);
        this.resize();
      }
      if (this.quality.shadows && this.frameCount % this.quality.shadowUpdateInterval === 0) {
        this.renderer.shadowMap.needsUpdate = true;
      }
      this.frameCount++;
      this.renderer.render(this.scene, this.activeCamera);
    }
    this.cpuAccum += performance.now() - t0;

    if (this.fpsAccum >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsAccum);
      this.frameMs = (this.fpsAccum / this.fpsFrames) * 1000;
      this.worstMs = this.worstAccum * 1000;
      this.cpuMs = this.cpuAccum / this.fpsFrames;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
      this.worstAccum = 0;
      this.cpuAccum = 0;
    }
  };

  private handleContext(s: ContextStatus): void {
    this.adaptive.reset();
    if (s === 'restored') {
      // Three.js ya re-creó su estado; re-aplicamos tamaño y sombras.
      this.renderer.shadowMap.needsUpdate = this.quality.shadows;
      this.resize();
    }
    this.onContextChange?.(s);
  }

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.iso.resize(w / h);
    this.onResize?.(w / h);
  }

  /** Aspecto actual del lienzo. */
  get aspect(): number {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    return w / h;
  }

  private handleVisibility = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(this.rafId);
    } else if (this.running) {
      this.timer.reset();
      this.adaptive.reset();
      this.rafId = requestAnimationFrame(this.tick);
    }
  };

  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    this.contextMonitor.dispose();
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.timer.dispose();
    const geometries = new Set<BufferGeometry>();
    const materials = new Set<Material>();
    this.scene.traverse((object) => {
      if (object instanceof Mesh) {
        if (!(object instanceof BatchedMesh)) geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
      if (object instanceof BatchedMesh) object.dispose();
      if (object instanceof InstancedMesh) object.dispose();
      if (object instanceof DirectionalLight) object.dispose();
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.scene.clear();
    this.renderer.dispose();
  }
}
