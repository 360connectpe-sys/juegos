import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/game/Game';
import type { InputDevice } from '@/game/input/sources';
import type { CameraMode } from '@/engine/camera/cameraMath';
import { FpsCounter } from './FpsCounter';
import type { ReactNode } from 'react';
import { Logo } from './Logo';

interface Props {
  events: EventBus<GameEvents>;
  device: InputDevice;
  showHint: boolean;
  /** Panel de juego en línea (debajo del logo). */
  online?: ReactNode;
  /** Botón de Ajustes (junto al contador de FPS). */
  quality?: ReactNode;
  /** Perspectiva actual (cambia la ayuda de controles). */
  mode?: CameraMode;
}

function Hint({ device, mode }: { device: InputDevice; mode: CameraMode }) {
  const perspective = mode !== 'isometric';
  if (device === 'gamepad')
    return (
      <p className="hud__hint">
        <kbd>Stick</kbd> para moverte, {perspective ? <><kbd>Stick derecho</kbd> para mirar, </> : <><kbd>Stick derecho</kbd> para apuntar, </>}
        <kbd>A</kbd> saltar, <kbd>LB</kbd> correr
      </p>
    );
  if (device === 'keyboard')
    return (
      <p className="hud__hint">
        <kbd>W</kbd>
        <kbd>A</kbd>
        <kbd>S</kbd>
        <kbd>D</kbd> moverte, <kbd>Shift</kbd> correr, <kbd>Espacio</kbd> saltar,{' '}
        {perspective ? (
          <>
            haz clic en el juego para mirar con el ratón (<kbd>Esc</kbd> lo suelta), <kbd>Q</kbd>
            <kbd>E</kbd> girar
          </>
        ) : (
          <>botón derecho para apuntar, rueda para acercar</>
        )}
      </p>
    );
  return null;
}

export function Hud({ events, device, showHint, online, quality, mode = 'isometric' }: Props) {
  return (
    <div className="hud">
      <div className="hud__corner">
        <Logo size="small" />
        {online}
      </div>
      <div className="hud__right">
        <FpsCounter events={events} />
        {quality}
      </div>
      {showHint && <Hint device={device} mode={mode} />}
    </div>
  );
}
