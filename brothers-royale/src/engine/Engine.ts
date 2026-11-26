import { ACESFilmicToneMapping, PCFShadowMap, Scene, SRGBColorSpace, Timer, WebGLRenderer } from 'three';
import { AdaptiveResolution } from './AdaptiveResolution';
import { IsometricCamera } from './IsometricCamera';
import type { QualitySettings } from './quality';

export interface FrameInfo {
  fps: number;
  pixelRatio: number;
  drawCalls: number;
  triangles: number;
}

/**
 * Núcleo de render: renderer WebGL, escena, cámara isométrica, bucle RAF,
 * redimensionado y pausa cuando la pestaña no es visible (ahorra batería).
 */
export class Engine {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly iso: IsometricCamera;
  private readonly timer = new Timer();
  private readonly adaptive: AdaptiveResolution;
  private rafId = 0;
  private running = false;
  private onFrame: ((dt: number) => void) | null = null;
  private readonly resizeObserver: ResizeObserver;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private fps = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly quality: QualitySettings,
  ) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: quality.antialias,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.setPixelRatio(quality.pixelRatio);
    this.adaptive = new AdaptiveResolution({ min: quality.minPixelRatio, max: quality.pixelRatio });

    this.iso = new IsometricCamera(1);
    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.timer.connect(document);
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

  frameInfo(): FrameInfo {
    const info = this.renderer.info.render;
    return {
      fps: this.fps,
      pixelRatio: this.renderer.getPixelRatio(),
      drawCalls: info.calls,
      triangles: info.triangles,
    };
  }

  private tick = (time: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);
    this.timer.update(time);
    const dt = this.timer.getDelta();

    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsAccum);
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }
    const newRatio = this.adaptive.update(dt);
    if (newRatio !== null) {
      this.renderer.setPixelRatio(newRatio);
      this.resize();
    }

    this.onFrame?.(dt);
    this.renderer.render(this.scene, this.iso.camera);
  };

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.iso.resize(w / h);
  }

  private handleVisibility = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(this.rafId);
    } else if (this.running) {
      this.timer.reset();
      this.rafId = requestAnimationFrame(this.tick);
    }
  };

  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.timer.dispose();
    this.renderer.dispose();
  }
}
