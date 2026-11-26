// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { InputManager } from '@/game/input/InputManager';
import { combineFrames, GamepadSource, PAD, radialDeadzone, TouchSource } from '@/game/input/sources';
import { LoadingScreen } from '@/ui/components/LoadingScreen';
import { TouchControls } from '@/ui/components/TouchControls';
import { ISO_SCREEN_RIGHT, ISO_SCREEN_UP } from '@shared/movement';
import { Buttons, hasButton } from '@shared/types';

afterEach(cleanup);

/** Mando falso para la Gamepad API. */
function fakePad(axes: number[] = [0, 0, 0, 0], pressed: number[] = []) {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), touched: false, value: pressed.includes(i) ? 1 : 0 }));
  return { axes, buttons, connected: true, mapping: 'standard' as GamepadMappingType };
}

describe('LoadingScreen', () => {
  it('muestra el progreso accesible', () => {
    render(<LoadingScreen progress={0.4} label="Cargando física" error={null} hidden={false} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');
  });
  it('muestra el error con instrucciones', () => {
    render(<LoadingScreen progress={0.4} label="x" error="WebGL no disponible" hidden={false} />);
    expect(screen.getByRole('alert').textContent).toContain('Recarga la página');
  });
});

describe('fuentes de entrada', () => {
  it('zona muerta radial reescala sin saltos', () => {
    expect(radialDeadzone(0.1, 0.1, 0.2)).toEqual({ x: 0, y: 0 });
    const full = radialDeadzone(1, 0, 0.2);
    expect(full.x).toBeCloseTo(1);
    const mid = radialDeadzone(0.6, 0, 0.2);
    expect(mid.x).toBeCloseTo(0.5);
  });
  it('combina fuentes: manda el movimiento mayor y los botones se suman', () => {
    const f = combineFrames([
      { move: { x: 0.2, y: 0 }, sprint: false, jump: true, active: true },
      { move: { x: 0, y: -0.9 }, sprint: true, jump: false, active: false },
    ]);
    expect(f.move).toEqual({ x: 0, y: -0.9 });
    expect(f.sprint && f.jump && f.active).toBe(true);
  });
});

describe('InputManager', () => {
  it('teclado: W va a la diagonal isométrica y un toque de Espacio no se pierde', () => {
    const input = new InputManager(window, new GamepadSource(() => []));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    const a = input.sample();
    expect(a.moveX).toBeCloseTo(ISO_SCREEN_UP.x);
    expect(a.moveZ).toBeCloseTo(ISO_SCREEN_UP.y);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
    expect(hasButton(input.sample().buttons, Buttons.JUMP)).toBe(true);
    const b = input.sample();
    expect(hasButton(b.buttons, Buttons.JUMP)).toBe(false);
    expect(b.seq).toBeGreaterThan(a.seq);
    input.dispose();
  });
  it('táctil: joystick analógico, correr al borde o con el botón, salto mantenido', () => {
    const input = new InputManager(window, new GamepadSource(() => []));
    input.touch.setMove(0.5, 0);
    let s = input.sample();
    expect(Math.hypot(s.moveX, s.moveZ)).toBeCloseTo(0.5);
    expect(hasButton(s.buttons, Buttons.SPRINT)).toBe(false);
    input.touch.setMove(1, 0);
    expect(hasButton(input.sample().buttons, Buttons.SPRINT)).toBe(true);
    input.touch.setMove(0.3, 0);
    input.touch.toggleSprint();
    expect(hasButton(input.sample().buttons, Buttons.SPRINT)).toBe(true);
    input.touch.setJump(true);
    input.touch.setJump(false);
    expect(hasButton(input.sample().buttons, Buttons.JUMP)).toBe(true);
    expect(input.activeDevice).toBe('touch');
    input.dispose();
  });
  it('mando: stick, cruceta, A salta, L3 corre y cambia el dispositivo activo', () => {
    let pad = fakePad([1, 0, 0, 0], [PAD.A, PAD.L3]);
    const input = new InputManager(window, new GamepadSource(() => [null, pad]));
    const changes: string[] = [];
    input.onDeviceChange = (d) => changes.push(d);
    const s = input.sample();
    expect(s.moveX).toBeCloseTo(ISO_SCREEN_RIGHT.x);
    expect(s.moveZ).toBeCloseTo(ISO_SCREEN_RIGHT.y);
    expect(hasButton(s.buttons, Buttons.JUMP)).toBe(true);
    expect(hasButton(s.buttons, Buttons.SPRINT)).toBe(true);
    expect(changes).toEqual(['gamepad']);
    pad = fakePad([0.1, 0.1, 0, 0], [PAD.UP]);
    const d = input.sample();
    expect(d.moveX).toBeCloseTo(ISO_SCREEN_UP.x);
    input.dispose();
  });
  it('zoom con la rueda y +/-', () => {
    const input = new InputManager(window, new GamepadSource(() => []));
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Equal' }));
    expect(input.consumeZoom()).toBeCloseTo(0.08 - 0.1);
    expect(input.consumeZoom()).toBe(0);
    input.dispose();
  });
});

describe('TouchControls (multitouch)', () => {
  it('joystick y salto con dedos distintos a la vez', () => {
    const touch = new TouchSource();
    const { container } = render(<TouchControls touch={touch} />);
    const zone = container.querySelector('.touch__zone')!;
    // jsdom no implementa la captura de puntero
    Element.prototype.setPointerCapture ??= () => undefined;
    fireEvent.pointerDown(zone, { pointerId: 1, clientX: 100, clientY: 400 });
    fireEvent.pointerMove(zone, { pointerId: 1, clientX: 156, clientY: 400 });
    const jump = screen.getByRole('button', { name: 'Saltar' });
    fireEvent.pointerDown(jump, { pointerId: 2 });
    const f = touch.read();
    expect(f.move.x).toBeCloseTo(1);
    expect(f.jump).toBe(true);
    expect(f.sprint).toBe(true);
    fireEvent.pointerUp(zone, { pointerId: 1 });
    fireEvent.pointerUp(jump, { pointerId: 2 });
    const g = touch.read();
    expect(g.move).toEqual({ x: 0, y: 0 });
    expect(g.jump).toBe(false);
    const sprint = screen.getByRole('button', { name: 'Correr' });
    fireEvent.pointerDown(sprint, { pointerId: 3 });
    expect(sprint.getAttribute('aria-pressed')).toBe('true');
  });
});
