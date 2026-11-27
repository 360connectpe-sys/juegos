import { useEffect, useState } from 'react';
import type { Game } from '@/game/Game';

/**
 * Aviso de eliminación. Fase 6: la vuelta es PROVISIONAL (a los pocos
 * segundos, con salud completa); la fase 8 traerá las tres vidas.
 */
export function DeathScreen({ game }: { game: Game }) {
  const [dead, setDead] = useState(game.currentVitals.dead);
  const [by, setBy] = useState('');
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const a = game.events.on('vitals', (v) => {
      setDead(v.dead);
      if (v.dead) setLeft(Math.ceil(v.respawnIn));
    });
    const b = game.events.on('eliminated', (e) => setBy(e.by));
    return () => {
      a();
      b();
    };
  }, [game]);
  useEffect(() => {
    if (!dead) return;
    const t = window.setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearInterval(t);
  }, [dead]);
  if (!dead) return null;
  return (
    <div className="death" role="alert">
      <p className="death__title">Eliminado</p>
      {by && <p className="death__by">Te eliminó {by}</p>}
      <p className="death__wait">Vuelves en {left} s</p>
    </div>
  );
}
