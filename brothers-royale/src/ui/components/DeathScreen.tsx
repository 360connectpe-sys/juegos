import { useEffect, useState } from 'react';
import type { Game } from '@/game/Game';

/** Vidas, descenso, espectador y resultado dependen exclusivamente de la autoridad. */
export function DeathScreen({ game }: { game: Game }) {
  const [vitals, setVitals] = useState(game.currentVitals);
  const [by, setBy] = useState('');
  const [left, setLeft] = useState(Math.ceil(vitals.respawnIn));
  const [ui, setUi] = useState(game.battleUi);
  useEffect(() => {
    const a = game.events.on('vitals', v => { setVitals(v); setLeft(Math.ceil(v.respawnIn)); });
    const b = game.events.on('eliminated', e => setBy(e.by));
    const timer = window.setInterval(() => setUi(game.battleUi), 200);
    return () => { a(); b(); window.clearInterval(timer); };
  }, [game]);
  useEffect(() => {
    if (!vitals.dead) return;
    const timer = window.setInterval(() => setLeft(n => Math.max(0, n - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [vitals.dead]);
  const round = ui?.round;
  const result = round?.result;
  const winners = result?.winners.map(id => result.scores.find(p => p.id === id)?.name ?? id).join(', ');
  return <>
    {ui?.outside && <div className="storm-tint" aria-hidden="true" />}
    <div className="battle-status" aria-live="polite">
      {round?.phase === 'waiting' && (ui?.offline ? <button onClick={() => game.startRound()}>Iniciar partida offline</button> : <span>Esperando jugadores · mínimo 2</span>)}
      {round?.phase === 'countdown' && <span>Partida en {Math.ceil(round.countdown)} s</span>}
      {round?.phase === 'running' && <>
        <span>{Math.floor(round.elapsed / 60)}:{String(Math.floor(round.elapsed % 60)).padStart(2, '0')} / 30:00 · {round.players.filter(p => p.lives > 0).length} supervivientes</span>
        {round.zone.warning && <strong>La zona se cierra en {Math.ceil(round.zone.changesIn)} s</strong>}
        {ui?.outside && <strong>Fuera de la zona · {round.zone.damage} HP/s</strong>}
      </>}
      {ui?.descending && <span>Descendiendo · dirige el aterrizaje con el movimiento</span>}
      {(ui?.protection ?? 0) > 0 && <span>Protección {Math.ceil(ui!.protection)} s · atacar la cancela</span>}
      {result && <><strong>{result.winners.length === 1 ? `Ganador: ${winners}` : 'Empate'}</strong><span>Nueva partida en {Math.ceil(round!.countdown)} s</span></>}
    </div>
    {vitals.dead && !result && <div className={`death${ui?.spectator ? ' death--spectator' : ''}`} role="alert">
      <p className="death__title">{ui?.spectator ? 'Eliminación definitiva' : 'Vida perdida'}</p>
      {by && <p className="death__by">Te eliminó {by}</p>}
      {ui?.spectator ? <><p>Espectador{ui.target ? ` · ${ui.target}` : ' · esperando la siguiente partida'}</p>
        <div className="battle-actions"><button onClick={() => game.spectateNext(-1)}>Anterior</button><button onClick={() => game.spectateNext()}>Siguiente</button></div></>
        : <p className="death__wait">Vuelves desde el cielo en {left} s · {vitals.lives ?? 0} vidas restantes</p>}
    </div>}
  </>;
}
