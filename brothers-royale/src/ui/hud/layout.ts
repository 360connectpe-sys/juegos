/**
 * Disposición del HUD personalizable. Cada elemento se describe con datos
 * normalizados al ÁREA SEGURA de la pantalla (0..1, sin notch ni barra de
 * inicio), así una misma disposición vale en cualquier celular o monitor.
 */
import { safeStorage } from '@/game/settings';
import { clamp } from '@shared/math';
import { Buttons } from '@shared/types';

export type HudElementId =
  | 'joystick'
  | 'jump'
  | 'sprint'
  | 'attack'
  | 'aim'
  | 'reload'
  | 'interact'
  | 'build'
  | 'health'
  | 'lives'
  | 'inventory'
  | 'minimap';

export interface HudElementLayout {
  /** Centro del elemento, normalizado al área segura (0 = izquierda/arriba). */
  x: number;
  y: number;
  /** Escala 0,5..1,8. */
  scale: number;
  /** Opacidad 0,2..1. */
  opacity: number;
  visible: boolean;
}

export type HudLayout = Record<HudElementId, HudElementLayout>;

export interface HudElementInfo {
  id: HudElementId;
  label: string;
  /** Control táctil (solo en pantallas táctiles) o indicador (en todas). */
  kind: 'control' | 'info';
  /** Acción reservada que envía (botones). */
  action?: number;
}

export const HUD_ELEMENTS: readonly HudElementInfo[] = [
  { id: 'joystick', label: 'Joystick', kind: 'control' },
  { id: 'jump', label: 'Saltar', kind: 'control' },
  { id: 'sprint', label: 'Correr', kind: 'control' },
  { id: 'attack', label: 'Atacar', kind: 'control', action: Buttons.FIRE },
  { id: 'aim', label: 'Apuntar', kind: 'control', action: Buttons.AIM },
  { id: 'reload', label: 'Recargar', kind: 'control', action: Buttons.RELOAD },
  { id: 'interact', label: 'Usar', kind: 'control', action: Buttons.INTERACT },
  { id: 'build', label: 'Construir', kind: 'control', action: Buttons.BUILD },
  { id: 'health', label: 'Salud', kind: 'info' },
  { id: 'lives', label: 'Vidas', kind: 'info' },
  { id: 'inventory', label: 'Inventario', kind: 'info' },
  { id: 'minimap', label: 'Minimapa', kind: 'info' },
];

export const HUD_IDS: readonly HudElementId[] = HUD_ELEMENTS.map((e) => e.id);

export const HUD_LIMITS = {
  scale: { min: 0.5, max: 1.8 },
  opacity: { min: 0.2, max: 1 },
  /** Margen para que el centro no salga del área segura. */
  edge: 0.02,
} as const;

const el = (x: number, y: number, scale = 1, opacity = 1): HudElementLayout => ({ x, y, scale, opacity, visible: true });

/**
 * Disposición de fábrica pensada para celular en HORIZONTAL: pulgar izquierdo
 * en el joystick, pulgar derecho en un arco de botones alrededor de "Saltar",
 * indicadores en el centro inferior y minimapa arriba a la derecha.
 */
export function defaultHudLayout(): HudLayout {
  return {
    joystick: el(0.14, 0.72),
    jump: el(0.915, 0.8, 1),
    sprint: el(0.8, 0.88, 0.85),
    attack: el(0.79, 0.6, 1.05),
    aim: el(0.915, 0.47, 0.85),
    reload: el(0.675, 0.75, 0.8),
    interact: el(0.66, 0.92, 0.8, 0.9),
    build: el(0.565, 0.92, 0.8, 0.9),
    health: el(0.36, 0.95),
    lives: el(0.36, 0.86, 0.9),
    inventory: el(0.5, 0.06, 0.9),
    minimap: el(0.92, 0.27),
  };
}

const num = (v: unknown, def: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : def);

export function sanitizeElement(raw: unknown, def: HudElementLayout): HudElementLayout {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const e = HUD_LIMITS.edge;
  return {
    x: num(o.x, def.x, e, 1 - e),
    y: num(o.y, def.y, e, 1 - e),
    scale: num(o.scale, def.scale, HUD_LIMITS.scale.min, HUD_LIMITS.scale.max),
    opacity: num(o.opacity, def.opacity, HUD_LIMITS.opacity.min, HUD_LIMITS.opacity.max),
    visible: typeof o.visible === 'boolean' ? o.visible : def.visible,
  };
}

/** Valida una disposición leída: elementos desconocidos fuera, faltantes de fábrica. */
export function parseHudLayout(raw: unknown): HudLayout {
  const def = defaultHudLayout();
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const out = {} as HudLayout;
  for (const id of HUD_IDS) out[id] = sanitizeElement(o[id], def[id]);
  return out;
}

/** Mueve un elemento (delta normalizado) sin salir del área segura. Inmutable. */
export function moveElement(layout: HudLayout, id: HudElementId, dx: number, dy: number): HudLayout {
  const cur = layout[id];
  return { ...layout, [id]: sanitizeElement({ ...cur, x: cur.x + dx, y: cur.y + dy }, cur) };
}

/** Cambia propiedades de un elemento con los mismos límites. Inmutable. */
export function updateElement(layout: HudLayout, id: HudElementId, patch: Partial<HudElementLayout>): HudLayout {
  return { ...layout, [id]: sanitizeElement({ ...layout[id], ...patch }, layout[id]) };
}

export function resetElement(layout: HudLayout, id: HudElementId): HudLayout {
  return { ...layout, [id]: defaultHudLayout()[id] };
}

export const HUD_KEY = 'br.hud.v1';

export function loadHudLayout(storage: Pick<Storage, 'getItem'> | null = safeStorage()): HudLayout {
  try {
    const txt = storage?.getItem(HUD_KEY);
    return parseHudLayout(txt ? JSON.parse(txt) : null);
  } catch {
    return defaultHudLayout();
  }
}

export function saveHudLayout(layout: HudLayout, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(HUD_KEY, JSON.stringify(parseHudLayout(layout)));
  } catch {
    /* sin almacenamiento */
  }
}

export function resetHudLayout(storage: Pick<Storage, 'removeItem'> | null = safeStorage()): HudLayout {
  try {
    storage?.removeItem(HUD_KEY);
  } catch {
    /* nada */
  }
  return defaultHudLayout();
}
