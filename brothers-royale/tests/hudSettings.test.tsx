// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_SETTINGS, loadSettings, parseSettings, resetSettings, saveSettings, SETTINGS_KEY } from '@/game/settings';
import { HudEditor } from '@/ui/hud/HudEditor';
import {
  defaultHudLayout,
  HUD_IDS,
  HUD_KEY,
  HUD_LIMITS,
  loadHudLayout,
  moveElement,
  parseHudLayout,
  resetElement,
  resetHudLayout,
  saveHudLayout,
  updateElement,
} from '@/ui/hud/layout';
import { HealthBar, Inventory, Lives } from '@/ui/hud/widgets';
import { SettingsPanel } from '@/ui/components/SettingsPanel';

afterEach(cleanup);

/** Almacenamiento en memoria (igual que localStorage). */
const memStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

describe('ajustes guardados', () => {
  it('valores corruptos o manipulados vuelven a los de fábrica o se acotan', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ perspective: 'cenital', lookSensitivity: 99, aimSensitivity: -1, invertY: 'sí' })).toEqual({
      perspective: 'isometric',
      lookSensitivity: 3,
      aimSensitivity: 0.2,
      invertY: false,
    });
    expect(parseSettings({ lookSensitivity: Number.NaN }).lookSensitivity).toBe(1);
  });
  it('guardar, cargar y restablecer', () => {
    const st = memStore();
    saveSettings({ perspective: 'first', lookSensitivity: 1.5, aimSensitivity: 0.4, invertY: true }, st);
    expect(loadSettings(st)).toEqual({ perspective: 'first', lookSensitivity: 1.5, aimSensitivity: 0.4, invertY: true });
    st.setItem(SETTINGS_KEY, '{roto');
    expect(loadSettings(st)).toEqual(DEFAULT_SETTINGS);
    saveSettings({ ...DEFAULT_SETTINGS, perspective: 'third' }, st);
    expect(resetSettings(st)).toEqual(DEFAULT_SETTINGS);
    expect(st.m.has(SETTINGS_KEY)).toBe(false);
  });
});

describe('disposición del HUD', () => {
  it('la de fábrica tiene todos los elementos dentro del área segura', () => {
    const l = defaultHudLayout();
    expect(Object.keys(l).sort()).toEqual([...HUD_IDS].sort());
    for (const id of HUD_IDS) {
      expect(l[id].x).toBeGreaterThanOrEqual(HUD_LIMITS.edge);
      expect(l[id].x).toBeLessThanOrEqual(1 - HUD_LIMITS.edge);
      expect(l[id].y).toBeGreaterThanOrEqual(HUD_LIMITS.edge);
      expect(l[id].y).toBeLessThanOrEqual(1 - HUD_LIMITS.edge);
    }
    for (const id of ['health', 'lives', 'inventory', 'minimap', 'attack', 'reload', 'interact', 'build', 'jump'] as const) expect(l[id].visible).toBe(true);
  });
  it('mover, escalar y opacidad respetan los límites y no mutan el original', () => {
    const l = defaultHudLayout();
    const moved = moveElement(l, 'jump', 5, -5);
    expect(moved.jump.x).toBe(1 - HUD_LIMITS.edge);
    expect(moved.jump.y).toBe(HUD_LIMITS.edge);
    expect(l.jump.x).toBe(defaultHudLayout().jump.x);
    const big = updateElement(l, 'minimap', { scale: 9, opacity: 0 });
    expect(big.minimap.scale).toBe(HUD_LIMITS.scale.max);
    expect(big.minimap.opacity).toBe(HUD_LIMITS.opacity.min);
    expect(resetElement(big, 'minimap')).toEqual({ ...big, minimap: defaultHudLayout().minimap });
  });
  it('datos guardados inválidos: elementos desconocidos fuera, faltantes de fábrica', () => {
    const p = parseHudLayout({ jump: { x: 0.3, y: 'a', scale: 1.2 }, hacker: { x: 0 } });
    expect(p.jump.x).toBe(0.3);
    expect(p.jump.y).toBe(defaultHudLayout().jump.y);
    expect(p.jump.scale).toBe(1.2);
    expect(p).not.toHaveProperty('hacker');
    expect(p.minimap).toEqual(defaultHudLayout().minimap);
  });
  it('guardar, cargar y restablecer', () => {
    const st = memStore();
    const l = updateElement(defaultHudLayout(), 'health', { x: 0.2, opacity: 0.5 });
    saveHudLayout(l, st);
    expect(loadHudLayout(st)).toEqual(l);
    st.setItem(HUD_KEY, 'no es json');
    expect(loadHudLayout(st)).toEqual(defaultHudLayout());
    expect(resetHudLayout(st)).toEqual(defaultHudLayout());
    expect(st.m.has(HUD_KEY)).toBe(false);
  });
});

