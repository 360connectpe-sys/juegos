/**
 * Detección de calidad gráfica. Pura y testeable: recibe las capacidades del
 * dispositivo y devuelve la configuración. El móvil es el caso prioritario.
 */
export type QualityTier = 'low' | 'medium' | 'high';

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
  pixelRatio: number;
  /** Límite inferior para la resolución adaptativa. */
  minPixelRatio: number;
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  /** Cada cuántos frames se re-dibuja el mapa de sombras (1 = siempre). */
  shadowUpdateInterval: number;
  treeDensity: number;
}

const PRESETS: Record<QualityTier, Omit<QualitySettings, 'tier' | 'pixelRatio'> & { maxPixelRatio: number }> = {
  low: { maxPixelRatio: 1, minPixelRatio: 0.6, antialias: false, shadows: false, shadowMapSize: 512, shadowUpdateInterval: 1, treeDensity: 0.6 },
  medium: { maxPixelRatio: 1.5, minPixelRatio: 0.75, antialias: false, shadows: true, shadowMapSize: 1024, shadowUpdateInterval: 2, treeDensity: 0.85 },
  high: { maxPixelRatio: 2, minPixelRatio: 1, antialias: true, shadows: true, shadowMapSize: 2048, shadowUpdateInterval: 1, treeDensity: 1 },
};

export function pickTier(d: DeviceInfo): QualityTier {
  const mem = d.deviceMemory ?? 4;
  const isPhone = d.isTouch && d.shortSide < 600;
  if (d.hardwareConcurrency <= 4 || mem <= 2) return 'low';
  if (isPhone || d.isTouch) return 'medium';
  return 'high';
}

export function buildQuality(tier: QualityTier, devicePixelRatio: number): QualitySettings {
  const { maxPixelRatio, ...rest } = PRESETS[tier];
  return { tier, pixelRatio: Math.min(devicePixelRatio, maxPixelRatio), ...rest };
}

export function detectQuality(d: DeviceInfo, override?: QualityTier | null): QualitySettings {
  return buildQuality(override ?? pickTier(d), d.devicePixelRatio);
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

/** Permite forzar calidad con ?q=low|medium|high (útil para pruebas en móvil). */
export function readQualityOverride(search: string): QualityTier | null {
  const q = new URLSearchParams(search).get('q');
  return q === 'low' || q === 'medium' || q === 'high' ? q : null;
}
