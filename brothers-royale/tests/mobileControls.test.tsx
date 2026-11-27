// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TouchControls } from '@/ui/components/TouchControls';
import { TouchSource } from '@/game/input/sources';
import { DRAG, TouchDrag } from '@/game/input/touchDrag';
import { InputManager } from '@/game/input/InputManager';
import { defaultHudLayout, HUD_IDS, parseHudLayout, resetHudLayout, saveHudLayout, loadHudLayout } from '@/ui/hud/layout';
import { Buttons, hasButton } from '@shared/types';

afterEach(cleanup);

const attackBtn = () => screen.getByRole('button', { name: /Atacar|Disparar|Golpear|Curar/ });

describe('arrastre táctil sin saltos', () => {
  it('zona muerta inicial y tope por evento', () => {
    const d = new TouchDrag();
    d.start(100, 100);
    expect(d.move(103, 102, false)).toEqual({ kind: 'none' }); // toque quieto: nada
    expect(d.move(130, 90, false)).toEqual({ kind: 'look', dx: 30, dy: -10 });
    const big = d.move(530, 90, false); // salto de 400 px en un evento
    expect(big.kind).toBe('look');
    expect(Math.hypot((big as { dx: number }).dx, (big as { dy: number }).dy)).toBeCloseTo(DRAG.maxStepPx, 6);
    d.end();
    expect(d.move(600, 90, false)).toEqual({ kind: 'none' });
  });
  it('isométrica: vector de apuntado desde donde se tocó, acotado a 1', () => {
    const d = new TouchDrag();
    d.start(0, 0);
    expect(d.move(DRAG.aimRadiusPx * 3, 0, true)).toEqual({ kind: 'aim', x: 1, y: 0 });
  });
});

describe('disparo con el mismo dedo que mueve la cámara', () => {
  it.each(['third', 'first'] as const)('%s: mantener dispara, deslizar gira, soltar detiene', (mode) => {
    const touch = new TouchSource();
    render(<TouchControls touch={touch} mode={mode} />);
    const b = attackBtn();
    fireEvent.pointerDown(b, { pointerId: 7, clientX: 700, clientY: 250 });
    fireEvent.pointerMove(b, { pointerId: 7, clientX: 740, clientY: 240 });
    const f = touch.read();
    expect(hasButton(f.actions ?? 0, Buttons.FIRE)).toBe(true);
    expect(touch.consumeLook()).toEqual({ x: 40, y: -10 });
    fireEvent.pointerUp(b, { pointerId: 7 });
    expect(hasButton(touch.read().actions ?? 0, Buttons.FIRE)).toBe(false);
  });

  it('isométrica: deslizar desde el botón apunta; cancelar el toque detiene el disparo y suelta el apuntado', () => {
    const touch = new TouchSource();
    render(<TouchControls touch={touch} mode="isometric" />);
    const b = attackBtn();
    fireEvent.pointerDown(b, { pointerId: 3, clientX: 700, clientY: 250 });
    fireEvent.pointerMove(b, { pointerId: 3, clientX: 700, clientY: 190 });
    let f = touch.read();
    expect(hasButton(f.actions ?? 0, Buttons.FIRE)).toBe(true);
    expect(f.aim).toEqual({ x: 0, y: 1 });
    fireEvent.pointerCancel(b, { pointerId: 3 });
    f = touch.read();
    expect(hasButton(f.actions ?? 0, Buttons.FIRE)).toBe(false);
    expect(f.aim).toBeUndefined();
  });

  it('perder la captura del dedo también detiene el disparo', () => {
    const touch = new TouchSource();
    render(<TouchControls touch={touch} mode="third" />);
    const b = attackBtn();
    fireEvent.pointerDown(b, { pointerId: 4, clientX: 700, clientY: 250 });
    expect(hasButton(touch.read().actions ?? 0, Buttons.FIRE)).toBe(true); // un tick disparando
    fireEvent.lostPointerCapture(b, { pointerId: 4 });
    expect(hasButton(touch.read().actions ?? 0, Buttons.FIRE)).toBe(false);
  });

  it('dos dedos: caminar con el joystick mientras se dispara y se gira con el otro', () => {
    const touch = new TouchSource();
    const { container } = render(<TouchControls touch={touch} mode="third" />);
    const zone = container.querySelector('.touch__zone')!;
    fireEvent.pointerDown(zone, { pointerId: 1, clientX: 100, clientY: 300 });
    fireEvent.pointerMove(zone, { pointerId: 1, clientX: 100, clientY: 244 });
    const b = attackBtn();
    fireEvent.pointerDown(b, { pointerId: 2, clientX: 700, clientY: 250 });
    fireEvent.pointerMove(b, { pointerId: 2, clientX: 720, clientY: 250 });
    const f = touch.read();
    expect(f.move.y).toBeCloseTo(1);
    expect(hasButton(f.actions ?? 0, Buttons.FIRE)).toBe(true);
    expect(touch.consumeLook().x).toBe(20);
  });
});

