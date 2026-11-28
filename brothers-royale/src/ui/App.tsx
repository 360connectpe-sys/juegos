import { Frontend, Results } from './components/Frontend';
import { loadProfile, saveProfile } from '@/game/profile';
import type { Profile } from '@shared/lobby/profile';
import type { RoundResult } from '@shared/battle/BattleRound';
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
import { INFO_WIDGETS, renderInfoWidget } from './hud/widgets';
import { DeathScreen } from './components/DeathScreen';
import { loadSettings, loadVolume, resetSettings, saveSettings, saveVolume, type GameSettings } from '@/game/settings';
import { QualityToggle } from './components/QualityToggle';
import { Hud } from './components/Hud';
import { OnlinePanel } from './components/OnlinePanel';
import { loadSavedName, readOnlineParams } from '@/net/config';
import { LoadingScreen } from './components/LoadingScreen';
import { TouchControls } from './components/TouchControls';
import { PwaUpdate } from './components/PwaUpdate';

declare global {
  interface Window {
    __BR_GAME__?: Game;
  }
}

const HINT_MS = 10000;

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
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
  const [volume, setVolume] = useState(() => loadVolume());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingHud, setEditingHud] = useState(false);
  const [profile,setProfile]=useState(loadProfile);
  const [practice,setPractice]=useState(false);
  const [frontState,setFrontState]=useState<ReturnType<Game['getFrontendState']>|null>(null);
  const [result,setResult]=useState<RoundResult|null>(null);
  const dismissedResult=useRef('');
  const [netError,setNetError]=useState('');
  const phase=frontState?.battle?.phase;
  const online=frontState?.net==='connected'||frontState?.net==='reconnecting';
  const front=ready&&game&&(online?phase!=='running':!practice);
  useEffect(()=>{
    if(!game||!ready)return;
    const update=()=>{const state=game.getFrontendState();setFrontState(state);if(state.battle?.result&&(state.sessionKey+':'+state.battle.result.round)!==dismissedResult.current)setResult(state.battle.result);else if(state.battle?.phase==='running')setResult(null);};
    update();const timer=window.setInterval(update,200);
    const off=game.events.on('net',e=>setNetError(e.reason??''));
    return()=>{window.clearInterval(timer);off();};
  },[game,ready]);
  useEffect(()=>{game?.setPresentation(!!front||!!result);},[game,front,result]);
  const changeProfile=(p:Profile)=>{setProfile(p);saveProfile(p);if(p.name.trim())game?.updateProfile(p);};

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
    if (overlayRef.current) g.attachOverlay(overlayRef.current);
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
        if (onlineParams.auto) void g.goOnline({ url: onlineParams.server, name: onlineParams.name || 'Jugador', skin:loadProfile().skin, code: onlineParams.code });
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

  useEffect(() => {
    game?.setVolume(volume);
  }, [game, volume]);

  // Con Ajustes o el editor abiertos, el personaje no se mueve y el ratón se suelta.
  useEffect(() => {
    const paused = settingsOpen || editingHud || !!front || !!result;
    game?.setInputSuspended(paused);
    if (paused && document.pointerLockElement) document.exitPointerLock?.();
  }, [game, settingsOpen, editingHud, front, result]);

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

  const playing=!front&&!result;
  const showTouch = playing && ready && game && (isTouch || device === 'touch') && device !== 'gamepad';

  return (
    <main className="app">
      <PwaUpdate server={onlineParams.server} isBusy={() => {
        const live = game?.getFrontendState();
        return !ready || editingHud || settingsOpen || live?.net === 'connecting' || live?.net === 'reconnecting'
          || live?.battle?.phase === 'countdown' || live?.battle?.phase === 'running' || (playing && !result);
      }} />
      <canvas ref={canvasRef} className="app__canvas" aria-label="Escena del juego" onClick={onCanvasClick} onContextMenu={(e) => e.preventDefault()} />
      <div ref={overlayRef} className="app__combat" />
      {ready && game && !editingHud && playing && (
        <div className="hud-safe hud-safe--info" aria-label="Estado del jugador">
          {INFO_WIDGETS.map((id) => (
            <HudSlot key={id} id={id} layout={hudLayout[id]} interactive={id === 'menu' || id === 'construction' || id === 'inventory'}>
              {renderInfoWidget(id, game, false, ()=>{game.returnToMenu();setPractice(false);})}
            </HudSlot>
          ))}
        </div>
      )}
      {ready && game && playing && (
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
          // En partida no se muestra «Jugar en línea» (para salir está «Menú principal»).
          online={playing ? undefined :
            <OnlinePanel
              events={game.events}
              initial={onlineParams}
              onConnect={(req) => void game.goOnline(req)}
              onDisconnect={() => game.goOffline()}
            />
          }
        />
      )}
      {showTouch && !editingHud && !settingsOpen && <TouchControls touch={game.input.touch} layout={hudLayout} mode={settings.perspective} game={game} />}
      {ready && game && !editingHud && playing && <DeathScreen game={game} />}
      {front&&game&&!result&&!editingHud&&<Frontend game={game} profile={profile} lobby={frontState?.lobby} localId={frontState?.localId??''} countdown={frontState?.battle?.countdown} server={onlineParams.server} error={frontState?.error||netError} busy={frontState?.net==='connecting'||frontState?.net==='reconnecting'} onProfile={changeProfile} onSettings={()=>setSettingsOpen(true)} onConnect={req=>{setNetError('');void game.goOnline(req);}} onPractice={()=>{setPractice(true);game.updateProfile(profile);}} onLeave={()=>{game.goOffline();setPractice(false);}}/>}
      {ready&&game&&result&&<Results result={result} localId={frontState?.localId??''} busy={frontState?.net==='reconnecting'} onLobby={()=>{if(!game.returnToLobby())return;dismissedResult.current=(frontState?.sessionKey??'')+':'+result.round;setResult(null);setPractice(false);}} onRematch={()=>{if(!game.rematch())return;dismissedResult.current=(frontState?.sessionKey??'')+':'+result.round;setResult(null);if(!online)setPractice(true);}}/>}
      {ready && game && settingsOpen && !editingHud && (
        <SettingsPanel
          settings={settings}
          quality={<QualityToggle events={game.events} initial={game.qualityTier} onChange={(t) => game.setQuality(t)} />}
          canFullscreen={isTouch && canFullscreen()}
          onChange={updateSettings}
          volume={volume}
          onVolume={(v) => {
            setVolume(v);
            saveVolume(v);
          }}
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
      {ready && game && playing && !settingsOpen && !editingHud && <InteractPrompt game={game} device={device} />}
      {ready && game && <GraphicsNotice events={game.events} />}
      {ready && isTouch && <OrientationHint />}
      <LoadingScreen progress={progress.value} label={progress.label} error={error} hidden={ready} />
    </main>
  );
}
