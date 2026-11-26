import { useEffect, useRef, useState } from 'react';
import { Game } from '@/game/Game';
import type { InputDevice } from '@/game/input/sources';
import { detectQuality, loadSavedQuality, readDeviceInfo, readQualityOverride } from '@/engine/quality';
import { GraphicsNotice } from './components/GraphicsNotice';
import { OrientationHint } from './components/OrientationHint';
import { QualityToggle } from './components/QualityToggle';
import { Hud } from './components/Hud';
import { OnlinePanel } from './components/OnlinePanel';
import { loadSavedName, readOnlineParams } from '@/net/config';
import { LoadingScreen } from './components/LoadingScreen';
import { TouchControls } from './components/TouchControls';

declare global {
  interface Window {
    __BR_GAME__?: Game;
  }
}

const HINT_MS = 10000;

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [progress, setProgress] = useState({ value: 0, label: 'Preparando la isla' });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isTouch] = useState(() => readDeviceInfo().isTouch);
  const [onlineParams] = useState(() => readOnlineParams(window.location.search, window.location, import.meta.env.VITE_SERVER_URL, loadSavedName()));
  const [device, setDevice] = useState<InputDevice>(() => (readDeviceInfo().isTouch ? 'touch' : 'keyboard'));
  const [hint, setHint] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const info = readDeviceInfo();
    // Prioridad: ?q= de la URL > elección guardada del jugador > detección automática.
    const quality = detectQuality(info, readQualityOverride(window.location.search) ?? loadSavedQuality());
    let g: Game;
    try {
      g = new Game(canvas, quality, info.isTouch ? 'touch' : 'keyboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    setGame(g);
    if (import.meta.env.DEV || new URLSearchParams(window.location.search).has('debug')) window.__BR_GAME__ = g;
    g.events.on('progress', (p) => setProgress(p));
    g.events.on('ready', () => setReady(true));
    g.events.on('error', (e) => setError(e.message));
    g.events.on('device', (d) => {
      setDevice(d);
      setHint(true);
    });
    g.init()
      .then(() => {
        // ?online&server=…&name=…&code=… conecta al cargar (útil para pruebas y enlaces de sala).
        if (onlineParams.auto) void g.goOnline({ url: onlineParams.server, name: onlineParams.name || 'Jugador', code: onlineParams.code });
      })
      .catch(() => undefined);
    return () => {
      if (window.__BR_GAME__ === g) delete window.__BR_GAME__;
      g.dispose();
      setGame(null);
    };
  }, []);

  // La ayuda se oculta sola al rato.
  useEffect(() => {
    if (!ready || !hint) return;
    const t = window.setTimeout(() => setHint(false), HINT_MS);
    return () => window.clearTimeout(t);
  }, [ready, hint, device]);

  const showTouch = ready && game && (isTouch || device === 'touch') && device !== 'gamepad';

  return (
    <main className="app">
      <canvas ref={canvasRef} className="app__canvas" aria-label="Escena del juego" />
      {ready && game && (
        <Hud
          events={game.events}
          device={device}
          showHint={hint}
          quality={<QualityToggle events={game.events} initial={game.qualityTier} onChange={(t) => game.setQuality(t)} />}
          online={
            <OnlinePanel
              events={game.events}
              initial={onlineParams}
              onConnect={(req) => void game.goOnline(req)}
              onDisconnect={() => game.goOffline()}
            />
          }
        />
      )}
      {showTouch && <TouchControls touch={game.input.touch} />}
      {ready && game && <GraphicsNotice events={game.events} />}
      {ready && isTouch && <OrientationHint />}
      <LoadingScreen progress={progress.value} label={progress.label} error={error} hidden={ready} />
    </main>
  );
}
