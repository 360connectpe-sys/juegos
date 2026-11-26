// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HudEditor } from '@/ui/hud/HudEditor';
import { defaultHudLayout, loadHudLayout, saveHudLayout, resetHudLayout } from '@/ui/hud/layout';
import { HudSlot } from '@/ui/hud/HudSlot';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('mantiene el elemento completo dentro del área segura incluso con escala grande', () => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(80);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
  const { container } = render(<HudSlot id="inventory" layout={{ x: 0.98, y: 0.02, scale: 1.8, opacity: 0.35, visible: true }}>Inventario</HudSlot>);
  const slot = container.querySelector<HTMLElement>('[data-hud]')!;
  expect(slot.style.getPropertyValue('--s')).toBe('0.6');
  expect(slot.style.getPropertyValue('--o')).toBe('0.35');
  expect(slot.style.left).toContain('150px');
  expect(slot.style.top).toContain('24px');
});

it('las flechas en los sliders no desplazan el elemento seleccionado', () => {
  const save = vi.fn();
  const layout = defaultHudLayout();
  render(<HudEditor initial={layout} game={null} isTouch onSave={save} onCancel={vi.fn()} />);
  fireEvent.keyDown(screen.getAllByRole('slider')[0]!, { key: 'ArrowLeft' });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  expect(save.mock.calls[0]![0].jump.x).toBe(layout.jump.x);
});

it('el HUD funciona cuando el navegador bloquea el acceso a localStorage', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
  expect(loadHudLayout()).toEqual(defaultHudLayout());
  expect(() => saveHudLayout(defaultHudLayout())).not.toThrow();
  expect(resetHudLayout()).toEqual(defaultHudLayout());
});
