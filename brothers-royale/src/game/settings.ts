/**
 * Preferencias del jugador (solo cliente): perspectiva y sensibilidades.
 * Se guardan en localStorage con versión y se validan al leerlas: un valor
 * corrupto o manipulado nunca rompe el juego, se sustituye por el de fábrica.
 */
import { isCameraMode, type CameraMode } from '@/engine/camera/cameraMath';
import { clamp } from '@shared/math';

export interface GameSettings {
  perspective: CameraMode;
  /** Sensibilidad de cámara (multiplicador). */
  lookSensitivity: number;
  /** Sensibilidad mientras se apunta (multiplicador adicional). */
  aimSensitivity: number;
  invertY: boolean;
}

export const SETTINGS_LIMITS = {
  lookSensitivity: { min: 0.2, max: 3, step: 0.05 },
  aimSensitivity: { min: 0.2, max: 1.5, step: 0.05 },
} as const;

export const DEFAULT_SETTINGS: Readonly<GameSettings> = Object.freeze({
  perspective: 'isometric',
  lookSensitivity: 1,
  aimSensitivity: 0.7,
  invertY: false,
});

export const SETTINGS_KEY = 'br.settings.v1';

const num = (v: unknown, def: number, lim: { min: number; max: number }) =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, lim.min, lim.max) : def;

/** Convierte cualquier valor (JSON leído, objeto parcial) en ajustes válidos. */
export function parseSettings(raw: unknown): GameSettings {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    perspective: isCameraMode(o.perspective) ? o.perspective : DEFAULT_SETTINGS.perspective,
    lookSensitivity: num(o.lookSensitivity, DEFAULT_SETTINGS.lookSensitivity, SETTINGS_LIMITS.lookSensitivity),
    aimSensitivity: num(o.aimSensitivity, DEFAULT_SETTINGS.aimSensitivity, SETTINGS_LIMITS.aimSensitivity),
    invertY: typeof o.invertY === 'boolean' ? o.invertY : DEFAULT_SETTINGS.invertY,
  };
}

export function loadSettings(storage: Pick<Storage, 'getItem'> | null = safeStorage()): GameSettings {
  try {
    const txt = storage?.getItem(SETTINGS_KEY);
    return parseSettings(txt ? JSON.parse(txt) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: GameSettings, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(parseSettings(s)));
  } catch {
    /* sin almacenamiento: los ajustes duran lo que la pestaña */
  }
}

export function resetSettings(storage: Pick<Storage, 'removeItem'> | null = safeStorage()): GameSettings {
  try {
    storage?.removeItem(SETTINGS_KEY);
  } catch {
    /* nada */
  }
  return { ...DEFAULT_SETTINGS };
}

export function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Volumen de efectos (0..1). Clave propia para no cambiar el formato de
 * `br.settings.v1`; se valida igual al leerlo.
 */
export const VOLUME_KEY = 'br.volume.v1';
export const DEFAULT_VOLUME = 0.7;
export const VOLUME_LIMITS = { min: 0, max: 1, step: 0.05 } as const;

export function parseVolume(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  return num(n, DEFAULT_VOLUME, VOLUME_LIMITS);
}

export function loadVolume(storage: Pick<Storage, 'getItem'> | null = safeStorage()): number {
  try {
    const txt = storage?.getItem(VOLUME_KEY);
    return txt === null || txt === undefined ? DEFAULT_VOLUME : parseVolume(txt);
  } catch {
    return DEFAULT_VOLUME;
  }
}

export function saveVolume(v: number, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(VOLUME_KEY, String(parseVolume(v)));
  } catch {
    /* sin almacenamiento */
  }
}
