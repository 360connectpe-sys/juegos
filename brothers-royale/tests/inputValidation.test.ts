import { describe, expect, it } from 'vitest';
import { isValidPlayerInput } from '@shared/inputValidation';
import { Buttons, emptyInput } from '@shared/types';
import { InputHistory, PredictionController } from '@/net/Prediction';

describe('validación compartida de entradas', () => {
  it.each([
    undefined, null, {}, [], 'entrada', 1, true,
    { ...emptyInput(1), seq: NaN }, { ...emptyInput(1), seq: Infinity },
    { ...emptyInput(1), buttons: NaN }, { ...emptyInput(1), buttons: Infinity },
    { ...emptyInput(1), aimYaw: NaN }, { ...emptyInput(1), aimYaw: '0' }, { ...emptyInput(1), moveX: NaN },
    { ...emptyInput(1), moveZ: Infinity }, { ...emptyInput(1), aimYaw: -Infinity },
    { ...emptyInput(1), moveX: 1, moveZ: 1 },
    { ...emptyInput(1), buttons: 256 }, { ...emptyInput(1), buttons: -1 },
    { ...emptyInput(1), buttons: 2 ** 32 }, { ...emptyInput(1), buttons: 1.5 },
    { ...emptyInput(1), seq: 1.5 }, { ...emptyInput(1), seq: Number.MAX_SAFE_INTEGER + 1 },
    { ...emptyInput(1), seq: -1 }, { ...emptyInput(1), moveX: '1' },
  ])('rechaza una entrada inválida %j', (input) => {
    expect(isValidPlayerInput(input, 0)).toBe(false);
  });
  it('acepta controles analógicos y botones reconocidos, con secuencia estricta', () => {
    const input = { ...emptyInput(5), moveX: 0.6, moveZ: 0.8, buttons: Buttons.JUMP | Buttons.SPRINT };
    expect(isValidPlayerInput(input, 4)).toBe(true);
    expect(isValidPlayerInput(input, 5)).toBe(false);
    expect(isValidPlayerInput(input, 6)).toBe(false);
    expect(isValidPlayerInput({ ...input, moveX: 0, moveZ: 0, buttons: 255 }, 4)).toBe(true);
  });
  it('la predicción rechaza datos inválidos y duplicados sin contaminar el historial', () => {
    let steps = 0;
    const sim = { snapshot: () => 0, restore: () => undefined, step: () => { steps++; } };
    const prediction = new PredictionController(sim, 1 / 30);
    const input = emptyInput(1);
    prediction.predict({ ...input, moveX: Infinity });
    prediction.predict(input);
    input.moveX = NaN;
    prediction.predict(emptyInput(1));
    expect(steps).toBe(1);
    expect([...prediction.history.pending()]).toEqual([emptyInput(1)]);
    expect(prediction.history).toBeInstanceOf(InputHistory);
  });
});
