import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/game/Game';
import type { InputDevice } from '@/game/input/sources';
import { FpsCounter } from './FpsCounter';
import type { ReactNode } from 'react';
import { Logo } from './Logo';

interface Props {
  events: EventBus<GameEvents>;
  device: InputDevice;
  showHint: boolean;
  /** Panel de juego en línea (debajo del logo). */
  online?: ReactNode;
  /** Selector de calidad (debajo del contador de FPS). */
  quality?: ReactNode;
}

function Hint({ device }: { device: InputDevice }) {
  if (device === 'gamepad')
    return (
      <p className="hud__hint">
        <kbd>Stick</kbd> para moverte, <kbd>A</kbd> para saltar, <kbd>L3</kbd> o <kbd>LB</kbd> para correr
      </p>
    );
  if (device === 'keyboard')
    return (
      <p className="hud__hint">
        <kbd>W</kbd>
        <kbd>A</kbd>
        <kbd>S</kbd>
        <kbd>D</kbd> para moverte, <kbd>Shift</kbd> para correr, <kbd>Espacio</kbd> para saltar, rueda para acercar
      </p>
    );
  return null;
}

export function Hud({ events, device, showHint, online, quality }: Props) {
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
      {showHint && <Hint device={device} />}
    </div>
  );
}
