import { useEffect, useState } from 'react';
import type { EventBus } from '@/core/EventBus';
import type { GameEvents, NetEvent } from '@/game/Game';

/** Calidad de la conexión según el ping (ida y vuelta). */
export function pingLevel(rtt: number | undefined): 'good' | 'ok' | 'bad' | 'unknown' {
  if (!rtt || rtt <= 0) return 'unknown';
  return rtt < 80 ? 'good' : rtt < 160 ? 'ok' : 'bad';
}

/**
 * Indicador compacto de red en partida (fase 10): conexión, ping y reconexión.
 * Solo en línea; sin conexión no ocupa espacio. Se actualiza con los eventos
 * `net` (no por frame).
 */
export function NetBadge({ events }: { events: EventBus<GameEvents> }) {
  const [net, setNet] = useState<NetEvent>({ status: 'offline' });
  useEffect(() => events.on('net', (e) => setNet((prev) => ({ ...prev, ...e }))), [events]);
  if (net.status === 'offline') return null;
  const level = net.status === 'connected' ? pingLevel(net.rtt) : 'bad';
  const text =
    net.status === 'reconnecting' ? 'Reconectando…' : net.status === 'connecting' ? 'Conectando…' : net.status === 'disconnected' ? 'Sin conexión' : net.rtt ? `${net.rtt} ms` : 'En línea';
  return (
    <p className={`netbadge netbadge--${level}${net.status !== 'connected' ? ' is-warn' : ''}`} role="status" aria-live="polite" aria-label={`Conexión: ${text}`}>
      <i aria-hidden="true" />
      {text}
    </p>
  );
}
