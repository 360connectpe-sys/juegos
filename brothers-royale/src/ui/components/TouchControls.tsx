import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { CameraMode } from '@/engine/camera/cameraMath';
import type { TouchSource } from '@/game/input/sources';
import { TouchDrag, type DragResult } from '@/game/input/touchDrag';
import { Buttons } from '@shared/types';
import type { Game } from '@/game/Game';
import type { Inventory } from '@shared/inventory';
import { HudSlot } from '../hud/HudSlot';
import { defaultHudLayout, HUD_ELEMENTS, type HudElementId, type HudLayout } from '../hud/layout';

interface Props {
  touch: TouchSource;
  layout?: HudLayout;
  mode?: CameraMode;
  /** Para adaptar el botón de ataque a lo que se lleva en la mano. */
  game?: Game | null;
}

/** Texto del botón de ataque según lo que hay en la mano. */
export function attackLabel(inv: Inventory | null | undefined): string {
  const kind = inv?.slots[inv.selected]?.kind;
  if (kind === 'axe') return 'Golpear';
  if (kind === 'medkit') return 'Curar';
  if (kind === 'pistol' || kind === 'smg' || kind === 'rifle' || kind === 'shotgun') return 'Disparar';
  return 'Atacar';
}

/** Acciones con efecto en la fase 6 (las demás siguen reservadas). */
const ACTIVE_ACTIONS = new Set<HudElementId>(['attack', 'aim', 'reload', 'interact', 'build', 'crouch']);

const RADIUS = 56; // px de recorrido del stick (a escala 1)

/** Botones de acción (envían su bit; construir aún no tiene efecto). */
const ACTION_BUTTONS = HUD_ELEMENTS.filter((e) => e.action !== undefined) as readonly { id: HudElementId; label: string; action: number }[];

/**
 * Controles táctiles multitouch:
 *  - mitad izquierda: joystick flotante (reposa donde indique el HUD);
 *  - mitad derecha: arrastrar para mirar (3ª/1ª persona) o para apuntar
 *    (isométrica), a la vez que el joystick;
 *  - botones: saltar, correr y las acciones reservadas (ataque, apuntar,
 *    recarga, interacción, construcción), cada uno con su propio dedo.
 * El DOM se mueve con refs (sin re-render de React en cada movimiento).
 */
