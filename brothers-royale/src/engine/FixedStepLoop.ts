/**
 * Bucle de paso fijo: la simulación avanza en ticks constantes (igual que el
 * servidor) y el render interpola con `alpha`. Independiente del navegador
 * para poder testearlo.
 */
export interface FixedStepCallbacks {
  step(dt: number): void;
  render(alpha: number, frameDt: number): void;
}

export class FixedStepLoop {
  private accumulator = 0;
  /** Evita la "espiral de la muerte" tras un tirón o una pestaña en segundo plano. */
  readonly maxFrameDt = 0.25;
  ticks = 0;

  constructor(
    readonly fixedDt: number,
    private readonly cb: FixedStepCallbacks,
  ) {}

  advance(frameDt: number): void {
    const dt = Math.min(Math.max(frameDt, 0), this.maxFrameDt);
    this.accumulator += dt;
    while (this.accumulator >= this.fixedDt) {
      this.cb.step(this.fixedDt);
      this.accumulator -= this.fixedDt;
      this.ticks++;
    }
    this.cb.render(this.accumulator / this.fixedDt, dt);
  }

  reset(): void {
    this.accumulator = 0;
  }
}