describe('indicadores preparados', () => {
  it('salud, vidas e inventario se muestran con su estado inicial', () => {
    render(
      <>
        <HealthBar />
        <Lives />
        <Inventory />
      </>,
    );
    expect(screen.getByRole('meter', { name: 'Salud' }).getAttribute('aria-valuenow')).toBe('100');
    expect(screen.getByRole('img', { name: 'Vidas: 3 de 3' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Inventario vacío' }).children).toHaveLength(5);
  });
});

describe('panel de Ajustes', () => {
  const props = () => ({
    settings: { ...DEFAULT_SETTINGS },
    quality: <span>calidad</span>,
    canFullscreen: false,
    onChange: vi.fn(),
    onEditHud: vi.fn(),
    onResetAll: vi.fn(),
    onFullscreen: vi.fn(),
    onClose: vi.fn(),
  });
  it('la perspectiva se elige aquí y las sensibilidades se ajustan', () => {
    const p = props();
    render(<SettingsPanel {...p} />);
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['Isométrica', 'Tercera persona', 'Primera persona']);
    fireEvent.click(screen.getByRole('radio', { name: 'Primera persona' }));
    expect(p.onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, perspective: 'first' });
    fireEvent.change(screen.getByLabelText(/Sensibilidad de cámara/), { target: { value: '2' } });
    expect(p.onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, lookSensitivity: 2 });
    fireEvent.click(screen.getByLabelText('Invertir el eje vertical'));
    expect(p.onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, invertY: true });
    fireEvent.click(screen.getByRole('button', { name: 'Editar HUD' }));
    expect(p.onEditHud).toHaveBeenCalled();
  });
  it('restablecer pide confirmación', () => {
    const p = props();
    render(<SettingsPanel {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer ajustes y HUD' }));
    expect(p.onResetAll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer' }));
    expect(p.onResetAll).toHaveBeenCalledTimes(1);
  });
});

describe('editor visual del HUD', () => {
  Element.prototype.setPointerCapture ??= () => undefined;
  const rect = { left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0, toJSON() {} };

  it('arrastrar mueve el elemento; tamaño, opacidad y visibilidad; guardar devuelve la disposición', () => {
    const onSave = vi.fn();
    const { container } = render(<HudEditor initial={defaultHudLayout()} game={null} isTouch onSave={onSave} onCancel={vi.fn()} />);
    const safe = container.querySelector('.hud-safe--editor') as HTMLElement;
    safe.getBoundingClientRect = () => rect as DOMRect;
    const grab = screen.getByRole('button', { name: 'Mover Minimapa' });
    fireEvent.pointerDown(grab, { pointerId: 1, clientX: 500, clientY: 250 });
    // Fase 14: el minimapa está arriba a la izquierda; se arrastra hacia dentro (+x, +y).
    fireEvent.pointerMove(safe, { pointerId: 1, clientX: 600, clientY: 300 });
    fireEvent.pointerUp(safe, { pointerId: 1 });
    fireEvent.change(screen.getByLabelText(/Tamaño/), { target: { value: '1.4' } });
    fireEvent.change(screen.getByLabelText(/Opacidad/), { target: { value: '0.5' } });
    fireEvent.click(screen.getByLabelText('Mostrar'));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    const saved = onSave.mock.calls[0]![0];
    const def = defaultHudLayout().minimap;
    expect(saved.minimap.x).toBeCloseTo(def.x + 0.1);
    expect(saved.minimap.y).toBeCloseTo(def.y + 0.1);
    expect(saved.minimap.scale).toBe(1.4);
    expect(saved.minimap.opacity).toBe(0.5);
    expect(saved.minimap.visible).toBe(false);
    expect(saved.jump).toEqual(defaultHudLayout().jump);
  });
  it('la barra nunca tapa el elemento elegido (el inventario está arriba: la barra baja)', () => {
    const { container } = render(<HudEditor initial={defaultHudLayout()} game={null} isTouch onSave={vi.fn()} onCancel={vi.fn()} />);
    const bar = () => container.querySelector('.hud-editor__bar')!;
    expect(bar().classList.contains('hud-editor__bar--bottom')).toBe(false); // "Saltar" está abajo
    fireEvent.change(screen.getByLabelText('Elemento'), { target: { value: 'inventory' } });
    expect(bar().classList.contains('hud-editor__bar--bottom')).toBe(true);
    const safe = container.querySelector('.hud-safe--editor') as HTMLElement;
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Mover Inventario' }), { pointerId: 9, clientX: 10, clientY: 10 });
    expect(bar().classList.contains('is-dragging')).toBe(true);
    fireEvent.pointerUp(safe, { pointerId: 9 });
    expect(bar().classList.contains('is-dragging')).toBe(false);
  });

  it('las flechas mueven el elemento seleccionado; restablecer y cancelar', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<HudEditor initial={defaultHudLayout()} game={null} isTouch onSave={onSave} onCancel={onCancel} />);
    const dialog = screen.getByRole('dialog', { name: 'Editar HUD' });
    act(() => screen.getByRole('button', { name: 'Mover Saltar' }).focus());
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    fireEvent.keyDown(dialog, { key: 'ArrowUp', shiftKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    const def = defaultHudLayout().jump;
    expect(onSave.mock.calls[0]![0].jump.x).toBeCloseTo(def.x - 0.01);
    expect(onSave.mock.calls[0]![0].jump.y).toBeCloseTo(def.y - 0.05);
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer elemento' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onSave.mock.calls[1]![0].jump).toEqual(def);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
