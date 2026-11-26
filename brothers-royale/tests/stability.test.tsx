// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Scene } from 'three';
import { Engine } from '@/engine/Engine';
import { buildQuality } from '@/engine/quality';
import { Game } from '@/game/Game';
import { PhysicsWorld } from '@/physics/PhysicsWorld';
import { App } from '@/ui/App';

vi.mock('@/engine/Engine', () => ({
  Engine: vi.fn(function () {
    return {
      scene: new Scene(),
      iso: { snapTo: vi.fn() },
      start: vi.fn(),
      dispose: vi.fn(),
    };
  }),
}));
vi.mock('@/engine/Lighting', () => ({
  Lighting: vi.fn(function () { return {}; }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('estabilidad del arranque', () => {
  it('muestra el error si WebGL falla durante la construcción del juego', () => {
    vi.mocked(Engine).mockImplementationOnce(() => {
      throw new Error('WebGL no disponible');
    });
    render(<App />);
    expect(screen.getByRole('alert').textContent).toContain('WebGL no disponible');
    expect(screen.getByRole('alert').textContent).toContain('Recarga la página');
    expect(screen.queryByRole('button', { name: 'Saltar' })).toBeNull();
  });

  it('crea los mismos árboles y colisionadores desde Game en cada calidad', async () => {
    const addStatic = vi.spyOn(PhysicsWorld.prototype, 'addStatic');
    const worlds = [];
    for (const tier of ['low', 'medium', 'high'] as const) {
      addStatic.mockClear();
      const game = new Game(document.createElement('canvas'), buildQuality(tier, 1));
      try {
        await game.init();
        worlds.push({
          trees: game.debugState().trees,
          colliders: structuredClone(addStatic.mock.calls),
        });
      } finally {
        game.dispose();
      }
    }
    expect(worlds[0]!.trees).toBe(140);
    expect(worlds[0]!.colliders.length).toBeGreaterThan(140);
    expect(worlds[1]).toEqual(worlds[0]);
    expect(worlds[2]).toEqual(worlds[0]);
  });
});
