import { Buttons, type Vec2 } from '@shared/types';

export type InputDevice = 'keyboard' | 'touch' | 'gamepad';

/** Lectura de una fuente de entrada en ejes de PANTALLA (x derecha, y arriba/adelante). */
export interface InputFrame {
  move: Vec2;
  sprint: boolean;
  /** Salto pulsado ahora o en algún momento desde la última lectura. */
  jump: boolean;
  /** Hubo actividad en esta fuente desde la última lectura. */
  active: boolean;
  /**
   * Acciones reservadas (máscara de `Buttons`: FIRE, AIM, RELOAD, INTERACT,
   * BUILD…). Viajan al servidor pero aún no tienen efecto (fase 4).
   */
  actions?: number;
  /** Stick/arrastre de apuntado en pantalla (modo isométrico), magnitud 0..1. */
  aim?: Vec2;
}

/**
 * Giro de mirada acumulado, en unidades de cada dispositivo:
 * píxeles (ratón, táctil) o "stick × segundos" (mando, teclado).
 */
export interface LookDelta {
  /** Positivo = a la derecha. */
  x: number;
  /** Positivo = hacia abajo. */
  y: number;
}

export interface InputSource {
  readonly device: InputDevice;
  read(): InputFrame;
  /** Mirada acumulada desde la última llamada (se consume cada frame de render). */
  consumeLook?(dt: number): LookDelta;
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

/** Combina fuentes: manda la de mayor magnitud de movimiento/apuntado; botones en OR. */
export function combineFrames(frames: InputFrame[]): InputFrame {
  let move = ZERO;
  let best = 0;
  let aim: Vec2 | undefined;
  let bestAim = 0;
  let sprint = false;
  let jump = false;
  let active = false;
  let actions = 0;
  for (const f of frames) {
    const m = Math.hypot(f.move.x, f.move.y);
    if (m > best) {
      best = m;
      move = f.move;
    }
    if (f.aim) {
      const a = Math.hypot(f.aim.x, f.aim.y);
      if (a > bestAim) {
        bestAim = a;
        aim = f.aim;
      }
    }
    sprint ||= f.sprint;
    jump ||= f.jump;
    active ||= f.active;
    actions |= f.actions ?? 0;
  }
  const out: InputFrame = { move, sprint, jump, active, actions };
  if (aim) out.aim = aim;
  return out;
}

// ---------------------------------------------------------------------------

/** ¿El evento viene de un campo donde el usuario escribe? */
export function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true;
}

/** Teclas de acciones reservadas → bit de `Buttons`. */
export const KEY_ACTIONS: Readonly<Record<string, number>> = {
  KeyR: Buttons.RELOAD,
  KeyF: Buttons.INTERACT,
  KeyB: Buttons.BUILD,
};

/** Teclas de construcción directa (como los tres botones táctiles, más el techo). */
export const BUILD_KEYS: Readonly<Record<string, 'wall' | 'floor' | 'ramp' | 'roof'>> = { KeyZ: 'wall', KeyX: 'floor', KeyC: 'ramp', KeyV: 'roof' };

export class KeyboardSource implements InputSource {
  readonly device = 'keyboard' as const;
  private readonly keys = new Set<string>();
  private jumpLatch = false;
  private actionLatch = 0;
  private activity = false;
  zoomDelta = 0;
  /** Hueco pedido con las teclas 1-5 (o null). */
  slotRequest: number | null = null;
  /** Pieza pedida con Z (pared), X (suelo), C (rampa) o V (techo): abre el modo construcción. */
  buildRequest: 'wall' | 'floor' | 'ramp' | 'roof' | null = null;

