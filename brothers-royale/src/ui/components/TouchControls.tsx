import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { TouchSource } from '@/game/input/sources';

interface Props {
  touch: TouchSource;
}

const RADIUS = 56; // px de recorrido del stick

/**
 * Controles táctiles multitouch: joystick flotante en la mitad izquierda y
 * botones a la derecha; cada uno sigue su propio dedo (pointerId), así se
 * puede correr, moverse y saltar a la vez. El joystick mueve el DOM con refs
 * (sin re-render de React en cada movimiento).
 */
export function TouchControls({ touch }: Props) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const stickPointer = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const jumpPointer = useRef<number | null>(null);
  const [sprinting, setSprinting] = useState(touch.sprinting);
  const [jumping, setJumping] = useState(false);

  // Posición de reposo del joystick (visible para indicar dónde tocar).
  const placeBase = (x: number, y: number, active: boolean) => {
    const base = baseRef.current;
    if (!base) return;
    base.style.transform = `translate(${x - 60}px, ${y - 60}px)`;
    base.classList.toggle('stick--active', active);
  };
  const restBase = () => {
    const zone = zoneRef.current;
    if (!zone) return;
    const r = zone.getBoundingClientRect();
    placeBase(r.left + 100, r.bottom - 110, false);
    if (knobRef.current) knobRef.current.style.transform = 'translate(0px, 0px)';
  };

  useEffect(() => {
    restBase();
    window.addEventListener('resize', restBase);
    return () => {
      window.removeEventListener('resize', restBase);
      touch.reset();
    };
  }, [touch]);

  const updateStick = (clientX: number, clientY: number) => {
    let dx = clientX - origin.current.x;
    let dy = clientY - origin.current.y;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      dx = (dx / len) * RADIUS;
      dy = (dy / len) * RADIUS;
    }
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
    touch.setMove(dx / RADIUS, -dy / RADIUS);
  };

  const onStickDown = (e: PointerEvent<HTMLDivElement>) => {
    if (stickPointer.current !== null) return;
    stickPointer.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
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

  const onJumpDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (jumpPointer.current !== null) return;
    jumpPointer.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    touch.setJump(true);
    setJumping(true);
  };
  const onJumpUp = (e: PointerEvent) => {
    if (e.pointerId !== jumpPointer.current) return;
    jumpPointer.current = null;
    touch.setJump(false);
    setJumping(false);
  };

  return (
    <div className="touch">
      <div
        ref={zoneRef}
        className="touch__zone"
        onPointerDown={onStickDown}
        onPointerMove={onStickMove}
        onPointerUp={onStickUp}
        onPointerCancel={onStickUp}
      />
      <div ref={baseRef} className="stick" aria-hidden="true">
        <div ref={knobRef} className="stick__knob" />
      </div>
      <div className="touch__buttons">
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
        <button
          type="button"
          className={`touch__btn touch__jump${jumping ? ' is-on' : ''}`}
          onPointerDown={onJumpDown}
          onPointerUp={onJumpUp}
          onPointerCancel={onJumpUp}
        >
          Saltar
        </button>
      </div>
    </div>
  );
}
