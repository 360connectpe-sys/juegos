import type { PlayerInput } from '@shared/types';

/** Lo mínimo que necesita la reconciliación de una simulación. */
export interface Predictable<S> {
  snapshot(): S;
  restore(s: S): void;
  step(input: PlayerInput, dt: number): void;
}

/** Búfer circular de entradas aún no confirmadas por el servidor. */
export class InputHistory {
  private readonly buf: (PlayerInput | undefined)[];
  private head = 0;
  private count = 0;

  constructor(readonly capacity = 128) {
    this.buf = new Array<PlayerInput | undefined>(capacity);
  }

  push(input: PlayerInput): void {
    this.buf[(this.head + this.count) % this.capacity] = input;
    if (this.count < this.capacity) this.count++;
    else this.head = (this.head + 1) % this.capacity; // se descarta la más antigua
  }

  /** Descarta todas las entradas con seq <= ackSeq. */
  acknowledge(ackSeq: number): void {
    while (this.count > 0 && (this.buf[this.head]?.seq ?? Infinity) <= ackSeq) {
      this.buf[this.head] = undefined;
      this.head = (this.head + 1) % this.capacity;
      this.count--;
    }
  }

  get size(): number {
    return this.count;
  }

  *pending(): Generator<PlayerInput> {
    for (let i = 0; i < this.count; i++) {
      const v = this.buf[(this.head + i) % this.capacity];
      if (v) yield v;
    }
  }
}

/**
 * Predicción del lado del cliente con reconciliación (para ColyseusSession):
 *  1. cada tick: guardar la entrada, simular localmente y enviarla al servidor;
 *  2. al llegar el estado autoritativo (con lastProcessedSeq): restaurarlo y
 *     volver a aplicar las entradas que el servidor aún no ha procesado.
 */
export class PredictionController<S> {
  readonly history: InputHistory;

  constructor(
    private readonly sim: Predictable<S>,
    private readonly dt: number,
    capacity = 128,
  ) {
    this.history = new InputHistory(capacity);
  }

  /** Aplica localmente una entrada nueva (predicción). */
  predict(input: PlayerInput): void {
    this.history.push(input);
    this.sim.step(input, this.dt);
  }

  /** Corrige con el estado del servidor y re-simula lo pendiente. Devuelve cuántos ticks re-simuló. */
  reconcile(authoritative: S, lastProcessedSeq: number): number {
    this.history.acknowledge(lastProcessedSeq);
    this.sim.restore(authoritative);
    let n = 0;
    for (const input of this.history.pending()) {
      this.sim.step(input, this.dt);
      n++;
    }
    return n;
  }
}
