import { useState } from 'react';
import type { GameStats } from '@/game/Game';
import { Logo } from './Logo';

const TIER_LABEL = { low: 'calidad baja', medium: 'calidad media', high: 'calidad alta' } as const;

interface Props {
  stats: GameStats | null;
  showKeyboardHint: boolean;
}

export function Hud({ stats, showKeyboardHint }: Props) {
  const [detailed, setDetailed] = useState(false);
  return (
    <div className="hud">
      <div className="hud__corner">
        <Logo size="small" />
      </div>
      {stats && (
        <button type="button" className="hud__stats" onClick={() => setDetailed((d) => !d)} aria-label="Rendimiento">
          <span>
            <strong>{stats.fps}</strong> fps, {TIER_LABEL[stats.tier]}
          </span>
          {detailed && (
            <span className="hud__stats-detail">
              {stats.drawCalls} draw calls, {(stats.triangles / 1000).toFixed(1)}k triángulos, resolución ×{stats.pixelRatio.toFixed(2)}
            </span>
          )}
        </button>
      )}
      {showKeyboardHint && (
        <p className="hud__hint">
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> para moverte, <kbd>Shift</kbd> para correr, <kbd>Espacio</kbd> para saltar
        </p>
      )}
    </div>
  );
}