export function TouchControls({ touch, layout = defaultHudLayout(), mode = 'isometric', game = null }: Props) {
  const [attack, setAttack] = useState(() => attackLabel(game?.inventory));
  useEffect(() => {
    if (!game) return;
    setAttack(attackLabel(game.inventory));
    return game.events.on('inventory', (inv) => setAttack(attackLabel(inv)));
  }, [game]);
  const zoneRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const stickPointer = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const lookPointer = useRef<number | null>(null);
  const lookDrag = useRef(new TouchDrag());
  // Disparo: el mismo dedo que mantiene el botón puede deslizarse para mirar/apuntar.
  const firePointer = useRef<number | null>(null);
  const fireDrag = useRef(new TouchDrag());
  const [firing, setFiring] = useState(false);
  const [aimOn, setAimOn] = useState(touch.aiming);
  const [crouchOn, setCrouchOn] = useState(touch.crouching);
  const jumpPointer = useRef<number | null>(null);
  const [sprinting, setSprinting] = useState(touch.sprinting);
  const [jumping, setJumping] = useState(false);
  const [held, setHeld] = useState(0);
  const stick = layout.joystick;
  const radius = RADIUS * stick.scale;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Posición de reposo del joystick (la del HUD), visible para indicar dónde tocar.
  const placeBase = (x: number, y: number, active: boolean) => {
    const base = baseRef.current;
    if (!base) return;
    base.style.transform = `translate(${x - 60}px, ${y - 60}px) scale(${stick.scale})`;
    base.style.opacity = String(active ? 1 : 0.55 * stick.opacity);
    base.classList.toggle('stick--active', active);
  };
  const restBase = () => {
    const safe = zoneRef.current?.parentElement?.querySelector('.hud-safe');
    const r = safe?.getBoundingClientRect();
    if (!r || r.width === 0) {
      const z = zoneRef.current?.getBoundingClientRect();
      if (z) placeBase(z.left + 100, z.bottom - 110, false);
    } else placeBase(r.left + stick.x * r.width, r.top + stick.y * r.height, false);
    if (knobRef.current) knobRef.current.style.transform = 'translate(0px, 0px)';
  };

  useEffect(() => {
    restBase();
    window.addEventListener('resize', restBase);
    return () => window.removeEventListener('resize', restBase);
  }, [stick.x, stick.y, stick.scale, stick.opacity]);

  useEffect(() => () => touch.reset(), [touch]);

  const updateStick = (clientX: number, clientY: number) => {
    let dx = clientX - origin.current.x;
    let dy = clientY - origin.current.y;
    const len = Math.hypot(dx, dy);
    if (len > radius) {
      dx = (dx / len) * radius;
      dy = (dy / len) * radius;
    }
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx / stick.scale}px, ${dy / stick.scale}px)`;
    touch.setMove(dx / radius, -dy / radius);
  };

  const onStickDown = (e: PointerEvent<HTMLDivElement>) => {
    if (stickPointer.current !== null) return;
    stickPointer.current = e.pointerId;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    origin.current = { x: e.clientX, y: e.clientY };
    placeBase(e.clientX, e.clientY, true);
    updateStick(e.clientX, e.clientY);
  };
  const onStickMove = (e: PointerEvent) => {
    if (e.pointerId === stickPointer.current) updateStick(e.clientX, e.clientY);
  };
  const onStickUp = (e: PointerEvent) => {
    if (e.pointerId !== stickPointer.current) return;
    stickPointer.current = null;
    touch.setMove(0, 0);
    restBase();
  };

  /** Aplica un arrastre (zona derecha o botón de disparo) a la cámara o al apuntado. */
  const applyDrag = (r: DragResult) => {
    if (r.kind === 'look') touch.addLook(r.dx, r.dy);
    else if (r.kind === 'aim') touch.setAim(r.x, r.y);
  };

  // Zona de mirada / apuntado (mitad derecha).
  const onLookDown = (e: PointerEvent<HTMLDivElement>) => {
    if (lookPointer.current !== null) return;
    lookPointer.current = e.pointerId;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    lookDrag.current.start(e.clientX, e.clientY);
  };
  const onLookMove = (e: PointerEvent) => {
    if (e.pointerId !== lookPointer.current) return;
    applyDrag(lookDrag.current.move(e.clientX, e.clientY, modeRef.current === 'isometric'));
  };
  const onLookUp = (e: PointerEvent) => {
    if (e.pointerId !== lookPointer.current) return;
    lookPointer.current = null;
    lookDrag.current.end();
    if (firePointer.current === null || !fireDrag.current.moving) touch.setAim(0, 0);
  };

  // Disparo / golpe con hacha: mantener = atacar; deslizar el mismo dedo = mirar/apuntar.
  const onFireDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (firePointer.current !== null) return;
    firePointer.current = e.pointerId;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    fireDrag.current.start(e.clientX, e.clientY);
    touch.setAction(Buttons.FIRE, true);
    setFiring(true);
  };
  const onFireMove = (e: PointerEvent) => {
    if (e.pointerId !== firePointer.current) return;
    applyDrag(fireDrag.current.move(e.clientX, e.clientY, modeRef.current === 'isometric'));
  };
  /** Soltar, cancelar o perder la captura del dedo detiene el disparo SIEMPRE. */
  const onFireEnd = (e: PointerEvent) => {
    if (e.pointerId !== firePointer.current) return;
    firePointer.current = null;
    const aimed = fireDrag.current.moving;
    fireDrag.current.end();
    touch.setAction(Buttons.FIRE, false);
    if (aimed && lookPointer.current === null) touch.setAim(0, 0);
    setFiring(false);
  };

  // Mira conmutable: una pulsación la activa, otra la desactiva.
  const onAimToggle = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setAimOn(touch.toggleAim());
  };

  const onJumpDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (jumpPointer.current !== null) return;
    jumpPointer.current = e.pointerId;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    touch.setJump(true);
    setJumping(true);
  };
  const onJumpUp = (e: PointerEvent) => {
    if (e.pointerId !== jumpPointer.current) return;
    jumpPointer.current = null;
    touch.setJump(false);
    setJumping(false);
  };

  const actionProps = (bit: number) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      touch.setAction(bit, true);
      setHeld((h) => h | bit);
    },
    onPointerUp: () => {
      touch.setAction(bit, false);
      setHeld((h) => h & ~bit);
    },
    onPointerCancel: () => {
      touch.setAction(bit, false);
      setHeld((h) => h & ~bit);
    },
  });

  return (
    <div className="touch">
      <div ref={zoneRef} className="touch__zone" onPointerDown={onStickDown} onPointerMove={onStickMove} onPointerUp={onStickUp} onPointerCancel={onStickUp} />
      <div
        className="touch__look"
        aria-label={mode === 'isometric' ? 'Zona para apuntar' : 'Zona para mirar'}
        onPointerDown={onLookDown}
        onPointerMove={onLookMove}
        onPointerUp={onLookUp}
        onPointerCancel={onLookUp}
      />
      <div className="hud-safe hud-safe--controls">
        {stick.visible && (
          <div ref={baseRef} className="stick" aria-hidden="true">
            <div ref={knobRef} className="stick__knob" />
          </div>
        )}
        <HudSlot id="sprint" layout={layout.sprint} interactive>
          <button
            type="button"
            className={`touch__btn touch__sprint${sprinting ? ' is-on' : ''}`}
            aria-pressed={sprinting}
            onPointerDown={(e) => {
              e.preventDefault();
              setSprinting(touch.toggleSprint());
            }}
          >
            Correr
          </button>
        </HudSlot>
        <HudSlot id="jump" layout={layout.jump} interactive>
          <button type="button" className={`touch__btn touch__jump${jumping ? ' is-on' : ''}`} onPointerDown={onJumpDown} onPointerUp={onJumpUp} onPointerCancel={onJumpUp}>
            Saltar
          </button>
        </HudSlot>
        {ACTION_BUTTONS.map((b) => (
          <HudSlot key={b.id} id={b.id} layout={layout[b.id]} interactive>
            {b.id === 'attack' ? (
              <button
                type="button"
                className={`touch__btn touch__action touch__action--attack${firing ? ' is-on' : ''}`}
                onPointerDown={onFireDown}
                onPointerMove={onFireMove}
                onPointerUp={onFireEnd}
                onPointerCancel={onFireEnd}
                onLostPointerCapture={onFireEnd}
                onContextMenu={(e) => e.preventDefault()}
              >
                {attack}
              </button>
            ) : b.id === 'crouch' ? (
              <button
                type="button"
                className={`touch__btn touch__action touch__action--crouch${crouchOn ? ' is-on is-toggled' : ''}`}
                aria-pressed={crouchOn}
                onPointerDown={(e) => { e.preventDefault(); setCrouchOn(touch.toggleCrouch()); }}
                onContextMenu={(e) => e.preventDefault()}
              >
                {b.label}
              </button>
            ) : b.id === 'aim' ? (
              <button
                type="button"
                className={`touch__btn touch__action touch__action--aim${aimOn ? ' is-on is-toggled' : ''}`}
                aria-pressed={aimOn}
                onPointerDown={onAimToggle}
                onContextMenu={(e) => e.preventDefault()}
              >
                {b.label}
              </button>
            ) : (
              <button
                type="button"
                className={`touch__btn touch__action touch__action--${b.id}${held & b.action ? ' is-on' : ''}`}
                title={ACTIVE_ACTIONS.has(b.id) ? undefined : 'Acción reservada: llega en una próxima fase'}
                {...actionProps(b.action)}
              >
                {b.label}
              </button>
            )}
          </HudSlot>
        ))}
      </div>
    </div>
  );
}