describe('mira conmutable', () => {
  it('una pulsación activa, otra desactiva; se ve el estado; sin mantener', () => {
    const touch = new TouchSource();
    render(<TouchControls touch={touch} mode="third" />);
    const aim = screen.getByRole('button', { name: 'Apuntar' });
    fireEvent.pointerDown(aim, { pointerId: 9 });
    fireEvent.pointerUp(aim, { pointerId: 9 });
    expect(aim.getAttribute('aria-pressed')).toBe('true');
    expect(aim.className).toContain('is-toggled');
    // Sigue activa sin mantener, y a la vez se dispara y camina.
    const b = attackBtn();
    fireEvent.pointerDown(b, { pointerId: 10, clientX: 700, clientY: 250 });
    touch.setMove(0, 1);
    let f = touch.read();
    expect(hasButton(f.actions ?? 0, Buttons.AIM)).toBe(true);
    expect(hasButton(f.actions ?? 0, Buttons.FIRE)).toBe(true);
    expect(f.move.y).toBe(1);
    fireEvent.pointerUp(b, { pointerId: 10 });
    f = touch.read();
    expect(hasButton(f.actions ?? 0, Buttons.AIM)).toBe(true);
    expect(hasButton(f.actions ?? 0, Buttons.FIRE)).toBe(false);
    fireEvent.pointerDown(aim, { pointerId: 11 });
    expect(aim.getAttribute('aria-pressed')).toBe('false');
    expect(hasButton(touch.read().actions ?? 0, Buttons.AIM)).toBe(false);
  });

  it('el juego recibe AIM con la mira activada en 3ª persona (y la sensibilidad de apuntado se aplica)', () => {
    const im = new InputManager(window);
    im.touch.toggleAim();
    const input = im.sample({ toWorld: (x, y) => ({ x, y }), cameraYaw: 0.5, alwaysAim: false });
    expect(hasButton(input.buttons, Buttons.AIM)).toBe(true);
    expect(im.isAiming).toBe(true);
    im.look = { camera: 1, aim: 0.5, invertY: false };
    im.touch.addLook(100, 0);
    const aimed = im.consumeLook(0.016).yaw;
    im.touch.toggleAim();
    im.sample({ toWorld: (x, y) => ({ x, y }), cameraYaw: 0.5, alwaysAim: false });
    im.touch.addLook(100, 0);
    expect(Math.abs(aimed)).toBeCloseTo(Math.abs(im.consumeLook(0.016).yaw) * 0.5, 6);
    im.dispose();
  });
});

describe('construcción con teclado (el techo sigue disponible)', () => {
  it('Z/X/C/V piden pared, suelo, rampa y techo; escribir en un campo no construye', () => {
    const im = new InputManager(window);
    for (const [code, kind] of [['KeyZ', 'wall'], ['KeyX', 'floor'], ['KeyC', 'ramp'], ['KeyV', 'roof']] as const) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code }));
      expect(im.keyboard.buildRequest).toBe(kind);
      window.dispatchEvent(new KeyboardEvent('keyup', { code }));
      im.keyboard.buildRequest = null;
    }
    const input = document.createElement('input');
    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', bubbles: true }));
    expect(im.keyboard.buildRequest).toBeNull();
    input.remove();
    im.dispose();
  });
});

describe('HUD móvil: nueva distribución y preferencias', () => {
  it('lo guardado con la disposición de fábrica antigua migra; lo personalizado se respeta', () => {
    const old = {
      construction: { x: 0.48, y: 0.68, scale: 0.85, opacity: 1, visible: true }, // fábrica antigua (ventana central)
      attack: { x: 0.79, y: 0.6, scale: 1.05, opacity: 1, visible: true },
      jump: { x: 0.5, y: 0.5, scale: 1.2, opacity: 0.7, visible: true }, // personalizado
    };
    const l = parseHudLayout(old);
    const def = defaultHudLayout();
    expect(l.construction).toEqual(def.construction);
    expect(l.attack).toEqual(def.attack);
    expect(l.jump).toEqual({ x: 0.5, y: 0.5, scale: 1.2, opacity: 0.7, visible: true });
  });

  it('Restablecer aplica la nueva distribución y el editor sigue guardando', () => {
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    const custom = { ...defaultHudLayout(), minimap: { x: 0.1, y: 0.9, scale: 0.6, opacity: 0.5, visible: true } };
    saveHudLayout(custom, st);
    expect(loadHudLayout(st).minimap).toEqual(custom.minimap);
    expect(resetHudLayout(st)).toEqual(defaultHudLayout());
    expect(loadHudLayout(st)).toEqual(defaultHudLayout());
  });

  it('zona central despejada: ningún elemento de fábrica en el centro de la pantalla', () => {
    const def = defaultHudLayout();
    for (const id of HUD_IDS) {
      const e = def[id];
      const central = e.x > 0.35 && e.x < 0.65 && e.y > 0.25 && e.y < 0.75;
      expect(central, id).toBe(false);
    }
    // Construcción a la izquierda, combate a la derecha.
    expect(def.construction.x).toBeLessThan(0.1);
    for (const id of ['attack', 'aim', 'jump'] as const) expect(def[id].x).toBeGreaterThan(0.75);
  });
});
