/**
 * Resolución adaptativa (pixel ratio) — fase 3.2.
 *
 * - Objetivo = frecuencia real de la pantalla, como mucho 60 FPS. Si el
 *   navegador limita a 30 Hz (modo ahorro), el objetivo es 30 y no se baja la
 *   resolución inútilmente. NUNCA se limita el FPS: solo se ajusta la nitidez.
 * - Decide con el percentil 90 del tiempo de frame (los tirones cuentan, la
 *   media los escondía) e ignora frames > 250 ms (pestaña oculta, carga).
 * - Bajar: rápido si va muy por debajo (los pasos crecen si sigue mal).
 *   Subir: "sondea" de 0,05 en 0,05 tras ventanas buenas. Si una subida no
 *   aguanta, se revierte exactamente, ese nivel queda como "techo" y la espera
 *   para volver a probarlo se duplica (2, 4, 8… hasta 32 ventanas): no oscila.
 */
export interface AdaptiveOptions {
  min: number;
  max: number;
  /** Fuerza el objetivo (FPS). Si no se da, se detecta la frecuencia de la pantalla. */
  targetFps?: number;
  /** Segundos por ventana de medida. */
  window?: number;
  /** Paso base (pixel ratio). */
  step?: number;
}

/** Intervalos típicos de refresco (Hz) para reconocer el vsync. */
const REFRESH_RATES = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240];

/**
 * Estima la frecuencia de la pantalla a partir del frame más rápido visto
 * (p10). Solo la acepta si coincide (±6 %) con una frecuencia estándar; si no,
 * el frame va limitado por GPU/CPU y se supone 60 Hz.
 */
export function estimateRefreshHz(p10FrameSec: number): number {
  if (!(p10FrameSec > 0)) return 60;
  const hz = 1 / p10FrameSec;
  for (const r of REFRESH_RATES) if (Math.abs(hz - r) / r < 0.06) return r;
  return 60;
}

export const quantize = (v: number, q = 0.05): number => Math.round(v / q) * q;

export class AdaptiveResolution {
  private samples: number[] = [];
  private elapsed = 0;
  private current: number;
  private readonly step: number;
  private readonly window: number;
  private goodWindows = 0;
  private badStreak = 0;
  /** Ventanas buenas necesarias para volver a probar el techo (se duplica si falla). */
  private probeWait = 2;
  /** Nivel en el que falló la última subida: no se vuelve a probar enseguida. */
  private ceiling: number | null = null;
  private probeFrom = 0;
  private lastChange: 'up' | 'down' | null = null;
  private windowsSinceChange = 0;
  private fastestFrame = Infinity;
  lastFps = 0;
  lastP90Ms = 0;
  refreshHz = 60;

  constructor(private opts: AdaptiveOptions) {
    this.current = opts.max;
    this.step = opts.step ?? 0.1;
    this.window = opts.window ?? 1.5;
  }

  get pixelRatio(): number {
    return this.current;
  }

  get targetFps(): number {
    return this.opts.targetFps ?? Math.min(this.refreshHz, 60);
  }

  /** Cambia los límites (p. ej. al cambiar de calidad). Devuelve el nuevo ratio. */
  setBounds(min: number, max: number): number {
    this.opts = { ...this.opts, min, max };
    this.current = max;
    this.ceiling = null;
    this.probeWait = 2;
    this.lastChange = null;
    this.reset();
    return this.current;
  }

  /** Olvida las medidas (pestaña oculta, contexto perdido, cambio de calidad). */
  reset(): void {
    this.fastestFrame = Infinity;
    this.refreshHz = 60;
    this.lastChange = null;
    this.windowsSinceChange = 0;
    this.samples = [];
    this.elapsed = 0;
    this.goodWindows = 0;
    this.badStreak = 0;
  }

  /** Registra un frame. Devuelve el nuevo pixel ratio si cambió; null si se mantiene. */
  update(dt: number): number | null {
    if (!(dt > 0) || dt > 0.25) return null; // pausa o tirón excepcional: no informa
    this.samples.push(dt);
    this.elapsed += dt;
    if (this.elapsed < this.window || this.samples.length < 8) return null;

    const sorted = this.samples.slice().sort((a, b) => a - b);
    const p10 = sorted[Math.floor(sorted.length * 0.1)]!;
    const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))]!;
    this.fastestFrame = Math.min(this.fastestFrame, p10);
    this.refreshHz = estimateRefreshHz(this.fastestFrame);
    this.lastFps = this.samples.length / this.elapsed;
    this.lastP90Ms = p90 * 1000;
    this.samples = [];
    this.elapsed = 0;

    const targetSec = 1 / this.targetFps;
    let next = this.current;
    this.windowsSinceChange++;
    if (p90 > targetSec * 1.12) {
      this.goodWindows = 0;
      if (this.lastChange === 'up' && this.windowsSinceChange <= 2) {
        // La subida que acabamos de probar no aguanta: volver justo al nivel anterior
        // y esperar el doble antes de intentarlo otra vez.
        this.ceiling = this.current;
        this.probeWait = Math.min(this.probeWait * 2, 32);
        this.badStreak = 0;
        next = this.probeFrom;
      } else {
        this.badStreak++;
        const k = Math.min(1 + (this.badStreak - 1) * 0.5, 2.5);
        next = this.current - this.step * k;
      }
    } else {
      this.badStreak = 0;
      if (p90 <= targetSec * 1.04) this.goodWindows++;
      // Un techo que ya aguantó varias ventanas deja de serlo.
      if (this.ceiling !== null && this.current >= this.ceiling - 1e-6 && this.windowsSinceChange > 3) {
        this.ceiling = null;
        this.probeWait = 2;
      }
      const up = this.current + this.step / 2;
      const need = this.ceiling !== null && up >= this.ceiling - 1e-6 ? this.probeWait : 2;
      if (this.goodWindows >= need && this.current < this.opts.max) {
        this.probeFrom = this.current;
        next = up;
        this.goodWindows = 0;
      }
    }
    next = Math.max(this.opts.min, Math.min(this.opts.max, quantize(next)));
    if (Math.abs(next - this.current) < 1e-6) return null;
    this.lastChange = next > this.current ? 'up' : 'down';
    this.windowsSinceChange = 0;
    this.current = next;
    return next;
  }
}
