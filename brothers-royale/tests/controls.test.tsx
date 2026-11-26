// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { moveToWorld } from '@/engine/camera/cameraMath';
import { InputManager, ISO_CONTEXT, LOOK_SCALE, lookRadians, type SampleContext } from '@/game/input/InputManager';
import { GamepadSource, MouseSource, PAD, TouchSource } from '@/game/input/sources';
import { TouchControls } from '@/ui/components/TouchControls';
import { defaultHudLayout, updateElement } from '@/ui/hud/layout';
import { Buttons, hasButton } from '@shared/types';

afterEach(cleanup);

function fakePad(axes: number[] = [0, 0, 0, 0], pressed: number[] = []) {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), touched: false, value: pressed.includes(i) ? 1 : 0 }));
  return { axes, buttons, connected: true, mapping: 'standard' as GamepadMappingType };
}

const ctx = (mode: 'third' | 'first', yaw: number): SampleContext => ({
  toWorld: (x, y) => moveToWorld(x, y, mode, yaw),
  cameraYaw: yaw,
  alwaysAim: mode === 'first',
});

describe('entrada según la perspectiva', () => {
  it('3ª persona: W avanza hacia donde mira la cámara y el apuntado sigue a la cámara', () => {
    const input = new InputManager(window, new GamepadSource(() => []));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    const s = input.sample(ctx('third', Math.PI / 2));
    expect(s.moveX).toBeCloseTo(1);
    expect(s.moveZ).toBeCloseTo(0);
    expect(s.aimYaw).toBeCloseTo(Math.PI / 2);
    expect(hasButton(s.buttons, Buttons.AIM)).toBe(false); // sin apuntar, mira hacia donde camina
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    input.dispose();
  });
  it('1ª persona: siempre apunta con el yaw de la cámara', () => {
    const input = new InputManager(window, new GamepadSource(() => []));
    const s = input.sample(ctx('first', -1));
    expect(hasButton(s.buttons, Buttons.AIM)).toBe(true);
    expect(s.aimYaw).toBeCloseTo(-1);
    expect(input.isAiming).toBe(true);
    input.dispose();
  });
  it('isométrica: el stick de apuntado táctil gira al personaje hacia esa dirección', () => {
    const input = new InputManager(window, new GamepadSource(() => []));
    input.touch.setAim(1, 0);
    const s = input.sample(ISO_CONTEXT);
    expect(hasButton(s.buttons, Buttons.AIM)).toBe(true);
    const right = moveToWorld(1, 0, 'isometric', 0);
    expect(s.aimYaw).toBeCloseTo(Math.atan2(right.x, right.y));
    input.touch.setAim(0, 0);
    expect(hasButton(input.sample(ISO_CONTEXT).buttons, Buttons.AIM)).toBe(false);
    input.dispose();
  });
  it('isométrica con ratón: botón derecho + cursor apuntan', () => {
    const input = new InputManager(window, new GamepadSource(() => []));
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));
    const s = input.sample({ ...ISO_CONTEXT, mouseAim: { x: 0, y: 1 } });
    expect(hasButton(s.buttons, Buttons.AIM)).toBe(true);
    window.dispatchEvent(new MouseEvent('mouseup', { button: 2 }));
    canvas.remove();
    input.dispose();
  });
  it('teclas reservadas R/F/B envían su bit una vez aunque se suelten entre ticks', () => {
    const input = new InputManager(window, new GamepadSource(() => []));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyR' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB' }));
    const a = input.sample();
    expect(hasButton(a.buttons, Buttons.RELOAD)).toBe(true);
    expect(hasButton(a.buttons, Buttons.BUILD)).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyB' }));
    const b = input.sample();
    expect(hasButton(b.buttons, Buttons.RELOAD) || hasButton(b.buttons, Buttons.BUILD)).toBe(false);
    input.dispose();
  });
  it('mando: gatillos y botones de acción, stick derecho mira y apunta', () => {
    const pad = fakePad([0, 0, 1, 0], [PAD.RT, PAD.LT, PAD.X, PAD.B, PAD.Y]);
    const input = new InputManager(window, new GamepadSource(() => [pad]));
    const s = input.sample(ISO_CONTEXT);
    for (const b of [Buttons.FIRE, Buttons.AIM, Buttons.RELOAD, Buttons.INTERACT, Buttons.BUILD]) expect(hasButton(s.buttons, b)).toBe(true);
    const look = input.consumeLook(0.5);
    expect(look.yaw).toBeLessThan(0); // stick a la derecha → gira a la derecha (yaw decrece)
    input.dispose();
  });
});

