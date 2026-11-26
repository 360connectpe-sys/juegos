/**
 * Ajusta el pixel ratio según los FPS medidos: baja la resolución si el
 * dispositivo no llega al objetivo y la recupera cuando sobra margen.
 */
export interface AdaptiveOptions {
  min: number;
  max: number;
  targetFps?: number;
  /** Segundos entre evaluaciones. */
  window?: number;
  step?: number;
}

export class AdaptiveResolution {
  private elapsed = 0;
  private frames = 0;
  private current: number;
  lastFps = 0;
  private readonly target: number;
  private readonly window: number;
  private readonly step: number;

  constructor(private readonly opts: AdaptiveOptions) {
    this.current = opts.max;
    this.target = opts.targetFps ?? 50;
    this.window = opts.window ?? 2;
    this.step = opts.step ?? 0.1;
  }

  get pixelRatio(): number {
    return this.current;
  }

  /** Devuelve el nuevo pixel ratio si cambió; null si se mantiene. */
  update(dt: number): number | null {
    this.elapsed += dt;
    this.frames++;
    if (this.elapsed < this.window) return null;
    const fps = this.frames / this.elapsed;
    this.lastFps = fps;
    this.elapsed = 0;
    this.frames = 0;
    let next = this.current;
    if (fps < this.target - 5) next = Math.max(this.opts.min, this.current - this.step);
    else if (fps > this.target + 8) next = Math.min(this.opts.max, this.current + this.step / 2);
    next = Math.round(next * 100) / 100;
    if (next === this.current) return null;
    this.current = next;
    return next;
  }
}
