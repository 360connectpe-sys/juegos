// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { InputManager } from '@/game/input/InputManager';
import { LoadingScreen } from '@/ui/components/LoadingScreen';
import { ISO_SCREEN_UP } from '@shared/movement';

afterEach(cleanup);

describe('LoadingScreen', () => {
  it('muestra el progreso accesible', () => {
    render(<LoadingScreen progress={0.4} label="Cargando física" error={null} hidden={false} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');
    expect(screen.getByText('Cargando física')).toBeTruthy();
  });
  it('muestra el error con instrucciones', () => {
    render(<LoadingScreen progress={0.4} label="x" error="WebGL no disponible" hidden={false} />);
    expect(screen.getByRole('alert').textContent).toContain('Recarga la página');
  });
});

describe('InputManager', () => {
  it('convierte W a dirección isométrica del mundo y consume el salto', () => {
    const input = new InputManager(window);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    const a = input.sample();
    expect(a.moveX).toBeCloseTo(ISO_SCREEN_UP.x);
    expect(a.moveZ).toBeCloseTo(ISO_SCREEN_UP.y);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    input.pressJump();
    expect(input.sample().jump).toBe(true);
    const b = input.sample();
    expect(b.jump).toBe(false);
    expect(b.moveX).toBe(0);
    expect(b.seq).toBeGreaterThan(a.seq);
    input.dispose();
  });
  it('el joystick al máximo activa correr', () => {
    const input = new InputManager(window);
    input.setTouchMove(1, 0);
    expect(input.sample().sprint).toBe(true);
    input.setTouchMove(0.5, 0);
    expect(input.sample().sprint).toBe(false);
    input.dispose();
  });
});

describe('InputManager salto', () => {
  it('un toque rápido de Espacio entre ticks no se pierde', () => {
    const input = new InputManager(window);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
    expect(input.sample().jump).toBe(true);
    expect(input.sample().jump).toBe(false);
    input.dispose();
  });
});
