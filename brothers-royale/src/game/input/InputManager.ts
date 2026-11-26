import { screenToWorld } from '@shared/movement';
import { emptyInput, type PlayerInput, type Vec2 } from '@shared/types';

/**
 * Une teclado y controles táctiles en un único `PlayerInput` en ejes del mundo.
 * La UI táctil (React) escribe aquí mediante setTouchMove / pressJump.
 */
export class InputManager {
  private readonly keys = new Set<string>();
  private touchMove: Vec2 = { x: 0, y: 0 };
  private touchSprint = false;
  private jumpQueued = false;
  private seq = 0;

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  /** Vector del joystick en ejes de pantalla (x derecha, y arriba), magnitud 0..1. */
  setTouchMove(x: number, y: number): void {
    this.touchMove = { x, y };
    this.touchSprint = Math.hypot(x, y) > 0.95;
  }

  pressJump(): void {
    this.jumpQueued = true;
  }

  /** Vector de pantalla combinado (teclado tiene prioridad si se usa). */
  screenVector(): Vec2 {
    const k = this.keys;
    const kx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const ky = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (kx !== 0 || ky !== 0) return { x: kx, y: ky };
    return this.touchMove;
  }

  /** Consume la entrada del tick actual (el salto se dispara una sola vez). */
  sample(): PlayerInput {
    const v = screenToWorld(this.screenVector().x, this.screenVector().y);
    const input = emptyInput(++this.seq);
    input.moveX = v.x;
    input.moveZ = v.y;
    input.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchSprint;
    input.jump = this.jumpQueued;
    this.jumpQueued = false;
    return input;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    // Un toque rápido (keydown+keyup entre dos ticks) no debe perder el salto.
    if (e.code === 'Space' && !e.repeat) this.jumpQueued = true;
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.touchMove = { x: 0, y: 0 };
  };

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}
