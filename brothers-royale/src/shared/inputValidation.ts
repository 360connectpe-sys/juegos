import { AIM_PITCH_LIMIT } from './combat/weapons';
import { Buttons, type PlayerInput } from './types';

const KNOWN_BUTTONS = Object.values(Buttons).reduce((mask, button) => mask | button, 0);

/** Valida sin mutar. Una entrada rechazada no consume su secuencia. */
export function isValidPlayerInput(value: unknown, lastProcessedSeq: number): value is PlayerInput {
  if (typeof value !== 'object' || value === null) return false;
  const input = value as Record<string, unknown>;
  const { seq, moveX, moveZ, aimYaw, buttons, aimPitch, viewTick } = input;
  return typeof seq === 'number' && Number.isSafeInteger(seq) && seq >= 0 && seq > lastProcessedSeq
    && typeof moveX === 'number' && Number.isFinite(moveX)
    && typeof moveZ === 'number' && Number.isFinite(moveZ)
    // Margen para el redondeo de la proyección isométrica del cliente.
    && Math.hypot(moveX, moveZ) <= 1 + 1e-12
    && typeof aimYaw === 'number' && Number.isFinite(aimYaw)
    && typeof buttons === 'number' && Number.isSafeInteger(buttons)
    && buttons >= 0 && buttons <= KNOWN_BUTTONS && (buttons & ~KNOWN_BUTTONS) === 0
    && (aimPitch === undefined || (typeof aimPitch === 'number' && Number.isFinite(aimPitch) && Math.abs(aimPitch) <= AIM_PITCH_LIMIT))
    && (viewTick === undefined || (typeof viewTick === 'number' && Number.isSafeInteger(viewTick) && viewTick >= 0));
}
