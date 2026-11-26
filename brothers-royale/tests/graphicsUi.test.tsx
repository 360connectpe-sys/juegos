// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/game/Game';
import { GraphicsNotice } from '@/ui/components/GraphicsNotice';
import { OrientationHint } from '@/ui/components/OrientationHint';
import { QualityToggle } from '@/ui/components/QualityToggle';
import { loadSavedQuality, saveQuality } from '@/engine/quality';

afterEach(cleanup);

describe('selector de calidad', () => {
  it('muestra solo Baja y Normal, cambia al pulsar y sigue los cambios del juego', () => {
    const events = new EventBus<GameEvents>();
    const onChange = vi.fn();
    render(<QualityToggle events={events} initial="normal" onChange={onChange} />);
    const opts = screen.getAllByRole('radio');
    expect(opts.map((o) => o.textContent)).toEqual(['Baja', 'Normal']);
    expect(screen.getByRole('radio', { name: 'Normal' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Baja' }));
    expect(onChange).toHaveBeenCalledWith('low');
    act(() => events.emit('quality', 'low'));
    expect(screen.getByRole('radio', { name: 'Baja' }).getAttribute('aria-checked')).toBe('true');
  });
  it('recuerda la elección', () => {
    saveQuality('low');
    expect(loadSavedQuality()).toBe('low');
    saveQuality('normal');
    expect(loadSavedQuality()).toBe('normal');
  });
});

describe('aviso de gráficos', () => {
  it('informa la pérdida, la recuperación y ofrece recargar si falla', () => {
    vi.useFakeTimers();
    const events = new EventBus<GameEvents>();
    render(<GraphicsNotice events={events} />);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => events.emit('graphics', 'lost'));
    expect(screen.getByRole('status').textContent).toMatch(/Recuperando/);
    act(() => events.emit('graphics', 'restored'));
    expect(screen.getByRole('status').textContent).toMatch(/recuperados/);
    act(() => vi.advanceTimersByTime(1600));
    expect(screen.queryByRole('status')).toBeNull();
    act(() => events.emit('graphics', 'failed'));
    expect(screen.getByRole('alert').textContent).toMatch(/Recarga/);
    expect(screen.getByRole('button', { name: 'Recargar' })).toBeTruthy();
    vi.useRealTimers();
  });
});

describe('orientación', () => {
  it('en vertical sugiere girar el celular sin bloquear el juego', () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes('portrait'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    render(<OrientationHint />);
    expect(screen.getByRole('status').textContent).toMatch(/horizontal/);
    fireEvent.click(screen.getByRole('button', { name: 'Seguir así' }));
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('en horizontal no muestra aviso', () => {
    window.matchMedia = ((q: string) => ({ matches: !q.includes('portrait'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    render(<OrientationHint />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
