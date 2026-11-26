import { useEffect, useRef, useState } from 'react';
import { Game, type GameStats } from '@/game/Game';
import { detectQuality, readDeviceInfo, readQualityOverride } from '@/engine/quality';
import { Hud } from './components/Hud';
import { LoadingScreen } from './components/LoadingScreen';
import { TouchControls } from './components/TouchControls';

declare global {
  interface Window {
    __BR_GAME__?: Game;
  }
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [progress, setProgress] = useState({ value: 0, label: 'Preparando la isla' });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<GameStats | null>(null);
  const [isTouch] = useState(() => readDeviceInfo().isTouch);
  const [hint, setHint] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const quality = detectQuality(readDeviceInfo(), readQualityOverride(window.location.search));
    const game = new Game(canvas, quality);
    gameRef.current = game;
    if (import.meta.env.DEV || new URLSearchParams(window.location.search).has('debug')) window.__BR_GAME__ = game;
    game.events.on('progress', (p) => setProgress(p));
    game.events.on('ready', () => setReady(true));
    game.events.on('stats', setStats);
    game.events.on('error', (e) => setError(e.message));
    game.init().catch(() => undefined);
    return () => {
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  // Oculta la ayuda de teclado tras el primer movimiento.
  useEffect(() => {
    if (!ready || !hint) return;
    const off = () => setHint(false);
    const t = window.setTimeout(off, 12000);
    window.addEventListener('keydown', off, { once: true });
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', off);
    };
  }, [ready, hint]);

  return (
    <main className="app">
      <canvas ref={canvasRef} className="app__canvas" aria-label="Escena del juego" />
      {ready && <Hud stats={stats} showKeyboardHint={!isTouch && hint} />}
      {ready && isTouch && (
        <TouchControls
          onMove={(x, y) => gameRef.current?.input.setTouchMove(x, y)}
          onJump={() => gameRef.current?.input.pressJump()}
        />
      )}
      <LoadingScreen progress={progress.value} label={progress.label} error={error} hidden={ready} />
    </main>
  );
}
