import { useRef, useState, type PointerEvent } from 'react';

interface Props {
  onMove(x: number, y: number): void;
  onJump(): void;
}

const RADIUS = 56; // px de recorrido del stick

/**
 * Joystick virtual flotante: aparece donde el pulgar toca la mitad izquierda.
 * Devuelve un vector de pantalla (x derecha, y arriba) de magnitud 0..1.
 */
export function TouchControls({ onMove, onJump }: Props) {
  const pointerId = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const [stick, setStick] = useState<{ ox: number; oy: number; dx: number; dy: number } | null>(null);

  const update = (e: PointerEvent) => {
    let dx = e.clientX - origin.current.x;
    let dy = e.clientY - origin.current.y;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      dx = (dx / len) * RADIUS;
      dy = (dy / len) * RADIUS;
    }
    setStick({ ox: origin.current.x, oy: origin.current.y, dx, dy });
    onMove(dx / RADIUS, -dy / RADIUS);
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== null) return;
    pointerId.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    origin.current = { x: e.clientX, y: e.clientY };
    update(e);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerId === pointerId.current) update(e);
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId.current) return;
    pointerId.current = null;
    setStick(null);
    onMove(0, 0);
  };

  return (
    <div className="touch">
      <div
        className="touch__zone"
        onPointerDown={onDown}
        onPointerMove={onPointerMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {stick && (
          <div className="stick" style={{ left: stick.ox, top: stick.oy }}>
            <div className="stick__knob" style={{ transform: `translate(${stick.dx}px, ${stick.dy}px)` }} />
          </div>
        )}
      </div>
      <button
        type="button"
        className="touch__jump"
        aria-label="Saltar"
        onPointerDown={(e) => {
          e.preventDefault();
          onJump();
        }}
      >
        Saltar
      </button>
    </div>
  );
}
