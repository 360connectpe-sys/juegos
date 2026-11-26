import { useEffect, useRef, useState } from 'react';
import { Game } from '@/game/Game';
import type { InputDevice } from '@/game/input/sources';
import { detectQuality, loadSavedQuality, readDeviceInfo, readQualityOverride } from '@/engine/quality';
import { GraphicsNotice } from './components/GraphicsNotice';
import { canFullscreen, enterFullscreenLandscape, OrientationHint } from './components/OrientationHint';
import { SettingsPanel } from './components/SettingsPanel';
import { InteractPrompt } from './components/InteractPrompt';
import { HudEditor } from './hud/HudEditor';
import { HudSlot } from './hud/HudSlot';
import { loadHudLayout, resetHudLayout, saveHudLayout, type HudLayout } from './hud/layout';
import { renderInfoWidget } from './hud/widgets';
import { loadSettings, resetSettings, saveSettings, type GameSettings } from '@/game/settings';
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
  const [settings, setSettings] = useState<GameSettings>(() => loadSettings());
  const [hudLayout, setHudLayout] = useState<HudLayout>(() => loadHudLayout());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingHud, setEditingHud] = useState(false);

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

  // Ajustes → juego (perspectiva y sensibilidades). Solo cambian la vista y la entrada.
  useEffect(() => {
    if (!game || !ready) return;
    game.setCameraMode(settings.perspective);
    game.setLookSettings({ camera: settings.lookSensitivity, aim: settings.aimSensitivity, invertY: settings.invertY });
  }, [game, ready, settings]);

  // Con Ajustes o el editor abiertos, el personaje no se mueve y el ratón se suelta.
  useEffect(() => {
    const paused = settingsOpen || editingHud;
    game?.setInputSuspended(paused);
    if (paused && document.pointerLockElement) document.exitPointerLock?.();
  }, [game, settingsOpen, editingHud]);

  const updateSettings = (s: GameSettings) => {
    setSettings(s);
    saveSettings(s);
  };

  // Clic en el juego (3ª/1ª persona, con ratón): bloquear el puntero para mirar.
  const onCanvasClick = () => {
    if (isTouch || settings.perspective === 'isometric' || document.pointerLockElement) return;
    const c = canvasRef.current as (HTMLCanvasElement & { requestPointerLock?: () => Promise<void> | void }) | null;
    void Promise.resolve(c?.requestPointerLock?.()).catch(() => undefined);
  };

  // La ayuda se oculta sola al rato.
  useEffect(() => {
    if (!ready || !hint) return;
    const t = window.setTimeout(() => setHint(false), HINT_MS);
    return () => window.clearTimeout(t);
  }, [ready, hint, device]);

  const showTouch = ready && game && (isTouch || device === 'touch') && device !== 'gamepad';

  return (
    <main className="app">
      <canvas ref={canvasRef} className="app__canvas" aria-label="Escena del juego" onClick={onCanvasClick} onContextMenu={(e) => e.preventDefault()} />
      {ready && game && !editingHud && (
        <div className="hud-safe hud-safe--info" aria-label="Estado del jugador">
          {(['health', 'lives', 'inventory', 'minimap'] as const).map((id) => (
            <HudSlot key={id} id={id} layout={hudLayout[id]}>
              {renderInfoWidget(id, game)}
            </HudSlot>
          ))}
        </div>
      )}
      {ready && game && (
        <Hud
          events={game.events}
          device={device}
          showHint={hint && !settingsOpen && !editingHud}
          mode={settings.perspective}
          quality={
            <button type="button" className="gear" aria-label="Ajustes" onClick={() => setSettingsOpen(true)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.2 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5ZM13 15.5A3.5 3.5 0 1 1 13 8.5a3.5 3.5 0 0 1 0 7Z" />
              </svg>
              <span>Ajustes</span>
            </button>
          }
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
      {showTouch && !editingHud && !settingsOpen && <TouchControls touch={game.input.touch} layout={hudLayout} mode={settings.perspective} />}
      {ready && game && settingsOpen && !editingHud && (
        <SettingsPanel
          settings={settings}
          quality={<QualityToggle events={game.events} initial={game.qualityTier} onChange={(t) => game.setQuality(t)} />}
          canFullscreen={isTouch && canFullscreen()}
          onChange={updateSettings}
          onEditHud={() => setEditingHud(true)}
          onFullscreen={() => void enterFullscreenLandscape()}
          onResetAll={() => {
            const s = resetSettings();
            setSettings(s);
            setHudLayout(resetHudLayout());
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {ready && game && editingHud && (
        <HudEditor
          initial={hudLayout}
          game={game}
          isTouch={isTouch}
          onCancel={() => setEditingHud(false)}
          onSave={(l) => {
            setHudLayout(l);
            saveHudLayout(l);
            setEditingHud(false);
          }}
        />
      )}
      {ready && game && !settingsOpen && !editingHud && <InteractPrompt game={game} device={device} />}
      {ready && game && <GraphicsNotice events={game.events} />}
      {ready && isTouch && <OrientationHint />}
      <LoadingScreen progress={progress.value} label={progress.label} error={error} hidden={ready} />
    </main>
  );
}
