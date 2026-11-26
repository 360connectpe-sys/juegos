import { describe, expect, it } from 'vitest';
import { InputHistory, PredictionController, type Predictable } from '@/net/Prediction';
import { emptyInput, type PlayerInput } from '@shared/types';

/** Simulación de juguete: x += moveX por tick. */
class ToySim implements Predictable<{ x: number }> {
  x = 0;
  snapshot() {
    return { x: this.x };
  }
  restore(s: { x: number }) {
    this.x = s.x;
  }
  step(input: PlayerInput) {
    this.x += input.moveX;
  }
}

const inp = (seq: number, moveX = 1): PlayerInput => ({ ...emptyInput(seq), moveX });

describe('InputHistory', () => {
  it('confirma por seq y descarta lo más antiguo al llenarse', () => {
    const h = new InputHistory(3);
    [1, 2, 3, 4].forEach((s) => h.push(inp(s)));
    expect([...h.pending()].map((i) => i.seq)).toEqual([2, 3, 4]);
    h.acknowledge(3);
    expect([...h.pending()].map((i) => i.seq)).toEqual([4]);
    h.acknowledge(10);
    expect(h.size).toBe(0);
  });
});

describe('PredictionController', () => {
  it('predice localmente y reconcilia re-simulando las entradas pendientes', () => {
    const sim = new ToySim();
    const pc = new PredictionController(sim, 1 / 30);
    for (let s = 1; s <= 5; s++) pc.predict(inp(s));
    expect(sim.x).toBe(5);
    // El servidor procesó hasta seq 3 pero con un resultado distinto (x = 2.5: chocó con algo).
    const replayed = pc.reconcile({ x: 2.5 }, 3);
    expect(replayed).toBe(2);
    expect(sim.x).toBe(4.5);
    expect(pc.history.size).toBe(2);
  });
});
