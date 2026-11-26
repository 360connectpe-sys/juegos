import { useEffect, useState } from 'react';
import type { Game, InteractInfo } from '@/game/Game';
import type { InputDevice } from '@/game/input/sources';
import type { NoticeCode } from '@shared/match/MatchState';

const NOTICE: Record<NoticeCode, string> = {
  full: 'Inventario lleno: elige un hueco con un objeto para cambiarlo',
  opened: 'Ese cofre ya está abierto',
  gone: 'Alguien lo recogió antes',
};

/**
 * Botón contextual: al acercarse a un cofre aparece "Abrir"; junto a un
 * objeto, "Recoger". En táctil es un botón grande; con teclado o mando
 * muestra la tecla (F o B). Debajo, los avisos de la autoridad.
 */
export function InteractPrompt({ game, device }: { game: Game; device: InputDevice }) {
  const [target, setTarget] = useState<InteractInfo | null>(null);
  const [notice, setNotice] = useState<NoticeCode | null>(null);

  useEffect(() => {
    const offT = game.events.on('interact', setTarget);
    const offN = game.events.on('notice', setNotice);
    return () => {
      offT();
      offN();
    };
  }, [game]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 2500);
    return () => window.clearTimeout(t);
  }, [notice]);

  const key = device === 'gamepad' ? 'B' : 'F';
  return (
    <div className="interact" aria-live="polite">
      {target && (
        <button
          type="button"
          className={`interact__btn interact__btn--${target.type}`}
          onPointerDown={(e) => {
            e.preventDefault();
            game.pressInteract();
          }}
          onClick={(e) => {
            // Teclado/lector de pantalla (Enter/Espacio): sin pointerdown previo.
            if (e.detail === 0) game.pressInteract();
          }}
        >
          {device !== 'touch' && <kbd>{key}</kbd>}
          <span className="interact__action">{target.action}</span>
          <span className="interact__label">{target.label}</span>
        </button>
      )}
      {notice && (
        <p className="interact__notice" role="status">
          {NOTICE[notice]}
        </p>
      )}
    </div>
  );
}
