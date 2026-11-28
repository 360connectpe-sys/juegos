// @vitest-environment jsdom
/** Fase 12 — interfaz: Ajustes accesible para todos en partida (también en el celular). */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/ui/styles.css', 'utf8');
const zOf = (selector: string): number => {
  const style = document.createElement('style'); style.textContent = css; document.head.append(style);
  try {
    const el = document.createElement('div'); el.className = selector; document.body.append(el);
    const z = Number(getComputedStyle(el).zIndex); el.remove(); return z;
  } finally { style.remove(); }
};

describe('fase 12: Ajustes para todos los jugadores', () => {
  it('el HUD (botón de Ajustes) queda por encima de la zona táctil de mirada', () => {
    // Antes .hud (5) < .touch (6): en el celular .touch__look tapaba el engranaje y solo
    // podía abrir Ajustes quien jugaba en ordenador (normalmente el anfitrión).
    expect(zOf('hud')).toBeGreaterThan(zOf('touch'));
  });
});

import { ZombieView } from '@/game/world/ZombieView';
import { AirView } from '@/game/world/AirView';
import { CombatOverlay } from '@/game/combat/CombatOverlay';
import { PerspectiveCamera } from 'three';
import { startRoute } from '@shared/battle/flight';
import { zoneAt, zonePlan } from '@shared/battle/zone';
import type { RoundSnapshot } from '@shared/battle/BattleRound';

describe('fase 12: vistas ligeras (avión, paracaídas, zombis, barra de salud)', () => {
  it('zombis: una InstancedMesh, suaviza posiciones y retira los que ya no llegan', () => {
    const v = new ZombieView(false);
    v.sync([{ num: 1, x: 0, y: 0, z: 0, yaw: 0, anim: 2, hp: 40 }, { num: 2, x: 5, y: 0, z: 5, yaw: 1, anim: 3, hp: 20 }]);
    v.update(1 / 60);
    expect(v.mesh.count).toBe(2); expect(v.mesh.visible).toBe(true);
    v.sync([{ num: 2, x: 6, y: 0, z: 5, yaw: 1, anim: 5, hp: 0 }]);
    for (let i = 0; i < 30; i++) v.update(1 / 30);
    expect(v.mesh.count).toBe(1); expect(v.list.get(2)!.pos.x).toBeCloseTo(6, 1);
    v.sync([]); v.update(1 / 60); expect(v.mesh.visible).toBe(false);
    v.dispose();
  });
  it('avión y paracaídas: como mucho 2 draw calls, posición según la ruta y el reloj de la ronda', () => {
    const a = new AirView(false);
    const route = startRoute(120, 4);
    const snap = { round: 1, phase: 'running', elapsed: 2, countdown: 0, zone: zoneAt(zonePlan(120, 1), 2), players: [], result: null, planes: [route], drops: [] } as RoundSnapshot;
    a.update(snap, 1 / 60);
    expect(a.planes.count).toBe(1);
    const p = a.planePose(0)!;
    expect(p.progress).toBeGreaterThan(0);
    a.beginChutes(); a.addChute(0, 10, 0, 0); a.endChutes();
    expect(a.chutes.count).toBe(1);
    a.update({ ...snap, phase: 'finished' }, 1 / 60); expect(a.planes.visible).toBe(false);
    a.dispose();
  });
  it('la barra de salud del zombi apuntado aparece y se oculta', () => {
    const o = new CombatOverlay(document);
    o.attach(document.body);
    const cam = new PerspectiveCamera(60, 1, 0.1, 100); cam.position.set(0, 2, 6); cam.lookAt(0, 1, 0); cam.updateMatrixWorld();
    o.aimTarget({ x: 0, y: 0, z: 0 }, 0.5);
    o.frame(cam, 800, 600, 1 / 60, 0);
    const bar = document.querySelector('.zbar') as HTMLDivElement;
    expect(bar.style.display).toBe('');
    expect((bar.firstElementChild as HTMLDivElement).style.width).toBe('50%');
    o.aimTarget(null, 0); expect(bar.style.display).toBe('none');
    o.dispose();
  });
});
