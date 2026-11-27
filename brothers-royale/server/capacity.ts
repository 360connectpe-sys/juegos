/**
 * Presupuesto de salas simultáneas del proceso (MAX_ROOMS). Protege las
 * instancias gratuitas (poca CPU y memoria): cada sala simula su propio mundo
 * Rapier a 30 Hz. Una sala nueva por encima del límite se rechaza con un
 * código claro (CloseCodes.SERVER_FULL); las existentes no se ven afectadas.
 */
import { DEFAULT_MAX_ROOMS } from './config';

export class RoomBudget {
  private used = 0;

  constructor(public limit: number = DEFAULT_MAX_ROOMS) {}

  /** Reserva una plaza; false si el servidor está lleno. */
  tryAcquire(): boolean {
    if (this.used >= this.limit) return false;
    this.used++;
    return true;
  }

  release(): void {
    this.used = Math.max(0, this.used - 1);
  }

  get active(): number {
    return this.used;
  }
}

/** Único por proceso (lo configura createServer). */
export const roomBudget = new RoomBudget();
