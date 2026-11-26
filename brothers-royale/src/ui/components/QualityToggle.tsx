import { useEffect, useState } from 'react';
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/game/Game';
import { QUALITY_LABEL, type QualityTier } from '@/engine/quality';

interface Props {
  events: EventBus<GameEvents>;
  initial: QualityTier;
  onChange(tier: QualityTier): void;
}

const TIERS: QualityTier[] = ['low', 'normal'];

/**
 * Selector de calidad (Baja / Normal). Se aplica al momento, sin recargar, y
 * se recuerda. Solo cambia la nitidez y las sombras: el juego es el mismo.
 */
export function QualityToggle({ events, initial, onChange }: Props) {
  const [tier, setTier] = useState(initial);
  useEffect(() => events.on('quality', setTier), [events]);
  return (
    <div className="quality" role="radiogroup" aria-label="Calidad gráfica">
      {TIERS.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={tier === t}
          className={`quality__opt${tier === t ? ' is-on' : ''}`}
          onClick={() => onChange(t)}
        >
          {QUALITY_LABEL[t]}
        </button>
      ))}
    </div>
  );
}
