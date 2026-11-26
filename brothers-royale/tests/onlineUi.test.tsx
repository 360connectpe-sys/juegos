// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/game/Game';
import { KeyboardSource } from '@/game/input/sources';
import { OnlinePanel } from '@/ui/components/OnlinePanel';

afterEach(cleanup);

const setup = () => {
  const events = new EventBus<GameEvents>();
  const onConnect = vi.fn();
  const onDisconnect = vi.fn();
  render(<OnlinePanel events={events} initial={{ server: 'ws://localhost:2567', name: '', code: '' }} onConnect={onConnect} onDisconnect={onDisconnect} />);
  return { events, onConnect, onDisconnect };
};

describe('OnlinePanel', () => {
  it('abre el formulario y conecta con datos limpios', () => {
    const { onConnect } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Jugar en línea' }));
    fireEvent.change(screen.getByLabelText('Tu nombre'), { target: { value: '  Ana  ' } });
    fireEvent.change(screen.getByLabelText('Código de sala (vacío para la pública)'), { target: { value: 'ab-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Conectar' }));
    expect(onConnect).toHaveBeenCalledWith({ url: 'ws://localhost:2567', name: 'Ana', code: 'AB1' });
  });
  it('explica una dirección de servidor no válida sin intentar conectar', () => {
    const { onConnect } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Jugar en línea' }));
    fireEvent.change(screen.getByLabelText('Dirección'), { target: { value: 'http://x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Conectar' }));
    expect(onConnect).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/ws:\/\//);
  });
  it('muestra el estado en línea, permite salir y avisa al volver a offline', () => {
    const { events, onDisconnect } = setup();
    act(() => events.emit('net', { status: 'connected', code: 'AB1', players: 2, rtt: 40 }));
    expect(screen.getByRole('status').textContent).toBe('En línea, sala AB1, 2/8 jugadores, 40 msSalir');
    fireEvent.click(screen.getByRole('button', { name: 'Salir' }));
    expect(onDisconnect).toHaveBeenCalled();
    act(() => events.emit('net', { status: 'offline', reason: 'El servidor se apagó' }));
    expect(screen.getByRole('alert').textContent).toBe('El servidor se apagó. Sigues jugando sin conexión.');
  });
});

describe('teclado y campos de texto', () => {
  it('escribir en un input no mueve ni hace saltar al personaje', () => {
    const kb = new KeyboardSource(window);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    const f = kb.read();
    expect(f.move).toEqual({ x: 0, y: 0 });
    expect(f.jump).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(kb.read().move.y).toBe(1);
    kb.dispose();
    input.remove();
  });
});
