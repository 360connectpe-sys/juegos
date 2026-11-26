export type ContextStatus = 'ok' | 'lost' | 'restored' | 'failed';

/**
 * Vigila la pérdida del contexto WebGL (frecuente en móviles al cambiar de
 * app, con poca memoria o al reiniciarse el driver).
 *  - 'lost': se llama a preventDefault() para que el navegador pueda devolverlo.
 *  - 'restored': Three.js re-crea sus recursos; el juego re-dibuja sombras, etc.
 *  - 'failed': no volvió en `timeoutMs`; la interfaz ofrece recargar.
 */
export class ContextLossMonitor {
  status: ContextStatus = 'ok';
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly target: EventTarget,
    private readonly onChange: (s: ContextStatus) => void,
    private readonly timeoutMs = 6000,
  ) {
    target.addEventListener('webglcontextlost', this.onLost);
    target.addEventListener('webglcontextrestored', this.onRestored);
  }

  get lost(): boolean {
    return this.status === 'lost' || this.status === 'failed';
  }

  private set(s: ContextStatus): void {
    this.status = s;
    this.onChange(s);
  }

  private onLost = (e: Event): void => {
    e.preventDefault();
    this.clearTimer();
    this.set('lost');
    this.timer = setTimeout(() => {
      if (this.status === 'lost') this.set('failed');
    }, this.timeoutMs);
  };

  private onRestored = (): void => {
    this.clearTimer();
    this.set('restored');
  };

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.clearTimer();
    this.target.removeEventListener('webglcontextlost', this.onLost);
    this.target.removeEventListener('webglcontextrestored', this.onRestored);
  }
}
