import { type BuildKind } from '@shared/building/BuildingState';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Game, KillFeedEntry } from '@/game/Game';
import { magOf, type Inventory as InventoryState } from '@shared/inventory';
import { isWeapon, supportsScope, ITEMS, itemName, type ItemKind, type ItemStack } from '@shared/items';
import type { Vitals } from '@shared/combat/CombatState';
import { HEALTH, WEAPON_STATS } from '@shared/combat/weapons';
import { terrainHeight } from '@shared/world/terrain';

/** Barra de salud (0..100, sin escudos). Se muestra redondeada hacia arriba: 0,4 sigue siendo 1. */
export function HealthBar({ value = 100, max = 100 }: { value?: number; max?: number }) {
  const pct = Math.max(0, Math.min(1, value / max));
  const shown = Math.ceil(value - 1e-6);
  const level = pct <= 0.25 ? ' is-low' : pct <= 0.5 ? ' is-mid' : '';
  return (
    <div className={`w-health${level}`} role="meter" aria-label="Salud" aria-valuemin={0} aria-valuemax={max} aria-valuenow={shown}>
      <span className="w-health__label">Salud</span>
      <span className="w-health__bar">
        <span className="w-health__fill" style={{ transform: `scaleX(${pct})` }} />
      </span>
      <span className="w-health__num">{shown}</span>
    </div>
  );
}

/** Salud conectada al juego (solo se redibuja al cambiar). */
export function LiveHealth({ game }: { game: Game | null }) {
  const [v, setV] = useState<Vitals | null>(() => game?.currentVitals ?? null);
  useEffect(() => {
    if (!game) return;
    setV(game.currentVitals);
    return game.events.on('vitals', setV);
  }, [game]);
  return <HealthBar value={v?.hp ?? HEALTH.max} max={HEALTH.max} />;
}

/**
 * Munición del arma en la mano (cargador / bolsa) con la barra de recarga, o
 * la curación en curso con botiquín. Sin datos (editor) muestra un ejemplo.
 */
export function AmmoCounter({ inventory = null, vitals = null }: { inventory?: InventoryState | null; vitals?: Vitals | null }) {
  const item = inventory ? inventory.slots[inventory.selected] : ({ kind: 'rifle', qty: 1, mag: 24 } as ItemStack);
  const [, tick] = useState(0);
  const busy = (vitals?.reload ?? 0) > 0 || (vitals?.heal ?? 0) > 0;
  const started = useRef({ at: 0, total: 0, left: 0 });
  // Las barras avanzan localmente entre mensajes (el servidor solo avisa al empezar y al terminar).
  useEffect(() => {
    if (!vitals || !busy) return;
    const left = vitals.reload > 0 ? vitals.reload : vitals.heal;
    const total = vitals.reload > 0 ? vitals.reloadTotal : vitals.healTotal;
    started.current = { at: performance.now(), total, left };
    const t = window.setInterval(() => tick((n) => n + 1), 100);
    return () => window.clearInterval(t);
  }, [vitals, busy]);
  const progress = busy && started.current.total > 0 ? Math.min(1, 1 - (started.current.left - (performance.now() - started.current.at) / 1000) / started.current.total) : 0;
  if (vitals && vitals.heal > 0)
    return (
      <div className="w-mag w-mag--heal" role="status" aria-label="Curándote">
        <span className="w-mag__label">Curando</span>
        <span className="w-mag__bar"><span style={{ transform: `scaleX(${progress})` }} /></span>
      </div>
    );
  if (!item || !isWeapon(item.kind)) {
    if (item?.kind === 'medkit')
      return (
        <div className="w-mag" role="status" aria-label="Botiquín">
          <span className="w-mag__label">Botiquín ×{item.qty}</span>
          <span className="w-mag__hint">Atacar = curar 50</span>
        </div>
      );
    return null;
  }
  const mag = magOf(item);
  const reserve = inventory ? inventory.ammo[ITEMS[item.kind].ammo!] : 90;
  const reloading = (vitals?.reload ?? 0) > 0;
  return (
    <div className={`w-mag${mag === 0 ? ' is-empty' : ''}`} role="status" aria-label={`Munición: ${mag} de ${WEAPON_STATS[item.kind].magazine}, ${reserve} en la bolsa`}>
      <span className="w-mag__count">
        <b>{mag}</b>/{WEAPON_STATS[item.kind].magazine}
      </span>
      <span className="w-mag__reserve">{reserve}</span>
      {reloading && <span className="w-mag__bar"><span style={{ transform: `scaleX(${progress})` }} /></span>}
      {!reloading && mag === 0 && <span className="w-mag__hint">{reserve > 0 ? 'Recarga' : 'Sin balas'}</span>}
    </div>
  );
}

