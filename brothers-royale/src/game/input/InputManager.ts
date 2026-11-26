import { screenToWorld } from '@shared/movement';
import { Buttons, emptyInput, type PlayerInput } from '@shared/types';
import { combineFrames, GamepadSource, type InputDevice, KeyboardSource, TouchSource, type InputSource } from './sources';

/**
 * Une teclado, táctil y mando en un único `PlayerInput` (ejes del mundo +
 * botones). El resto del juego no sabe qué dispositivo se está usando.
 */
export class InputManager {
  readonly keyboard: KeyboardSource;
  readonly touch = new TouchSource();
  readonly gamepad: GamepadSource;
  private readonly sources: InputSource[];
  private seq = 0;
  private wheelZoom = 0;
  /** Último dispositivo con actividad (para mostrar la ayuda adecuada). */
  activeDevice: InputDevice;
  onDeviceChange: ((d: InputDevice) => void) | null = null;

  constructor(
    private readonly target: Window = window,
    gamepad?: GamepadSource,
    initialDevice: InputDevice = 'keyboard',
  ) {
    this.keyboard = new KeyboardSource(target);
    this.gamepad = gamepad ?? new GamepadSource();
    this.sources = [this.keyboard, this.touch, this.gamepad];
    this.activeDevice = initialDevice;
    target.addEventListener('wheel', this.onWheel, { passive: true });
  }

  /** Construye la entrada del tick actual (consume los saltos pendientes). */
  sample(aimYaw = 0): PlayerInput {
    const frames = this.sources.map((s) => {
      const f = s.read();
      if (f.active && s.device !== this.activeDevice) {
        this.activeDevice = s.device;
        this.onDeviceChange?.(s.device);
      }
      return f;
    });
    const f = combineFrames(frames);
    const v = screenToWorld(f.move.x, f.move.y);
    const input = emptyInput(++this.seq);
    input.moveX = v.x;
    input.moveZ = v.y;
    input.buttons = (f.jump ? Buttons.JUMP : 0) | (f.sprint ? Buttons.SPRINT : 0);
    input.aimYaw = aimYaw;
    return input;
  }

  /** Cambio de zoom acumulado (rueda del ratón, +/-), solo cliente. */
  consumeZoom(): number {
    const z = this.wheelZoom + this.keyboard.zoomDelta;
    this.wheelZoom = 0;
    this.keyboard.zoomDelta = 0;
    return z;
  }

  private onWheel = (e: WheelEvent): void => {
    this.wheelZoom += Math.sign(e.deltaY) * 0.08;
  };

  dispose(): void {
    this.sources.forEach((s) => s.dispose());
    this.target.removeEventListener('wheel', this.onWheel);
  }
}
