import { useEffect, useRef } from 'react';
import type { Game } from '@/game/Game';
import { terrainHeight } from '@shared/world/terrain';

/** Barra de salud (preparada: aún no hay daño, siempre llena). */
export function HealthBar({ value = 100, max = 100 }: { value?: number; max?: number }) {
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <div className="w-health" role="meter" aria-label="Salud" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <span className="w-health__label">Salud</span>
      <span className="w-health__bar">
        <span className="w-health__fill" style={{ transform: `scaleX(${pct})` }} />
      </span>
      <span className="w-health__num">{Math.round(value)}</span>
    </div>
  );
}

const Heart = ({ full }: { full: boolean }) => (
  <svg viewBox="0 0 24 22" className={`w-heart${full ? '' : ' w-heart--empty'}`} aria-hidden="true">
    <path d="M12 21 2.6 11.6A5.6 5.6 0 0 1 12 4.3a5.6 5.6 0 0 1 9.4 7.3Z" />
  </svg>
);

/** Vidas restantes (preparado: 3 de 3). */
export function Lives({ lives = 3, max = 3 }: { lives?: number; max?: number }) {
  return (
    <div className="w-lives" aria-label={`Vidas: ${lives} de ${max}`} role="img">
      {Array.from({ length: max }, (_, i) => (
        <Heart key={i} full={i < lives} />
      ))}
    </div>
  );
}

/** Inventario de 5 huecos (preparado: vacío, primero seleccionado). */
export function Inventory({ slots = 5, selected = 0 }: { slots?: number; selected?: number }) {
  return (
    <ol className="w-inv" aria-label="Inventario vacío">
      {Array.from({ length: slots }, (_, i) => (
        <li key={i} className={`w-inv__slot${i === selected ? ' is-on' : ''}`}>
          <span className="w-inv__key" aria-hidden="true">
            {i + 1}
          </span>
        </li>
      ))}
    </ol>
  );
}

const MAP_PX = 128;

/**
 * Minimapa: el terreno se pinta UNA vez en un canvas pequeño; encima, otro
 * canvas con los jugadores se redibuja 10 veces por segundo (no por frame).
 * Va girado 45° para coincidir con la vista isométrica (arriba = hacia donde
 * "sube" la pantalla).
 */
export function Minimap({ game }: { game: Game | null }) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const dotsRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const layout = game?.worldLayout;
    const c = baseRef.current?.getContext('2d');
    if (!layout || !c) return;
    const n = 64;
    const cell = MAP_PX / n;
    const half = layout.terrain.size / 2;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const x = -half + (i + 0.5) * (layout.terrain.size / n);
        const z = -half + (j + 0.5) * (layout.terrain.size / n);
        const h = terrainHeight(x, z, layout.terrain);
        c.fillStyle = h < -0.5 ? '#3fa7d6' : h < -0.2 ? '#e8d08a' : h < 1.2 ? '#7cc456' : '#4f9a3a';
        c.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5);
      }
    c.fillStyle = '#1f6e3a';
    for (const t of layout.trees) c.fillRect(((t.x + half) / layout.terrain.size) * MAP_PX - 1, ((t.z + half) / layout.terrain.size) * MAP_PX - 1, 2, 2);
    c.fillStyle = '#b23a37';
    for (const s of layout.structures) {
      const r = s.def.id === 'house' ? 5 : 2.5;
      c.fillRect(((s.x + half) / layout.terrain.size) * MAP_PX - r, ((s.z + half) / layout.terrain.size) * MAP_PX - r, r * 2, r * 2);
    }
  }, [game]);

  useEffect(() => {
    if (!game) return;
    const draw = () => {
      const c = dotsRef.current?.getContext('2d');
      const st = game.minimapState();
      if (!c || !st.size) return;
      const half = st.size / 2;
      const u = (x: number) => ((x + half) / st.size) * MAP_PX;
      c.clearRect(0, 0, MAP_PX, MAP_PX);
      c.fillStyle = '#ff5a5f';
      for (const o of st.others) {
        c.beginPath();
        c.arc(u(o.x), u(o.z), 3, 0, Math.PI * 2);
        c.fill();
      }
      if (st.local) {
        const { x, z, yaw } = st.local;
        c.save();
        c.translate(u(x), u(z));
        c.rotate(-yaw);
        c.fillStyle = '#ffffff';
        c.strokeStyle = '#231f5c';
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(0, 6);
        c.lineTo(4, -4);
        c.lineTo(-4, -4);
        c.closePath();
        c.fill();
        c.stroke();
        c.restore();
      }
    };
    draw();
    const t = window.setInterval(draw, 100);
    return () => window.clearInterval(t);
  }, [game]);

  return (
    <div className="w-map" role="img" aria-label="Minimapa">
      <div className="w-map__rot">
        <canvas ref={baseRef} width={MAP_PX} height={MAP_PX} />
        <canvas ref={dotsRef} width={MAP_PX} height={MAP_PX} />
      </div>
    </div>
  );
}

/** Indicadores del HUD (todas las pantallas). */
export function renderInfoWidget(id: 'health' | 'lives' | 'inventory' | 'minimap', game: Game | null) {
  switch (id) {
    case 'health':
      return <HealthBar />;
    case 'lives':
      return <Lives />;
    case 'inventory':
      return <Inventory />;
    case 'minimap':
      return <Minimap game={game} />;
  }
}
