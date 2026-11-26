import type { Vec2 } from '@shared/types';

export type InputDevice = 'keyboard' | 'touch' | 'gamepad';

/** Lectura de una fuente de entrada en ejes de PANTALLA (x derecha, y arriba). */
export interface InputFrame {
  move: Vec2;
  sprint: boolean;
  /** Salto pulsado ahora o en algún momento desde la última lectura. */
  jump: boolean;
  /** Hubo actividad en esta fuente desde la última lectura. */
  active: boolean;
}

export interface InputSource {
  readonly device: InputDevice;
  read(): InputFrame;
  dispose(): void;
}

const ZERO: Vec2 = { x: 0, y: 0 };

/** Zona muerta radial con reescalado (sin "escalón" al salir de la zona muerta). */
export function radialDeadzone(x: number, y: number, deadzone: number): Vec2 {
  const len = Math.hypot(x, y);
  if (len <= deadzone) return { x: 0, y: 0 };
  const scaled = Math.min(1, (len - deadzone) / (1 - deadzone));
  return { x: (x / len) * scaled, y: (y / len) * scaled };
}

/** Combina fuentes: manda la de mayor magnitud de movimiento; botones en OR. */
export function combineFrames(frames: InputFrame[]): InputFrame {
  let move = ZERO;
  let best = 0;
  let sprint = false;
  let jump = false;
  let active = false;
  for (const f of frames) {
    const m = Math.hypot(f.move.x, f.move.y);
    if (m > best) {
      best = m;
      move = f.move;
    }
    sprint ||= f.sprint;
    jump ||= f.jump;
    active ||= f.active;
  }
  return { move, sprint, jump, active };
}

// ---------------------------------------------------------------------------

/** ¿El evento viene de un campo donde el usuario escribe? */
export function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true;
}

export class KeyboardSource implements InputSource {
  readonly device = 'keyboard' as const;
  private readonly keys = new Set<string>();
  private jumpLatch = false;
  private activity = false;
  zoomDelta = 0;

  constructor(private readonly target: Window) {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  read(): InputFrame {
    const k = this.keys;
    const x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const frame: InputFrame = {
      move: { x, y },
      sprint: k.has('ShiftLeft') || k.has('ShiftRight'),
      jump: this.jumpLatch || k.has('Space'),
      active: this.activity,
    };
    this.jumpLatch = false;
    this.activity = false;
    return frame;
  }

  private onDown = (e: KeyboardEvent): void => {
    // Escribir en un campo de texto (p. ej. el nombre) no mueve al personaje.
    if (isEditable(e.target)) return;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    // Un toque rápido (keydown+keyup entre dos ticks) no debe perder el salto.
    if (e.code === 'Space' && !e.repeat) this.jumpLatch = true;
    if (e.code === 'Equal' || e.code === 'NumpadAdd') this.zoomDelta -= 0.1;
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.zoomDelta += 0.1;
    this.keys.add(e.code);
    this.activity = true;
  };

  private onUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
  };

  dispose(): void {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}

// ---------------------------------------------------------------------------

/** Estado que escriben los controles táctiles (UI). Varios dedos a la vez. */
export class TouchSource implements InputSource {
  readonly device = 'touch' as const;
  private move: Vec2 = { x: 0, y: 0 };
  private sprintToggle = false;
  private jumpHeld = false;
  private jumpLatch = false;
  private activity = false;

  setMove(x: number, y: number): void {
    this.move = { x, y };
    this.activity = true;
  }

  setJump(down: boolean): void {
    if (down && !this.jumpHeld) this.jumpLatch = true;
    this.jumpHeld = down;
    this.activity = true;
  }

  toggleSprint(): boolean {
    this.sprintToggle = !this.sprintToggle;
    this.activity = true;
    return this.sprintToggle;
  }

  get sprinting(): boolean {
    return this.sprintToggle;
  }

  read(): InputFrame {
    const mag = Math.hypot(this.move.x, this.move.y);
    const frame: InputFrame = {
      move: this.move,
      // Correr: botón (bloqueo) o empujar el joystick hasta el borde.
      sprint: this.sprintToggle || mag > 0.95,
      jump: this.jumpLatch || this.jumpHeld,
      active: this.activity,
    };
    this.jumpLatch = false;
    this.activity = false;
    return frame;
  }

  reset(): void {
    this.move = { x: 0, y: 0 };
    this.jumpHeld = false;
  }

  dispose(): void {
    this.reset();
  }
}

// ---------------------------------------------------------------------------

/** Botones del mapeo "standard" de la Gamepad API. */
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;

type GamepadLike = Pick<Gamepad, 'axes' | 'buttons' | 'connected' | 'mapping'>;

/**
 * Mando por Gamepad API (se lee por sondeo cada tick). Stick izquierdo o
 * cruceta para moverse, A para saltar, L3/LB para correr. El stick derecho y
 * los gatillos quedan libres para apuntar/disparar en la fase de combate.
 */
export class GamepadSource implements InputSource {
  readonly device = 'gamepad' as const;
  private prevJump = false;
  connected = false;

  constructor(private readonly getPads: () => readonly (GamepadLike | null)[] = () => navigator.getGamepads?.() ?? []) {}

  private pad(): GamepadLike | null {
    for (const p of this.getPads()) if (p && p.connected) return p;
    return null;
  }

  read(): InputFrame {
    const p = this.pad();
    this.connected = p !== null;
    if (!p) return { move: { x: 0, y: 0 }, sprint: false, jump: false, active: false };
    const pressed = (i: number) => p.buttons[i]?.pressed ?? false;
    let move = radialDeadzone(p.axes[0] ?? 0, -(p.axes[1] ?? 0), 0.2);
    const dx = (pressed(PAD.RIGHT) ? 1 : 0) - (pressed(PAD.LEFT) ? 1 : 0);
    const dy = (pressed(PAD.UP) ? 1 : 0) - (pressed(PAD.DOWN) ? 1 : 0);
    if (dx !== 0 || dy !== 0) move = { x: dx, y: dy };
    const jump = pressed(PAD.A);
    const anyButton = p.buttons.some((b) => b.pressed);
    const active = anyButton || move.x !== 0 || move.y !== 0;
    this.prevJump = jump;
    return { move, sprint: pressed(PAD.L3) || pressed(PAD.LB), jump, active };
  }

  /** Para la UI: ¿se pulsó el salto en el último sondeo? */
  get jumpHeld(): boolean {
    return this.prevJump;
  }

  dispose(): void {}
}
