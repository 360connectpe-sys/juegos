import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Game } from '@/game/Game';
import { HudSlot } from './HudSlot';
import { defaultHudLayout, HUD_ELEMENTS, HUD_LIMITS, moveElement, resetElement, updateElement, type HudElementId, type HudLayout } from './layout';
import { renderInfoWidget, type InfoWidgetId } from './widgets';

interface Props {
  initial: HudLayout;
  game: Game | null;
  isTouch: boolean;
  onSave(layout: HudLayout): void;
  onCancel(): void;
}

const LABEL = Object.fromEntries(HUD_ELEMENTS.map((e) => [e.id, e.label])) as Record<HudElementId, string>;

/** Vista previa de un control táctil (no envía nada mientras se edita). */
function ControlPreview({ id }: { id: HudElementId }) {
  if (id === 'joystick')
    return (
      <div className="stick stick--preview" aria-hidden="true">
        <div className="stick__knob" />
      </div>
    );
  return <span className={`touch__btn touch__${id === 'jump' || id === 'sprint' ? id : `action touch__action--${id}`}`}>{LABEL[id]}</span>;
}

/**
 * Editor visual del HUD: se arrastra cada elemento directamente; al tocarlo
 * se selecciona y la barra superior ajusta tamaño, transparencia y
 * visibilidad. Las flechas del teclado mueven el elemento seleccionado.
 * Los elementos ocultos se pueden volver a mostrar desde la lista.
 */
export function HudEditor({ initial, game, isTouch, onSave, onCancel }: Props) {
  const [layout, setLayout] = useState<HudLayout>(initial);
  const [selected, setSelected] = useState<HudElementId>('jump');
  const safeRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: HudElementId; pointer: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const sel = layout[selected];
  // La barra se coloca en el lado opuesto al elemento elegido para no taparlo nunca.
  const barAtBottom = sel.y < 0.4;

  const onDown = (id: HudElementId) => (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { id, pointer: e.pointerId, x: e.clientX, y: e.clientY };
    setSelected(id);
    setDragging(true);
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    const r = safeRef.current?.getBoundingClientRect();
    if (!d || e.pointerId !== d.pointer || !r || r.width === 0 || r.height === 0) return;
    const dx = (e.clientX - d.x) / r.width;
    const dy = (e.clientY - d.y) / r.height;
    d.x = e.clientX;
    d.y = e.clientY;
    setLayout((l) => moveElement(l, d.id, dx, dy));
  };
  const onUp = (e: PointerEvent) => {
    if (drag.current?.pointer !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const step = e.shiftKey ? 0.05 : 0.01;
    const m: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = m[e.key];
    if (!d) return;
    e.preventDefault();
    setLayout((l) => moveElement(l, selected, d[0], d[1]));
  };

  return (
    <div className="hud-editor" role="dialog" aria-modal="true" aria-label="Editar HUD" onKeyDown={onKey}>
      <div className={`hud-editor__bar${barAtBottom ? ' hud-editor__bar--bottom' : ''}${dragging ? ' is-dragging' : ''}`}>
        <label className="hud-editor__field">
          <span>Elemento</span>
          <select value={selected} onChange={(e) => setSelected(e.target.value as HudElementId)}>
            {HUD_ELEMENTS.map((el) => (
              <option key={el.id} value={el.id}>
                {el.label}
                {el.kind === 'control' && !isTouch ? ' (táctil)' : ''}
                {layout[el.id].visible ? '' : ' — oculto'}
              </option>
            ))}
          </select>
        </label>
        <label className="hud-editor__field">
          <span>Tamaño {Math.round(sel.scale * 100)} %</span>
          <input
            type="range"
            min={HUD_LIMITS.scale.min}
            max={HUD_LIMITS.scale.max}
            step={0.05}
            value={sel.scale}
            onChange={(e) => setLayout((l) => updateElement(l, selected, { scale: Number(e.target.value) }))}
          />
        </label>
        <label className="hud-editor__field">
          <span>Opacidad {Math.round(sel.opacity * 100)} %</span>
          <input
            type="range"
            min={HUD_LIMITS.opacity.min}
            max={HUD_LIMITS.opacity.max}
            step={0.05}
            value={sel.opacity}
            onChange={(e) => setLayout((l) => updateElement(l, selected, { opacity: Number(e.target.value) }))}
          />
        </label>
        <label className="hud-editor__check">
          <input type="checkbox" checked={sel.visible} onChange={(e) => setLayout((l) => updateElement(l, selected, { visible: e.target.checked }))} />
          <span>Mostrar</span>
        </label>
        <div className="hud-editor__actions">
          <button type="button" className="net__btn" onClick={() => setLayout((l) => resetElement(l, selected))}>
            Restablecer elemento
          </button>
          <button type="button" className="net__btn" onClick={() => setLayout(defaultHudLayout())}>
            Restablecer todo
          </button>
          <button type="button" className="net__btn" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="net__btn net__btn--primary" onClick={() => onSave(layout)}>
            Guardar
          </button>
        </div>
      </div>
      <p className={`hud-editor__help${barAtBottom ? ' hud-editor__help--top' : ''}`}>Arrastra cada elemento a donde te quede cómodo. Las flechas del teclado lo mueven con precisión.</p>
      <div ref={safeRef} className="hud-safe hud-safe--editor" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {HUD_ELEMENTS.map((el) => {
          const l = layout[el.id];
          // En el editor también se ven (atenuados) los ocultos, para poder recuperarlos.
          const shown = { ...l, visible: true, opacity: l.visible ? l.opacity : 0.25 };
          return (
            <HudSlot key={el.id} id={el.id} layout={shown} interactive className={`hud-edit-item${el.id === selected ? ' is-selected' : ''}`}>
              <div
                className="hud-edit-item__grab"
                role="button"
                tabIndex={0}
                aria-label={`Mover ${el.label}`}
                aria-pressed={el.id === selected}
                onPointerDown={onDown(el.id)}
                onFocus={() => setSelected(el.id)}
              >
                {el.kind === 'control' ? <ControlPreview id={el.id} /> : renderInfoWidget(el.id as InfoWidgetId, game, true)}
                <span className="hud-edit-item__label">{el.label}</span>
              </div>
            </HudSlot>
          );
        })}
      </div>
    </div>
  );
}
