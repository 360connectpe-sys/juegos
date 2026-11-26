import { useId, useState, type ReactNode } from 'react';
import { CAMERA_MODE_LABEL, CAMERA_MODES, type CameraMode } from '@/engine/camera/cameraMath';
import { SETTINGS_LIMITS, type GameSettings } from '@/game/settings';

interface Props {
  settings: GameSettings;
  quality: ReactNode;
  canFullscreen: boolean;
  onChange(s: GameSettings): void;
  onEditHud(): void;
  onResetAll(): void;
  onFullscreen(): void;
  onClose(): void;
}

const MODE_HELP: Record<CameraMode, string> = {
  isometric: 'Vista desde arriba en diagonal. La de siempre.',
  third: 'Detrás del personaje, sobre el hombro. Arrastra a la derecha (o usa el ratón) para mirar.',
  first: 'Desde los ojos del personaje. Tu personaje no se ve.',
};

/**
 * Ajustes del jugador. La perspectiva SOLO se elige aquí. Todo se guarda en
 * este dispositivo y se puede restablecer.
 */
export function SettingsPanel({ settings, quality, canFullscreen, onChange, onEditHud, onResetAll, onFullscreen, onClose }: Props) {
  const ids = { look: useId(), aim: useId(), invert: useId() };
  const [confirmReset, setConfirmReset] = useState(false);
  const set = (patch: Partial<GameSettings>) => onChange({ ...settings, ...patch });

  return (
    <div className="settings" role="dialog" aria-modal="true" aria-label="Ajustes">
      <div className="settings__card">
        <header className="settings__head">
          <h2>Ajustes</h2>
          <button type="button" className="net__btn" onClick={onClose}>
            Volver al juego
          </button>
        </header>

        <section className="settings__sec" aria-label="Perspectiva">
          <h3>Perspectiva</h3>
          <div className="seg" role="radiogroup" aria-label="Perspectiva">
            {CAMERA_MODES.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={settings.perspective === m} className={`seg__opt${settings.perspective === m ? ' is-on' : ''}`} onClick={() => set({ perspective: m })}>
                {CAMERA_MODE_LABEL[m]}
              </button>
            ))}
          </div>
          <p className="settings__help">{MODE_HELP[settings.perspective]}</p>
        </section>

        <section className="settings__sec" aria-label="Controles">
          <h3>Controles</h3>
          <div className="settings__row">
            <label htmlFor={ids.look}>Sensibilidad de cámara</label>
            <output htmlFor={ids.look}>×{settings.lookSensitivity.toFixed(2)}</output>
          </div>
          <input
            id={ids.look}
            type="range"
            min={SETTINGS_LIMITS.lookSensitivity.min}
            max={SETTINGS_LIMITS.lookSensitivity.max}
            step={SETTINGS_LIMITS.lookSensitivity.step}
            value={settings.lookSensitivity}
            onChange={(e) => set({ lookSensitivity: Number(e.target.value) })}
          />
          <div className="settings__row">
            <label htmlFor={ids.aim}>Sensibilidad al apuntar</label>
            <output htmlFor={ids.aim}>×{settings.aimSensitivity.toFixed(2)}</output>
          </div>
          <input
            id={ids.aim}
            type="range"
            min={SETTINGS_LIMITS.aimSensitivity.min}
            max={SETTINGS_LIMITS.aimSensitivity.max}
            step={SETTINGS_LIMITS.aimSensitivity.step}
            value={settings.aimSensitivity}
            onChange={(e) => set({ aimSensitivity: Number(e.target.value) })}
          />
          <label className="settings__check" htmlFor={ids.invert}>
            <input id={ids.invert} type="checkbox" checked={settings.invertY} onChange={(e) => set({ invertY: e.target.checked })} />
            <span>Invertir el eje vertical</span>
          </label>
        </section>

        <section className="settings__sec" aria-label="Pantalla">
          <h3>Pantalla</h3>
          <div className="settings__row">
            <span>Calidad gráfica</span>
            {quality}
          </div>
          <div className="settings__buttons">
            <button type="button" className="net__btn net__btn--primary" onClick={onEditHud}>
              Editar HUD
            </button>
            {canFullscreen && (
              <button type="button" className="net__btn" onClick={onFullscreen}>
                Pantalla completa
              </button>
            )}
          </div>
        </section>

        <section className="settings__sec" aria-label="Restablecer">
          {!confirmReset ? (
            <button type="button" className="net__btn" onClick={() => setConfirmReset(true)}>
              Restablecer ajustes y HUD
            </button>
          ) : (
            <div className="settings__confirm" role="alert">
              <span>Se volverá a la perspectiva, sensibilidad y HUD de fábrica.</span>
              <button
                type="button"
                className="net__btn net__btn--danger"
                onClick={() => {
                  onResetAll();
                  setConfirmReset(false);
                }}
              >
                Restablecer
              </button>
              <button type="button" className="net__btn" onClick={() => setConfirmReset(false)}>
                Cancelar
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
