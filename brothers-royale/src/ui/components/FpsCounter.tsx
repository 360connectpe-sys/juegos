import { useEffect, useRef, useState } from 'react';
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/game/Game';

const TIER_LABEL = { low: 'calidad baja', medium: 'calidad media', high: 'calidad alta' } as const;

/**
 * Contador de FPS. Escribe directamente en el DOM al recibir estadísticas
 * (2 veces por segundo) para no re-renderizar React. Toca o pulsa F3 para
 * ver el detalle de rendimiento.
 */
export function FpsCounter({ events }: { events: EventBus<GameEvents> }) {
  const fpsRef = useRef<HTMLElement>(null);
  const tierRef = useRef<HTMLSpanElement>(null);
  const detailRef = useRef<HTMLSpanElement>(null);
  const rootRef = useRef<HTMLButtonElement>(null);
  const [detailed, setDetailed] = useState(false);

  useEffect(
    () =>
      events.on('stats', (s) => {
        if (fpsRef.current) fpsRef.current.textContent = String(s.fps);
        if (tierRef.current) tierRef.current.textContent = TIER_LABEL[s.tier];
        if (rootRef.current) rootRef.current.dataset.level = s.fps >= 50 ? 'good' : s.fps >= 30 ? 'ok' : 'bad';
        if (detailRef.current)
          detailRef.current.textContent =
            `${s.frameMs.toFixed(1)} ms por frame (peor ${s.worstMs.toFixed(0)} ms), ` +
            `${s.drawCalls} draw calls, ${(s.triangles / 1000).toFixed(1)}k triángulos, resolución ×${s.pixelRatio.toFixed(2)}`;
      }),
    [events],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'F3') {
        e.preventDefault();
        setDetailed((d) => !d);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <button ref={rootRef} type="button" className="fps" onClick={() => setDetailed((d) => !d)} aria-label="Rendimiento" aria-expanded={detailed}>
      <span className="fps__main">
        <strong ref={fpsRef}>–</strong> FPS, <span ref={tierRef} />
      </span>
      <span ref={detailRef} className="fps__detail" hidden={!detailed} />
    </button>
  );
}