export function LiveAmmo({ game }: { game: Game | null }) {
  const [inv, setInv] = useState(() => game?.inventory ?? null);
  const [v, setV] = useState<Vitals | null>(() => game?.currentVitals ?? null);
  useEffect(() => {
    if (!game) return;
    setInv(game.inventory);
    setV(game.currentVitals);
    const a = game.events.on('inventory', setInv);
    const b = game.events.on('vitals', setV);
    return () => {
      a();
      b();
    };
  }, [game]);
  return <AmmoCounter inventory={inv} vitals={v} />;
}

const WEAPON_SHORT: Record<string, string> = { axe: 'hacha', pistol: 'pistola', smg: 'subfusil', rifle: 'rifle', shotgun: 'escopeta', sniper: 'francotirador' };

/** Últimas bajas (desaparecen a los 6 s). Datos listos para las estadísticas de la fase 8. */
export function KillFeed({ entries }: { entries: (KillFeedEntry & { key: number })[] }) {
  return (
    <ol className="w-feed" aria-label="Bajas recientes" aria-live="polite">
      {entries.map((e) => (
        <li key={e.key} className={`${e.mine ? 'is-mine' : ''}${e.me ? ' is-me' : ''}`}>
          <b>{e.killer}</b> <span className="w-feed__w">[{WEAPON_SHORT[e.weapon] ?? e.weapon}]</span> <b>{e.victim}</b>
        </li>
      ))}
    </ol>
  );
}

