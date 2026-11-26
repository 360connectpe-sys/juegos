import { useEffect, useState } from 'react';
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/game/Game';
import type { ContextStatus } from '@/engine/ContextLossMonitor';

/**
 * Aviso de pérdida del contexto WebGL. Mientras se recupera, el personaje se
 * queda quieto (no se juega a ciegas) y la conexión en línea sigue viva. Si no
 * vuelve, se ofrece recargar.
 */
export function GraphicsNotice({ events }: { events: EventBus<GameEvents> }) {
  const [status, setStatus] = useState<ContextStatus>('ok');
  useEffect(
    () =>
      events.on('graphics', (s) => {
        setStatus(s);
        if (s === 'restored') window.setTimeout(() => setStatus((c) => (c === 'restored' ? 'ok' : c)), 1500);
      }),
    [events],
  );
  if (status === 'ok') return null;
  return (
    <div className={`gfx gfx--${status}`} role={status === 'failed' ? 'alert' : 'status'}>
      {status === 'lost' && <p>Recuperando los gráficos… Tu personaje espera quieto.</p>}
      {status === 'restored' && <p>Gráficos recuperados.</p>}
      {status === 'failed' && (
        <>
          <p>No se pudieron recuperar los gráficos. Recarga la página para seguir jugando.</p>
          <button type="button" className="net__btn net__btn--primary" onClick={() => window.location.reload()}>
            Recargar
          </button>
        </>
      )}
    </div>
  );
}
