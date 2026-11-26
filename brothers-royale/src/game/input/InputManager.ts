import { isoAimYaw } from '@/engine/camera/cameraMath';
import { screenToWorld } from '@shared/movement';
import { wrapAngle } from '@shared/math';
import { Buttons, emptyInput, type PlayerInput, type Vec2 } from '@shared/types';
import {
  combineFrames,
  GamepadSource,
  type InputDevice,
  KeyboardSource,
  MouseSource,
  TouchSource,
  type InputSource,
  type LookDelta,
} from './sources';

/** Cómo convertir la entrada de este tick según la cámara activa (lo da el `Game`). */
export interface SampleContext {
  /** Vector de pantalla (x derecha, y adelante) → dirección XZ del mundo. */
  toWorld(sx: number, sy: number): Vec2;
  /** Yaw de la cámara en 3ª/1ª persona (null en isométrica). */
  cameraYaw: number | null;
  /** 1ª persona: el personaje mira siempre hacia la cámara. */
  alwaysAim: boolean;
  /** Isométrica con ratón: vector de pantalla del personaje al cursor (o null). */
  mouseAim?: Vec2 | null;
}

export const ISO_CONTEXT: SampleContext = { toWorld: screenToWorld, cameraYaw: null, alwaysAim: false };

/** Sensibilidades (multiplicadores) e inversión del eje vertical. */
export interface LookSettings {
  camera: number;
  aim: number;
  invertY: boolean;
}

/** Conversión de cada dispositivo a radianes (con sensibilidad 1). */
export const LOOK_SCALE = {
  mouse: 0.0022, // rad/px
  touch: 0.0055, // rad/px
  gamepadYaw: 2.8, // rad/s a fondo
  gamepadPitch: 2.0,
  keyboard: 2.2, // rad/s (Q/E)
} as const;

/** Giro (rad) a partir de un delta de dispositivo. Puro y testeable. */
export function lookRadians(d: LookDelta, perUnitYaw: number, perUnitPitch: number, s: LookSettings, aiming: boolean): { yaw: number; pitch: number } {
  const k = s.camera * (aiming ? s.aim : 1);
  return { yaw: -d.x * perUnitYaw * k, pitch: d.y * perUnitPitch * k * (s.invertY ? -1 : 1) };
}

/**
 * Une teclado, ratón, táctil y mando en un único `PlayerInput` (ejes del
 * mundo + botones). La perspectiva solo cambia CÓMO se convierten los ejes de
 * pantalla a mundo: la entrada que llega a la simulación (y al servidor) tiene
 * siempre el mismo formato y significado.
 */
export class InputManager {
  readonly keyboard: KeyboardSource;
  readonly mouse: MouseSource;
  readonly touch = new TouchSource();
  readonly gamepad: GamepadSource;
  private readonly sources: InputSource[];
  private seq = 0;
  private wheelZoom = 0;
  private lastAimYaw = 0;
  private aiming = false;
  look: LookSettings = { camera: 1, aim: 0.7, invertY: false };
  /** Último dispositivo con actividad (para mostrar la ayuda adecuada). */
  activeDevice: InputDevice;
  onDeviceChange: ((d: InputDevice) => void) | null = null;

  constructor(
    private readonly target: Window = window,
    gamepad?: GamepadSource,
    initialDevice: InputDevice = 'keyboard',
  ) {
    this.keyboard = new KeyboardSource(target);
    this.mouse = new MouseSource(target);
    this.gamepad = gamepad ?? new GamepadSource();
    this.sources = [this.keyboard, this.mouse, this.touch, this.gamepad];
    this.activeDevice = initialDevice;
    target.addEventListener('wheel', this.onWheel, { passive: true });
  }

  /** Construye la entrada del tick actual (consume saltos y acciones pendientes). */
  sample(ctx: SampleContext = ISO_CONTEXT): PlayerInput {
    const frames = this.sources.map((s) => {
      const f = s.read();
      if (f.active && s.device !== this.activeDevice) {
        this.activeDevice = s.device;
        this.onDeviceChange?.(s.device);
      }
      return f;
    });
    const f = combineFrames(frames);
    const v = ctx.toWorld(f.move.x, f.move.y);
    const input = emptyInput(++this.seq);
    input.moveX = v.x;
    input.moveZ = v.y;
    let buttons = (f.jump ? Buttons.JUMP : 0) | (f.sprint ? Buttons.SPRINT : 0) | ((f.actions ?? 0) & ~Buttons.AIM);
    let aim = ((f.actions ?? 0) & Buttons.AIM) !== 0 || ctx.alwaysAim;

    if (ctx.cameraYaw !== null) {
      // 3ª/1ª persona: se apunta hacia donde mira la cámara.
      this.lastAimYaw = ctx.cameraYaw;
    } else {
      // Isométrica: stick derecho / arrastre táctil, o el cursor con el botón derecho.
      const vec = f.aim ?? (aim && ctx.mouseAim ? ctx.mouseAim : null);
      const yaw = vec ? isoAimYaw(vec.x, vec.y) : null;
      if (yaw !== null) {
        this.lastAimYaw = yaw;
        aim = true;
      }
    }
    if (aim) buttons |= Buttons.AIM;
    this.aiming = aim;
    input.buttons = buttons;
    input.aimYaw = wrapAngle(this.lastAimYaw);
    return input;
  }

  /** ¿Se está apuntando? (la mirada usa entonces la sensibilidad de apuntado). */
  get isAiming(): boolean {
    return this.aiming;
  }

  /**
   * Giro de cámara de este frame (rad), sumando ratón, táctil, mando y Q/E con
   * las sensibilidades configuradas. Se llama a la frecuencia de render.
   */
  consumeLook(dt: number): { yaw: number; pitch: number } {
    const s = this.look;
    const a = this.aiming;
    let yaw = 0;
    let pitch = 0;
    const add = (r: { yaw: number; pitch: number }) => {
      yaw += r.yaw;
      pitch += r.pitch;
    };
    add(lookRadians(this.mouse.consumeLook(), LOOK_SCALE.mouse, LOOK_SCALE.mouse, s, a));
    add(lookRadians(this.touch.consumeLook(), LOOK_SCALE.touch, LOOK_SCALE.touch, s, a));
    add(lookRadians(this.gamepad.consumeLook(dt), LOOK_SCALE.gamepadYaw, LOOK_SCALE.gamepadPitch, s, a));
    add(lookRadians(this.keyboard.consumeLook(dt), LOOK_SCALE.keyboard, 0, s, false));
    return { yaw, pitch };
  }

  /**
   * Hueco del inventario pedido desde el teclado (1-5) o el mando (RB =
   * siguiente). Lo valida y aplica la autoridad; aquí solo se pide.
   */
  consumeSlotRequest(current: number, slots = 5): number | null {
    let req: number | null = this.keyboard.slotRequest;
    this.keyboard.slotRequest = null;
    if (this.gamepad.nextSlotPressed) {
      this.gamepad.nextSlotPressed = false;
      req = (current + 1) % slots;
    }
    return req;
  }

  /** Pulsa una acción una vez (botones del HUD como "Abrir"/"Recoger"). */
  pulse(bit: number): void {
    this.touch.setAction(bit, true);
    this.touch.setAction(bit, false);
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