describe('mirada y sensibilidad', () => {
  const base = { camera: 1, aim: 0.5, invertY: false };
  it('escala por dispositivo, sensibilidad y apuntado; invertir Y cambia el signo', () => {
    const r = lookRadians({ x: 100, y: 50 }, LOOK_SCALE.mouse, LOOK_SCALE.mouse, base, false);
    expect(r.yaw).toBeCloseTo(-100 * LOOK_SCALE.mouse);
    expect(r.pitch).toBeCloseTo(50 * LOOK_SCALE.mouse);
    const fast = lookRadians({ x: 100, y: 0 }, LOOK_SCALE.mouse, LOOK_SCALE.mouse, { ...base, camera: 2 }, false);
    expect(fast.yaw).toBeCloseTo(2 * r.yaw);
    const aiming = lookRadians({ x: 100, y: 0 }, LOOK_SCALE.mouse, LOOK_SCALE.mouse, base, true);
    expect(aiming.yaw).toBeCloseTo(0.5 * r.yaw);
    expect(lookRadians({ x: 0, y: 10 }, 1, 1, { ...base, invertY: true }, false).pitch).toBeLessThan(0);
  });
  it('arrastre táctil y ratón con puntero bloqueado se suman en consumeLook', () => {
    let locked = true;
    const mouse = new MouseSource(window, () => locked);
    window.dispatchEvent(new MouseEvent('mousemove', { movementX: 10, movementY: 0 } as MouseEventInit));
    // jsdom no implementa movementX: el evento llega con 0; se comprueba el bloqueo.
    expect(mouse.consumeLook().x).toBeGreaterThanOrEqual(0);
    locked = false;
    mouse.dispose();
    const input = new InputManager(window, new GamepadSource(() => []));
    input.look = { camera: 1, aim: 1, invertY: false };
    input.touch.addLook(40, -20);
    const l = input.consumeLook(1 / 60);
    expect(l.yaw).toBeCloseTo(-40 * LOOK_SCALE.touch);
    expect(l.pitch).toBeCloseTo(-20 * LOOK_SCALE.touch);
    expect(input.consumeLook(1 / 60).yaw).toBe(0); // se consume
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
    expect(input.consumeLook(0.5).yaw).toBeCloseTo(-0.5 * LOOK_SCALE.keyboard);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
    input.dispose();
  });
});

describe('controles táctiles multitouch con disposición del HUD', () => {
  Element.prototype.setPointerCapture ??= () => undefined;
  it('joystick y mirada a la vez (dos dedos) en 3ª persona', () => {
    const touch = new TouchSource();
    const { container } = render(<TouchControls touch={touch} mode="third" />);
    const zone = container.querySelector('.touch__zone')!;
    const look = container.querySelector('.touch__look')!;
    fireEvent.pointerDown(zone, { pointerId: 1, clientX: 100, clientY: 300 });
    fireEvent.pointerMove(zone, { pointerId: 1, clientX: 100, clientY: 244 });
    fireEvent.pointerDown(look, { pointerId: 2, clientX: 600, clientY: 200 });
    fireEvent.pointerMove(look, { pointerId: 2, clientX: 630, clientY: 190 });
    const f = touch.read();
    expect(f.move.y).toBeCloseTo(1);
    const d = touch.consumeLook();
    expect(d).toEqual({ x: 30, y: -10 });
    fireEvent.pointerUp(look, { pointerId: 2 });
    fireEvent.pointerUp(zone, { pointerId: 1 });
  });
  it('en isométrica la zona derecha es un stick de apuntado', () => {
    const touch = new TouchSource();
    const { container } = render(<TouchControls touch={touch} mode="isometric" />);
    const look = container.querySelector('.touch__look')!;
    fireEvent.pointerDown(look, { pointerId: 3, clientX: 600, clientY: 200 });
    fireEvent.pointerMove(look, { pointerId: 3, clientX: 720, clientY: 200 });
    expect(touch.read().aim).toEqual({ x: 1, y: 0 });
    fireEvent.pointerUp(look, { pointerId: 3 });
    expect(touch.read().aim).toBeUndefined();
  });
  it('botones de acción reservada envían su bit mientras se mantienen', () => {
    const touch = new TouchSource();
    render(<TouchControls touch={touch} />);
    const attack = screen.getByRole('button', { name: 'Atacar' });
    fireEvent.pointerDown(attack, { pointerId: 4 });
    expect(hasButton(touch.read().actions ?? 0, Buttons.FIRE)).toBe(true);
    fireEvent.pointerUp(attack, { pointerId: 4 });
    expect(hasButton(touch.read().actions ?? 0, Buttons.FIRE)).toBe(false);
    for (const name of ['Apuntar', 'Recargar', 'Usar', 'Construir', 'Saltar', 'Correr']) expect(screen.getByRole('button', { name })).toBeTruthy();
  });
  it('respeta posición, tamaño, opacidad y visibilidad del HUD', () => {
    const touch = new TouchSource();
    let layout = updateElement(defaultHudLayout(), 'jump', { x: 0.5, y: 0.4, scale: 1.5, opacity: 0.6 });
    layout = updateElement(layout, 'build', { visible: false });
    const { container } = render(<TouchControls touch={touch} layout={layout} />);
    const slot = container.querySelector('[data-hud="jump"]') as HTMLElement;
    expect(slot.style.getPropertyValue('--x')).toBe('0.5');
    expect(slot.style.getPropertyValue('--s')).toBe('1.5');
    expect(slot.style.getPropertyValue('--o')).toBe('0.6');
    expect(screen.queryByRole('button', { name: 'Construir' })).toBeNull();
  });
});