  constructor(private readonly target: Window) {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  read(): InputFrame {
    const k = this.keys;
    const x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let actions = this.actionLatch;
    for (const [code, bit] of Object.entries(KEY_ACTIONS)) if (k.has(code)) actions |= bit;
    const frame: InputFrame = {
      move: { x, y },
      sprint: k.has('ShiftLeft') || k.has('ShiftRight'),
      jump: this.jumpLatch || k.has('Space'),
      active: this.activity,
      actions,
    };
    this.jumpLatch = false;
    this.actionLatch = 0;
    this.activity = false;
    return frame;
  }

  /** Q / E giran la cámara (3ª y 1ª persona) a ritmo constante. */
  consumeLook(dt: number): LookDelta {
    const k = this.keys;
    return { x: ((k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0)) * dt, y: 0 };
  }

  private onDown = (e: KeyboardEvent): void => {
    // Escribir en un campo de texto (p. ej. el nombre) no mueve al personaje.
    if (isEditable(e.target)) return;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    // Un toque rápido (keydown+keyup entre dos ticks) no debe perder el salto.
    if (e.code === 'Space' && !e.repeat) this.jumpLatch = true;
    const digit = /^(?:Digit|Numpad)([1-5])$/.exec(e.code);
    if (digit && !e.repeat) this.slotRequest = Number(digit[1]) - 1;
    const piece = BUILD_KEYS[e.code];
    if (piece && !e.repeat) this.buildRequest = piece;
    const action = KEY_ACTIONS[e.code];
    if (action && !e.repeat) this.actionLatch |= action;
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

/**
 * Ratón: con el puntero bloqueado (3ª/1ª persona) su movimiento gira la
 * cámara. Botón izquierdo = ataque (reservado), derecho = apuntar. En
 * isométrica, la posición del cursor sirve para apuntar mientras se mantiene
 * el botón derecho (el `Game` la proyecta respecto al personaje).
 */
export class MouseSource implements InputSource {
  readonly device = 'keyboard' as const;
  private dx = 0;
  private dy = 0;
  private buttons = 0;
  private latch = 0;
  private activity = false;
  /** Posición del cursor (px de la ventana) para el apuntado isométrico. */
  readonly cursor = { x: 0, y: 0 };

  constructor(
    private readonly target: Window,
    private readonly isLocked: () => boolean = () => typeof document !== 'undefined' && !!document.pointerLockElement,
  ) {
    target.addEventListener('mousemove', this.onMove);
    target.addEventListener('mousedown', this.onDown);
    target.addEventListener('mouseup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  get aimHeld(): boolean {
    return (this.buttons & Buttons.AIM) !== 0;
  }

  read(): InputFrame {
    const f: InputFrame = { move: ZERO, sprint: false, jump: false, active: this.activity, actions: this.buttons | this.latch };
    this.latch = 0;
    this.activity = false;
    return f;
  }

  consumeLook(): LookDelta {
    const d = { x: this.dx, y: this.dy };
    this.dx = 0;
    this.dy = 0;
    return d;
  }

  private onMove = (e: MouseEvent): void => {
    this.cursor.x = e.clientX;
    this.cursor.y = e.clientY;
    if (!this.isLocked()) return;
    this.dx += e.movementX || 0;
    this.dy += e.movementY || 0;
    this.activity = true;
  };

  private bit(button: number): number {
    return button === 0 ? Buttons.FIRE : button === 2 ? Buttons.AIM : 0;
  }

  private onDown = (e: MouseEvent): void => {
    if (isEditable(e.target)) return;
    // Solo cuenta sobre el juego (lienzo) o con el puntero bloqueado, nunca sobre la interfaz.
    const onCanvas = (e.target as HTMLElement | null)?.tagName === 'CANVAS';
    if (!onCanvas && !this.isLocked()) return;
    const b = this.bit(e.button);
    this.buttons |= b;
    this.latch |= b;
    this.activity = true;
  };

  private onUp = (e: MouseEvent): void => {
    this.buttons &= ~this.bit(e.button);
  };

  private onBlur = (): void => {
    this.buttons = 0;
  };

  dispose(): void {
    this.target.removeEventListener('mousemove', this.onMove);
    this.target.removeEventListener('mousedown', this.onDown);
    this.target.removeEventListener('mouseup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}

// ---------------------------------------------------------------------------

/** Estado que escriben los controles táctiles (UI). Varios dedos a la vez. */
export class TouchSource implements InputSource {
  readonly device = 'touch' as const;
  private move: Vec2 = { x: 0, y: 0 };
  private aim: Vec2 = { x: 0, y: 0 };
  private sprintToggle = false;
  /** Mira conmutable: una pulsación la activa y otra la desactiva (no hay que mantener). */
  private aimToggle = false;
  private jumpHeld = false;
  private jumpLatch = false;
  private held = 0;
  private latch = 0;
  private lookX = 0;
  private lookY = 0;
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

  /** Activa/desactiva la mira (botón Apuntar). Devuelve el nuevo estado. */
  toggleAim(): boolean {
    this.aimToggle = !this.aimToggle;
    this.activity = true;
    return this.aimToggle;
  }

  get aiming(): boolean {
    return this.aimToggle;
  }

  /** Botones de acción (ataque, apuntar, recarga, interacción, construcción). */
  setAction(bit: number, down: boolean): void {
    if (down) {
      this.held |= bit;
      this.latch |= bit;
    } else this.held &= ~bit;
    this.activity = true;
  }

  /** Arrastre en la zona derecha: gira la cámara (px). Se suma con el movimiento. */
  addLook(dxPx: number, dyPx: number): void {
    this.lookX += dxPx;
    this.lookY += dyPx;
    this.activity = true;
  }

  /** Stick de apuntado (modo isométrico): vector de pantalla 0..1, (0,0) al soltar. */
  setAim(x: number, y: number): void {
    this.aim = { x, y };
    this.activity = true;
  }

  consumeLook(): LookDelta {
    const d = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return d;
  }

  read(): InputFrame {
    const mag = Math.hypot(this.move.x, this.move.y);
    const frame: InputFrame = {
      move: this.move,
      // Correr: botón (bloqueo) o empujar el joystick hasta el borde.
      sprint: this.sprintToggle || mag > 0.95,
      jump: this.jumpLatch || this.jumpHeld,
      active: this.activity,
      actions: this.held | this.latch | (this.aimToggle ? Buttons.AIM : 0),
    };
    if (this.aim.x !== 0 || this.aim.y !== 0) frame.aim = this.aim;
    this.jumpLatch = false;
    this.latch = 0;
    this.activity = false;
    return frame;
  }

  reset(): void {
    this.move = { x: 0, y: 0 };
    this.aim = { x: 0, y: 0 };
    this.jumpHeld = false;
    this.aimToggle = false;
    this.held = 0;
    this.lookX = 0;
    this.lookY = 0;
  }

  dispose(): void {
    this.reset();
  }
}

// ---------------------------------------------------------------------------

/** Botones del mapeo "standard" de la Gamepad API. */
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;

/** Botones del mando → acciones reservadas. */
export const PAD_ACTIONS: readonly (readonly [number, number])[] = [
  [PAD.RT, Buttons.FIRE],
  [PAD.LT, Buttons.AIM],
  [PAD.X, Buttons.RELOAD],
  [PAD.B, Buttons.INTERACT],
  [PAD.Y, Buttons.BUILD],
];

type GamepadLike = Pick<Gamepad, 'axes' | 'buttons' | 'connected' | 'mapping'>;

/**
 * Mando por Gamepad API (se lee por sondeo). Stick izquierdo o cruceta para
 * moverse, A saltar, L3/LB correr, stick derecho mirar (3ª/1ª persona) o
 * apuntar (isométrica), LT apuntar, RT ataque, X recarga, B interacción,
 * Y construcción (estas tres últimas, reservadas).
 */
export class GamepadSource implements InputSource {
  readonly device = 'gamepad' as const;
  private prevJump = false;
  private prevNext = false;
  /** RB: pasar al hueco siguiente (se cuenta en el flanco). */
  nextSlotPressed = false;
  connected = false;

  constructor(private readonly getPads: () => readonly (GamepadLike | null)[] = () => navigator.getGamepads?.() ?? []) {}

  private pad(): GamepadLike | null {
    for (const p of this.getPads()) if (p && p.connected) return p;
    return null;
  }

  private rightStick(p: GamepadLike): Vec2 {
    return radialDeadzone(p.axes[2] ?? 0, -(p.axes[3] ?? 0), 0.18);
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
    const next = pressed(PAD.RB);
    if (next && !this.prevNext) this.nextSlotPressed = true;
    this.prevNext = next;
    let actions = 0;
    for (const [btn, bit] of PAD_ACTIONS) if (pressed(btn)) actions |= bit;
    const aim = this.rightStick(p);
    const anyButton = p.buttons.some((b) => b.pressed);
    const active = anyButton || move.x !== 0 || move.y !== 0 || aim.x !== 0 || aim.y !== 0;
    this.prevJump = jump;
    const frame: InputFrame = { move, sprint: pressed(PAD.L3) || pressed(PAD.LB), jump, active, actions };
    if (aim.x !== 0 || aim.y !== 0) frame.aim = aim;
    return frame;
  }

  /** Stick derecho como giro de cámara (stick × segundos). Y hacia abajo positiva. */
  consumeLook(dt: number): LookDelta {
    const p = this.pad();
    if (!p) return { x: 0, y: 0 };
    const s = this.rightStick(p);
    return { x: s.x * dt, y: -s.y * dt };
  }

  /** Para la UI: ¿se pulsó el salto en el último sondeo? */
  get jumpHeld(): boolean {
    return this.prevJump;
  }

  dispose(): void {}
}
