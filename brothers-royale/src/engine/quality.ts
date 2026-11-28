/**
 * Calidad gráfica: solo DOS niveles, Baja y Normal. Pura y testeable.
 *
 * REGLA: la calidad solo cambia cómo se dibuja (resolución, sombras). El mundo,
 * la física, las colisiones, los oclusores (árboles, techos) y la cámara son
 * idénticos en ambas: ninguna calidad da ventaja competitiva.
 */
export type QualityTier = 'low' | 'normal';
/** Nombres de fases anteriores; se aceptan como alias de 'normal'. */
export type LegacyQualityTier = 'medium' | 'high';

export const QUALITY_LABEL: Record<QualityTier, string> = { low: 'Baja', normal: 'Normal' };

export interface DeviceInfo {
  devicePixelRatio: number;
  isTouch: boolean;
  /** Ancho de pantalla CSS más corto. */
  shortSide: number;
  hardwareConcurrency: number;
  /** GB de RAM si el navegador lo expone (navigator.deviceMemory). */
  deviceMemory?: number;
}

export interface QualitySettings {
  tier: QualityTier;
  /** Pixel ratio inicial (= máximo de la resolución adaptativa). */
  pixelRatio: number;
  /** Límite inferior para la resolución adaptativa. */
  minPixelRatio: number;
  /** MSAA desactivado siempre: en móvil es caro y la resolución nativa ya suaviza. */
  antialias: false;
  shadows: boolean;
  shadowMapSize: number;
  /** Cada cuántos frames se re-dibuja el mapa de sombras (1 = siempre). */
  shadowUpdateInterval: number;
  /** Sombra de mancha barata bajo los personajes (cuando no hay sombras reales). */
  blobShadows: boolean;
}

export function normalizeTier(t: QualityTier | LegacyQualityTier): QualityTier {
  return t === 'low' ? 'low' : 'normal';
}

/** Gama baja: pocos núcleos o poca memoria (cuando el navegador lo expone). */
export function pickTier(d: DeviceInfo): QualityTier {
  const mem = d.deviceMemory ?? 4;
  return d.hardwareConcurrency <= 4 || mem <= 2 ? 'low' : 'normal';
}

export function buildQuality(tier: QualityTier | LegacyQualityTier, devicePixelRatio: number, isTouch = true): QualitySettings {
  const t = normalizeTier(tier);
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  if (t === 'low') {
    return {
      tier: 'low',
      pixelRatio: Math.min(dpr, 1),
      // Fase 15.2: suelo 0,8 (antes 0,6): con menos la imagen se pixelaba demasiado.
      minPixelRatio: Math.min(0.8, Math.min(dpr, 1)),
      antialias: false,
      // Fase 15: sin sombras en ninguna calidad (ni mapa de sombras ni manchas).
      shadows: false,
      shadowMapSize: 0,
      shadowUpdateInterval: 1,
      blobShadows: false,
    };
  }
  return {
    tier: 'normal',
    // En móvil 1,5 basta para pantallas de 3x; en escritorio hasta 2 (sin MSAA).
    pixelRatio: Math.min(dpr, isTouch ? 1.5 : 2),
    // Fase 15.2: suelo 1,0 (antes 0,75) salvo pantallas de menos de 1 px por punto.
    minPixelRatio: Math.min(1, dpr),
    antialias: false,
    // Fase 15: Normal tampoco dibuja sombras (rendimiento, batería y calor).
    shadows: false,
    shadowMapSize: 0,
    shadowUpdateInterval: 1,
    blobShadows: false,
  };
}

export function detectQuality(d: DeviceInfo, override?: QualityTier | LegacyQualityTier | null): QualitySettings {
  return buildQuality(override ?? pickTier(d), d.devicePixelRatio, d.isTouch);
}

export function readDeviceInfo(): DeviceInfo {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const info: DeviceInfo = {
    devicePixelRatio: window.devicePixelRatio || 1,
    isTouch: 'ontouchstart' in window || nav.maxTouchPoints > 0,
    shortSide: Math.min(window.screen.width, window.screen.height),
    hardwareConcurrency: nav.hardwareConcurrency || 4,
  };
  if (nav.deviceMemory !== undefined) info.deviceMemory = nav.deviceMemory;
  return info;
}

/** ?q=low|baja|normal (medium y high siguen valiendo como "normal"). */
export function readQualityOverride(search: string): QualityTier | null {
  const q = new URLSearchParams(search).get('q')?.toLowerCase();
  if (q === 'low' || q === 'baja') return 'low';
  if (q === 'normal' || q === 'medium' || q === 'high') return 'normal';
  return null;
}

const QUALITY_KEY = 'br.quality';

export function loadSavedQuality(): QualityTier | null {
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    return v === 'low' || v === 'normal' ? v : null;
  } catch {
    return null;
  }
}

export function saveQuality(t: QualityTier): void {
  try {
    localStorage.setItem(QUALITY_KEY, t);
  } catch {
    /* sin almacenamiento: se usa la detección automática */
  }
}

/**
 * Capacidad por rendimiento REAL (fase 15; revisado en 15.2). Recibe cada ventana de la resolución
 * adaptativa (≈1,5 s):
 * - En Normal, si la resolución ya está en su mínimo y el percentil 90 sigue muy lejos del objetivo
 *   durante varias ventanas seguidas, propone bajar a Baja ('down').
 * - En Baja por bajada automática, si la resolución está en su máximo y va holgado durante muchas
 *   ventanas, propone volver a la calidad elegida ('up').
 * Cada vuelta atrás duplica la espera de la siguiente bajada: no oscila. Nunca decide nada que se
 * guarde como preferencia del jugador.
 */
export class PerformanceGovernor {
  private bad = 0;
  private good = 0;
  private downNeeded: number;
  constructor(windowsNeeded = 6, private readonly upNeeded = 12) { this.downNeeded = windowsNeeded; }
  feed(tier: QualityTier, p90Ms: number, targetFps: number, pixelRatio: number, minPixelRatio: number, maxPixelRatio = Infinity, reduced = false): 'down' | 'up' | null {
    if (!(p90Ms > 0)) return null;
    const budget = 1000 / targetFps;
    if (tier === 'normal') {
      this.good = 0;
      const slow = pixelRatio <= minPixelRatio + 1e-6 && p90Ms > budget * 1.45;
      this.bad = slow ? this.bad + 1 : 0;
      if (this.bad >= this.downNeeded) { this.bad = 0; return 'down'; }
      return null;
    }
    this.bad = 0;
    if (!reduced) return null;
    const easy = pixelRatio >= maxPixelRatio - 1e-6 && p90Ms <= budget * 1.05;
    this.good = easy ? this.good + 1 : 0;
    if (this.good >= this.upNeeded) { this.good = 0; this.downNeeded = Math.min(this.downNeeded * 2, 40); return 'up'; }
    return null;
  }
  reset(): void { this.bad = 0; this.good = 0; }
}
