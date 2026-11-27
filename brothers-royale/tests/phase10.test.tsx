// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/game/Game';
import { NetBadge, pingLevel } from '@/ui/components/NetBadge';

afterEach(cleanup);

describe('fase 10: indicador de red en partida', () => {
  it('umbrales de ping', () => {
    expect(pingLevel(undefined)).toBe('unknown');
    expect(pingLevel(45)).toBe('good');
    expect(pingLevel(120)).toBe('ok');
    expect(pingLevel(250)).toBe('bad');
  });
  it('muestra ping, reconexión y pérdida; sin conexión no ocupa espacio', () => {
    const bus = new EventBus<GameEvents>();
    const { container } = render(<NetBadge events={bus} />);
    expect(container.firstChild).toBeNull();
    act(() => bus.emit('net', { status: 'connected', rtt: 42 }));
    expect(screen.getByRole('status').textContent).toBe('42 ms');
    expect(screen.getByRole('status').className).toContain('netbadge--good');
    act(() => bus.emit('net', { status: 'reconnecting' }));
    expect(screen.getByRole('status').textContent).toBe('Reconectando…');
    expect(screen.getByRole('status').className).toContain('is-warn');
    act(() => bus.emit('net', { status: 'connected', rtt: 190 }));
    expect(screen.getByRole('status').className).toContain('netbadge--bad');
    act(() => bus.emit('net', { status: 'offline' }));
    expect(container.firstChild).toBeNull();
  });
});