export function LiveKillFeed({ game }: { game: Game | null }) {
  const [entries, setEntries] = useState<(KillFeedEntry & { key: number })[]>([]);
  useEffect(() => {
    if (!game) return;
    let key = 0;
    const timers = new Set<number>();
    const off = game.events.on('killfeed', (e) => {
      const k = ++key;
      setEntries((list) => [...list.slice(-3), { ...e, key: k }]);
      const t = window.setTimeout(() => {
        timers.delete(t);
        setEntries((list) => list.filter((x) => x.key !== k));
      }, 6000);
      timers.add(t);
    });
    return () => {
      off();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [game]);
  if (!game) return <KillFeed entries={[{ key: 0, killer: 'Ana', victim: 'Beto', weapon: 'rifle', mine: false, me: false }]} />;
  return <KillFeed entries={entries} />;
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

/** Icono simple por tipo de objeto (SVG en línea, sin texturas). */
export function ItemIcon({ kind }: { kind: ItemKind }) {
  const cat = ITEMS[kind].category;
  if (kind === 'axe')
    return (
      <svg viewBox="0 0 24 24" className="w-icon" aria-hidden="true">
        <path d="M14 3c3 0 6 2 7 5-2 0-4 1-5 3l-2-2-8 12-2-1 8-12-2-2c1-2 2-3 4-3Z" />
      </svg>
    );
  const paths: Partial<Record<ItemKind,string>> = {
    pistol:'M3 7h15l3 2v3H11l-2 7H5l2-7H3Zm9 5v3h3v-3Z',
    smg:'M2 7h14v2h6v3H13l1 7h-4l-1-7H6l-1 6H2l2-7H2Zm4-3h7v2H6Z',
    shotgun:'M1 9h21v2H9v2h13v2H8l-4 4H1l3-6H1Zm8 6h6v2H9Z',
    rifle:'M1 9h6V7h5v2h11v2H12l-1 7H8l1-6H6l-3 4H1Zm13-3h5v2h-5Z',
    sniper:'M1 10h9V8H8V6h9v2h-4v2h10v2H11l-1 6H7l1-5H5l-4 4Zm18 3h1l2 6h-2Z',
    scope2:'M4 8h16v8H4Zm4-3h8v2H8Zm2 12h4v3h-4Z',
  };
  if(paths[kind])return <svg viewBox="0 0 24 24" className="w-icon" aria-hidden="true"><path d={paths[kind]}/></svg>;
  if (cat === 'ammo')
    return (
      <svg viewBox="0 0 24 24" className="w-icon" aria-hidden="true">
        <path d="M6 9h3V5l-1.5-2L6 5Zm5 0h3V5l-1.5-2L11 5Zm5 0h3V5l-1.5-2L16 5ZM5 10h15v10H5Z" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" className="w-icon w-icon--heal" aria-hidden="true">
      <path d="M4 7h16v13H4Zm6 3v3H7v2h3v3h2v-3h3v-2h-3v-3Z" />
    </svg>
  );
}



/**
 * Inventario de 5 huecos. Sin datos muestra los huecos vacíos (vista previa
 * del editor). Con datos: hacha en el 1, objetos con su rareza y cantidad,
 * munición debajo; tocar un hueco lo selecciona (lo valida la autoridad).
 */
export function Inventory({
  slots = 5,
  selected = 0,
  inventory = null,
  onSelect,
  onScope,
}: {
  slots?: number;
  selected?: number;
  inventory?: InventoryState | null;
  onSelect?: (slot: number) => void;
  onScope?: (equipped: boolean) => void;
}) {
  const sel = inventory?.selected ?? selected;
  const items: (ItemStack | null)[] = inventory?.slots ?? Array.from({ length: slots }, () => null);
  const held = items[sel];
  const canScope = held && supportsScope(held.kind) && (held.scope || items.some(s=>s?.kind==='scope2'));
  return (
    <div className="w-inv-wrap">
      <ol className="w-inv" aria-label={inventory ? 'Inventario' : 'Inventario vacío'}>
        {items.map((it, i) => (
          <li key={i} className={`w-inv__slot${i === sel ? ' is-on' : ''}${it?.rarity ? ` r-${it.rarity}` : ''}`}>
            <button
              type="button"
              className="w-inv__btn"
              aria-label={`Hueco ${i + 1}: ${it ? itemName(it) : 'vacío'}`}
              aria-pressed={i === sel}
              tabIndex={onSelect ? 0 : -1}
              onClick={() => onSelect?.(i)}
            >
              <span className="w-inv__key" aria-hidden="true">
                {i + 1}
              </span>
              {it && <ItemIcon kind={it.kind} />}
              {/* Fase 15: el arma en la mano ya muestra cargador y reserva en el indicador inferior; en las
                  demás casillas solo el cargador (sin duplicar la reserva en cada una). */}
              {it && isWeapon(it.kind) && i !== inventory?.selected && <span className="w-inv__ammo" aria-label={`Munición ${magOf(it)} / ${inventory?.ammo[ITEMS[it.kind].ammo!] ?? 0}`}>{magOf(it)}</span>}
              {it && (it.scope || it.kind==='sniper') && <span className="w-inv__scope">{it.kind==='sniper'?'x4':'x2'}</span>}
              {it && it.qty > 1 && <span className="w-inv__qty">{it.qty}</span>}
            </button>
          </li>
        ))}
      </ol>
      {canScope && <button type="button" className="w-scope-toggle" onClick={()=>onScope?.(!held?.scope)} aria-label={held?.scope?'Retirar Mira x2':'Equipar Mira x2'} aria-pressed={!!held?.scope}><ItemIcon kind="scope2"/><span>{held?.scope?'− x2':'+ x2'}</span></button>}
    </div>
  );
}

/** Inventario conectado al juego (se re-dibuja solo cuando cambia). */
export function LiveInventory({ game }: { game: Game | null }) {
  const [inv, setInv] = useState(() => game?.inventory ?? null);
  useEffect(() => {
    if (!game) return;
    setInv(game.inventory);
    return game.events.on('inventory', setInv);
  }, [game]);
  return <Inventory inventory={inv} onSelect={game ? (i) => game.selectSlot(i) : undefined} onScope={game ? equipped=>game.equipScope(equipped) : undefined} />;
}



/**
 * Minimapa: el terreno se pinta UNA vez en un canvas pequeño; encima, otro
 * canvas con los jugadores se redibuja 10 veces por segundo (no por frame).
 * Va girado 45° para coincidir con la vista isométrica (arriba = hacia donde
 * "sube" la pantalla).
 */
export function Minimap({ game, expanded = false, onOpen }: { game: Game | null; expanded?: boolean; onOpen?:()=>void }) {
  const MAP_PX = expanded ? 512 : 128;
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
      if (s.def.id === 'chest') continue; // los cofres van en la capa dinámica
      const r = s.def.id === 'house' ? 5 : s.def.id.startsWith('small-') ? 3.2 : 2.2;
      c.fillStyle = s.def.id.startsWith('small-') ? '#8a3b2b' : '#b23a37';
      c.fillRect(((s.x + half) / layout.terrain.size) * MAP_PX - r, ((s.z + half) / layout.terrain.size) * MAP_PX - r, r * 2, r * 2);
    }
  }, [game, MAP_PX, expanded]);

  useEffect(() => {
    if (!game) return;
    const draw = () => {
      const c = dotsRef.current?.getContext('2d');
      const st = game.minimapState();
      if (!c || !st.size) return;
      const half = st.size / 2;
      const u = (x: number) => ((x + half) / st.size) * MAP_PX;
      c.clearRect(0, 0, MAP_PX, MAP_PX);
      if (st.zone) {
        // Fuera de la zona actual: velo violeta (regla par-impar: el círculo queda limpio).
        c.beginPath(); c.rect(0, 0, MAP_PX, MAP_PX);
        c.arc(u(st.zone.current.x), u(st.zone.current.z), st.zone.current.radius / st.size * MAP_PX, 0, Math.PI * 2);
        c.fillStyle = '#6b3fd04d'; c.fill('evenodd');
        for (const [circle, color, dashed] of [[st.zone.current, '#ac78ff', false], [st.zone.next, '#ffffff', true]] as const) {
          c.beginPath(); c.strokeStyle = color; c.lineWidth = 2; c.setLineDash(dashed ? [3, 3] : []);
          c.arc(u(circle.x), u(circle.z), circle.radius / st.size * MAP_PX, 0, Math.PI * 2); c.stroke();
        }
        c.setLineDash([]);
      }
      // Fase 12: ruta del avión (discontinua) y su posición; el propio, más visible.
      for (const pl of st.planes ?? []) {
        c.beginPath(); c.setLineDash([4, 3]); c.lineWidth = pl.mine ? 2 : 1; c.strokeStyle = pl.mine ? '#ffd34d' : '#ffffffaa';
        c.moveTo(u(pl.ax), u(pl.az)); c.lineTo(u(pl.bx), u(pl.bz)); c.stroke(); c.setLineDash([]);
        c.fillStyle = pl.mine ? '#ffd34d' : '#ffffff';
        c.beginPath(); c.arc(u(pl.x), u(pl.z), pl.mine ? 4 : 3, 0, Math.PI * 2); c.fill();
      }
      // Cofres aún cerrados (dorados).
      c.fillStyle = '#ffd34d';
      c.strokeStyle = '#5e3b1c';
      c.lineWidth = 1;
      for (const ch of st.chests) {
        if (ch.opened) continue;
        c.fillRect(u(ch.x) - 1.8, u(ch.z) - 1.8, 3.6, 3.6);
        c.strokeRect(u(ch.x) - 1.8, u(ch.z) - 1.8, 3.6, 3.6);
      }
      c.fillStyle = '#ff5a5f';
      for (const o of st.others) {
        c.beginPath();
        c.arc(u(o.x), u(o.z), 3, 0, Math.PI * 2);
        c.fill();
      }
      for(const mark of st.markers) {
        c.fillStyle='#ffdf67'; c.strokeStyle='#3c234f'; c.lineWidth=1.5;
        c.beginPath();c.arc(u(mark.x),u(mark.z),expanded?6:4,0,Math.PI*2);c.fill();c.stroke();
        c.beginPath();c.moveTo(u(mark.x),u(mark.z)+4);c.lineTo(u(mark.x),u(mark.z)+10);c.stroke();
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
  }, [game, MAP_PX, expanded]);

  return (
    <div className={`w-map${expanded?' w-map--full':''}`} role="button" tabIndex={0} aria-label={expanded?'Mapa completo: toca para marcar destino':'Abrir mapa completo'}
      onClick={e=>{
        if(!expanded){onOpen?.();return;}
        const rect=e.currentTarget.getBoundingClientRect(), size=game?.worldLayout?.terrain.size??0;
        if(size)game?.addMapMarker(((e.clientX-rect.left)/rect.width-.5)*size,((e.clientY-rect.top)/rect.height-.5)*size);
      }} onKeyDown={e=>{if(!expanded&&(e.key==='Enter'||e.key===' ')){e.preventDefault();onOpen?.();}}}>
      <div className="w-map__rot">
        <canvas ref={baseRef} width={MAP_PX} height={MAP_PX} />
        <canvas ref={dotsRef} width={MAP_PX} height={MAP_PX} />
      </div>
    </div>
  );
}

export type InfoWidgetId = 'wood' | 'construction' | 'health' | 'ammo' | 'killfeed' | 'lives' | 'inventory' | 'minimap';
export const INFO_WIDGETS: readonly InfoWidgetId[] = ['wood', 'construction', 'health', 'ammo', 'killfeed', 'lives', 'inventory', 'minimap'];

/** Indicadores del HUD (todas las pantallas). */
export function renderInfoWidget(id: InfoWidgetId, game: Game | null, preview = false, onMap?:()=>void) {
  switch (id) {
    case 'wood':
      return <ConstructionWidget game={game} counter />;
    case 'construction':
      return <ConstructionWidget game={preview ? null : game} />;
    case 'health':
      return game ? <LiveHealth game={game} /> : <HealthBar />;
    case 'ammo':
      return game && !preview ? <LiveAmmo game={game} /> : <AmmoCounter />;
    case 'killfeed':
      return <LiveKillFeed game={preview ? null : game} />;
    case 'lives':
      return game ? <LiveLives game={game} /> : <Lives />;
    case 'inventory':
      return <LiveInventory game={game} />;
    case 'minimap':
      return <Minimap game={game} onOpen={preview?undefined:onMap} />;
  }
}


const BUILD_LABELS: Record<BuildKind, string> = { wall: 'Pared', floor: 'Suelo', ramp: 'Rampa', roof: 'Techo' };
/** Botones directos en pantalla (el techo sigue disponible con V o el mando). */
export const BUILD_BUTTONS: readonly BuildKind[] = ['wall', 'ramp', 'floor'];

/** Iconos sencillos (SVG en línea) de cada pieza, vistos de lado/en perspectiva. */
export function BuildIcon({ kind }: { kind: BuildKind }) {
  const path = kind === 'wall' ? 'M4 5h16v14H4Zm0 5h16M4 14h16M10 5v5M15 10v4M9 14v5'
    : kind === 'ramp' ? 'M3 19 19 5h2v14Zm4-1 3-3m1 3 3-3m1 3 3-3'
      : kind === 'floor' ? 'M2 15 9 9h13l-7 6Zm0 0v2h13l7-6v-2M15 15v2'
        : 'M2 14 12 5l10 9M5 12v6h14v-6';
  return (
    <svg viewBox="0 0 24 24" className="w-build__icon" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

/**
 * Construcción sin ventana central: tres botones circulares (pared, rampa,
 * suelo). Mantener pulsado muestra la vista previa (marrón si es válida, roja
 * si no); soltar construye una sola vez. Orientación y altura son automáticas.
 * Con `counter` muestra solo la madera.
 */
export function ConstructionWidget({ game, counter = false }: { game: Game | null; counter?: boolean }) {
  const [ui, setUi] = useState(() => game?.buildingUi);
  const pointer = useRef<number | null>(null);
  useEffect(() => {
    if (!game) return;
    const timer = window.setInterval(() => setUi(previous => {
      const next = game.buildingUi;
      return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
    }), 100);
    return () => window.clearInterval(timer);
  }, [game]);
  if (counter) return <div className="w-wood" aria-label="Madera">Madera {ui?.wood ?? 0}</div>;
  const end = (confirm: boolean) => (e: PointerEvent<HTMLButtonElement>) => {
    if (pointer.current !== e.pointerId) return;
    pointer.current = null;
    game?.releaseBuild(confirm);
  };
  return (
    <div className="w-build" role="group" aria-label="Construir">
      {BUILD_BUTTONS.map((kind) => {
        const active = ui?.holding === kind;
        return (
          <button
            type="button"
            key={kind}
            className={`w-build__btn${active ? (ui?.valid ? ' is-valid' : ' is-invalid') : ''}`}
            aria-label={`${BUILD_LABELS[kind]} (mantén para ver, suelta para construir · 10 madera)`}
            aria-pressed={active}
            onPointerDown={(e) => {
              e.preventDefault();
              if (pointer.current !== null) return;
              pointer.current = e.pointerId;
              e.currentTarget.setPointerCapture?.(e.pointerId);
              game?.pressBuild(kind);
            }}
            onPointerUp={end(true)}
            onPointerCancel={end(false)}
            onLostPointerCapture={end(false)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <BuildIcon kind={kind} />
          </button>
        );
      })}
    </div>
  );
}

function LiveLives({ game }: { game: Game }) {
  const [v, setV] = useState(game.currentVitals);
  useEffect(() => game.events.on('vitals', setV), [game]);
  return <Lives lives={v.lives ?? 3} />;
}
