import { describe, expect, it } from 'vitest';
import { Matrix4, Mesh } from 'three';
import { BuildingView, PREVIEW_COLORS } from '@/game/world/BuildingView';
import { MergedInteriors } from '@/game/world/PrefabView';
import { InstancedHeldItems, heldKey } from '@/game/combat/WeaponModels';
import { createTrees } from '@/game/world/Trees';
import { OfflineSession } from '@/net/OfflineSession';
import { loadRapier, PhysicsWorld } from '@/physics/PhysicsWorld';
import { rayHitbox } from '@shared/combat/hitscan';
import { BUILD, BUILD_KINDS, type BuildPiece } from '@shared/building/BuildingState';
import { generateWorldLayout } from '@shared/world/layout';
import type { MeshBasicMaterial } from 'three';

const layout = generateWorldLayout();

describe('sin WEBGL_multi_draw (Safari iOS): draw calls acotados', () => {
  it('128 estructuras = UNA malla (antes: 1 draw call por pieza sin la extensión)', () => {
    const trees = createTrees(layout.trees, layout.seed, false);
    const view = new BuildingView(layout.trees, trees);
    const pieces: BuildPiece[] = [];
    for (let i = 0; i < BUILD.maxPieces; i++) pieces.push({ kind: BUILD_KINDS[i % 4]!, x: (i % 16) * 3 - 24, y: Math.floor(i / 64) * 3, z: Math.floor((i % 64) / 16) * 3, rotation: i % 4, id: i + 1, owner: 'a', hp: BUILD.hp });
    view.update({ revision: 1, trees: layout.trees.map(() => BUILD.treeHp), pieces, wood: {} }, 0.016);
    expect(view.structures).toBeInstanceOf(Mesh);
    expect(view.structures.visible).toBe(true);
    expect(Object.values(view.drawn).reduce((a, b) => a + b, 0)).toBe(128);
    const verts = view.structures.geometry.drawRange.count;
    expect(verts).toBeGreaterThan(128 * 30);
    // Daño (tinte) o destrucción: se reescribe solo al cambiar la revisión.
    view.update({ revision: 2, trees: layout.trees.map(() => BUILD.treeHp), pieces: pieces.slice(0, 10), wood: {} }, 0.016);
    expect(view.drawn.wall + view.drawn.floor + view.drawn.ramp + view.drawn.roof).toBe(10);
    view.update({ revision: 3, trees: layout.trees.map(() => BUILD.treeHp), pieces: [], wood: {} }, 0.016);
    expect(view.structures.visible).toBe(false);
    // Vista previa: marrón oscuro si es válida, rojo si no.
    view.preview({ kind: 'floor', x: 0, y: 0, z: 0, rotation: 0 }, true);
    expect((view.ghost.material as MeshBasicMaterial).color.getHexString()).toBe(PREVIEW_COLORS.valid.slice(1));
    view.preview({ kind: 'floor', x: 0, y: 0, z: 0, rotation: 0 }, false);
    expect((view.ghost.material as MeshBasicMaterial).color.getHexString()).toBe(PREVIEW_COLORS.invalid.slice(1));
    view.dispose();
  });

  it('edificios con interior en una malla fusionada: ocultar uno y restaurarlo exactamente', () => {
    const interiors = layout.structures.filter((p) => p.def.interior);
    const merged = new MergedInteriors(interiors, false);
    const pos = merged.mesh.geometry.getAttribute('position');
    const before = (pos.array as Float32Array).slice();
    merged.setVisible(0, false);
    expect(merged.isHidden(0)).toBe(true);
    merged.setVisible(0, true);
    expect(Array.from(pos.array as Float32Array)).toEqual(Array.from(before));
  });

  it('armas en mano: una InstancedMesh por modelo visible, no una por jugador', () => {
    const held = new InstancedHeldItems();
    held.begin();
    for (let i = 0; i < 8; i++) held.place(`p${i}`, heldKey(i < 6 ? 'rifle' : 'axe', 'rare'), new Matrix4());
    held.end();
    expect(held.count).toBe(8);
    const visible = held.root.children.filter((m) => m.visible);
    expect(visible).toHaveLength(2); // rifle raro + hacha = 2 draw calls para 8 jugadores
    held.begin();
    held.end();
    expect(held.root.children.every((m) => !m.visible)).toBe(true);
    held.dispose();
  });
});

describe('sin basura por frame', () => {
  it('la sesión sin conexión reutiliza sus vistas y recalcula la ronda una vez por tick', async () => {
    const physics = new PhysicsWorld(await loadRapier());
    const s = new OfflineSession(physics, { x: 2.5, y: 0.1, z: 7.5 }, 'J', layout.chests, 3);
    expect(s.match).toBe(s.match);
    expect(s.combat).toBe(s.combat);
    expect(s.combat.vitals).toBe(s.combat.vitals);
    const b1 = s.battle;
    expect(s.battle).toBe(b1);
    s.tick({ seq: 1, moveX: 0, moveZ: 0, buttons: 0, aimYaw: 0 }, 1 / 30);
    expect(s.battle).not.toBe(b1); // invalidado por el tick
    s.dispose();
    physics.dispose();
  });

  it('el rayo contra la cápsula da los mismos resultados sin cierres ni arrays', () => {
    const o = { x: 0, y: 1, z: 0 };
    expect(rayHitbox(o, { x: 1, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 100)).toBeCloseTo(10 - 0.42, 6);
    expect(rayHitbox(o, { x: 0, y: 0, z: 1 }, { x: 10, y: 0, z: 0 }, 100)).toBeNull();
    expect(rayHitbox({ x: 10, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 5)).toBe(0); // dentro
    const down = rayHitbox({ x: 10, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 10, y: 0, z: 0 }, 100)!;
    expect(down).toBeCloseTo(5 - (1.3 + 0.42), 6); // semiesfera superior
  });
});
