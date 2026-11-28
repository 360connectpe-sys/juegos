import { useEffect, useState } from 'react';
import type { Game } from '@/game/Game';
import { ROUND_SECONDS, ZONE_PHASES } from '@shared/battle/zone';

/** m:ss */
const clock = (seconds: number): string => { const s = Math.max(0, Math.ceil(seconds)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

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
        <div className="battle-meters">
          <span aria-label={`Tiempo restante ${clock(ROUND_SECONDS-round.elapsed)}`}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></svg>{clock(ROUND_SECONDS-round.elapsed)}</span>
          <span aria-label="Supervivientes"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="3"/><path d="M6 21v-4a6 6 0 0 1 12 0v4"/></svg>{round.players.filter(p=>p.lives>0).length}</span>
          <span className={`phase-meter${round.zone.warning?' is-warning':''}`} aria-label={`Fase ${round.zone.phase+1} de ${ZONE_PHASES.length}. ${round.zone.closing?'Cerrando':'Próximo cierre'} en ${clock(round.zone.changesIn)}`}>
            <svg viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="11"/><circle className="phase-meter__progress" cx="14" cy="14" r="11" pathLength="100" strokeDasharray={`${100*(round.zone.phase+1)/ZONE_PHASES.length} 100`}/><text x="14" y="18">{round.zone.phase+1}</text></svg>
            {round.zone.closing?'↘ ':''}{clock(round.zone.changesIn)}
          </span>
        </div>
        {ui?.outside && <strong>Fuera de la zona · {round.zone.damage} HP/s</strong>}
      </>}
      {ui?.air === 1 && <>
        <strong className="air-status">Elige destino en el mapa</strong>
        <button type="button" className="air-jump" onClick={() => game.jumpFromPlane()}>Saltar</button>
      </>}
      {ui?.air === 2 && <span className="air-status">Caída · ↕ dirigir · correr: picado · saltar: paracaídas</span>}
      {ui?.air === 3 && <span className="air-status">Paracaídas · ↕ dirigir · correr: bajar</span>}
      {ui?.descending && !ui.air && <span>Descendiendo · dirige el aterrizaje con el movimiento</span>}
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
