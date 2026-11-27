/**
 * Arrastre de un dedo que gira la cámara (3ª/1ª persona) o apunta
 * (isométrica). Lo usan la zona derecha de la pantalla Y el botón de disparo:
 * mantener pulsado el disparo y deslizar el mismo dedo mueve la cámara
 * mientras se dispara. Puro (sin DOM) para poder probarlo.
 *
 * Sin movimientos bruscos al empezar: un toque quieto (dentro de una pequeña
 * zona muerta) no gira nada, y cada evento se limita a DRAG.maxStepPx por si
 * el navegador agrupa movimientos o el dedo "salta" al apoyarse (iOS).
 */
export const DRAG = {
  /** Zona muerta inicial (px): un toque quieto no mueve la cámara. */
  deadzonePx: 6,
  /** Tope de desplazamiento por evento (px). */
  maxStepPx: 60,
  /** Recorrido del "stick" de apuntado isométrico (px). */
  aimRadiusPx: 60,
} as const;

export type DragResult = { kind: 'none' } | { kind: 'look'; dx: number; dy: number } | { kind: 'aim'; x: number; y: number };

const NONE: DragResult = { kind: 'none' };

export class TouchDrag {
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private live = false;
  private engaged = false;

  get active(): boolean {
    return this.live;
  }

  /** ¿Superó la zona muerta? (ha empezado a girar/apuntar). */
  get moving(): boolean {
    return this.engaged;
  }

  start(x: number, y: number): void {
    this.startX = this.lastX = x;
    this.startY = this.lastY = y;
    this.live = true;
    this.engaged = false;
  }

  /**
   * Nuevo punto del dedo. En 3ª/1ª persona devuelve el giro (px, ya acotado);
   * en isométrica, el vector de apuntado (−1..1) desde donde se tocó.
   */
  move(x: number, y: number, isometric: boolean): DragResult {
    if (!this.live) return NONE;
    if (!this.engaged) {
      if (Math.hypot(x - this.startX, y - this.startY) < DRAG.deadzonePx) return NONE;
      this.engaged = true;
    }
    if (isometric) {
      let ax = (x - this.startX) / DRAG.aimRadiusPx;
      let ay = (this.startY - y) / DRAG.aimRadiusPx;
      const l = Math.hypot(ax, ay);
      if (l > 1) {
        ax /= l;
        ay /= l;
      }
      return { kind: 'aim', x: ax, y: ay };
    }
    let dx = x - this.lastX;
    let dy = y - this.lastY;
    this.lastX = x;
    this.lastY = y;
    const l = Math.hypot(dx, dy);
    if (l > DRAG.maxStepPx) {
      dx = (dx / l) * DRAG.maxStepPx;
      dy = (dy / l) * DRAG.maxStepPx;
    }
    return { kind: 'look', dx, dy };
  }

  end(): void {
    this.live = false;
    this.engaged = false;
  }
}
