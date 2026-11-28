/** Fase 12 — techos y azoteas sólidos: aterrizar, caminar y saltar encima de cada edificio. */
import { beforeAll, describe, expect, it } from 'vitest';
import { CharacterBody } from '@/physics/CharacterBody';
import { loadRapier, PhysicsWorld, type Rapier } from '@/physics/PhysicsWorld';
import { SIMULATION } from '@shared/constants';
import { rotateXZ } from '@shared/math';
import { Buttons, emptyInput, type PlayerInput } from '@shared/types';
import { prefabColliders, worldColliders } from '@shared/world/colliders';
import { generateWorldLayout } from '@shared/world/layout';
import { insideState, type BoxPart, type PlacedPrefab } from '@shared/world/prefab';

let R: Rapier;
beforeAll(async () => { R = await loadRapier(); });
const layout = generateWorldLayout();

function makeWorld() {
  const physics = new PhysicsWorld(R);
  physics.addTerrain(layout.terrain);
  worldColliders(layout, true).forEach((c) => physics.addStatic(c));
  physics.step();
  return physics;
}
let seq = 0;
const run = (b: CharacterBody, ph: PhysicsWorld, input: Partial<PlayerInput>, ticks: number) => {
  for (let i = 0; i < ticks; i++) { b.step({ ...emptyInput(++seq), ...input }, SIMULATION.fixedDt); ph.step(); }
  return b.state;
};
/** Edificios con tejado (piezas de capa roof que colisionan). */
export const roofed = (l = layout): PlacedPrefab[] => {
  const seen = new Set<string>();
  return l.structures.filter((s) => s.def.parts.some((p) => p.kind === 'box' && p.layer === 'roof' && p.collide) && !seen.has(s.def.id) && seen.add(s.def.id));
};
const world = (s: PlacedPrefab, lx: number, lz: number) => { const r = rotateXZ(lx, lz, s.rotationY); return { x: s.x + r.x, z: s.z + r.z }; };
/** Altura de las paredes (tope de las piezas que no son techo). */
const wallTop = (s: PlacedPrefab) => Math.max(...s.def.parts.filter((p): p is BoxPart => p.kind === 'box' && p.layer !== 'roof' && p.collide && p.visible && !!p.facing).map((p) => p.center.y + p.size.y / 2));

describe('fase 12: techos sólidos', () => {
  it('todos los tejados colisionan igual en cliente y servidor (misma lista de piezas)', () => {
    const ids = roofed().map((s) => s.def.id);
    expect(ids).toContain('house');
    for (const s of roofed()) {
      const roofParts = s.def.parts.filter((p) => p.kind === 'box' && p.layer === 'roof' && p.collide).length;
      expect(roofParts, s.def.id).toBeGreaterThan(0);
      expect(prefabColliders(s).length).toBe(s.def.parts.filter((p) => p.kind === 'box' && p.collide).length);
    }
  });

  it('se aterriza desde el cielo sobre cada tejado, sin atravesarlo, y cuenta como fuera', () => {
    const ph = makeWorld();
    for (const s of roofed()) {
      // Punto de caída: el centro de cada losa de tejado grande (las dos aguas, azoteas, media cubierta).
      const slabs = s.def.parts.filter((p): p is BoxPart => p.kind === 'box' && p.layer === 'roof' && p.collide && p.size.x * p.size.z > 4);
      expect(slabs.length, s.def.id).toBeGreaterThan(0);
      for (const slab of slabs) {
        const p = world(s, slab.center.x, slab.center.z);
        const top = wallTop(s);
        const b = new CharacterBody(ph, 'r', 'r', { x: p.x, y: s.y + top + 25, z: p.z });
        const st = run(b, ph, {}, 150);
        expect(st.grounded, `${s.def.id} en ${slab.center.x},${slab.center.z}`).toBe(true);
        // Sobre la losa (el tejadillo del porche está más bajo que las paredes).
        const surface = Math.min(top, slab.center.y + slab.size.y / 2) - 0.05;
        expect(st.position.y - s.y, s.def.id).toBeGreaterThan(surface);
        expect(insideState(s, st.position.x, st.position.y, st.position.z), s.def.id).toBe('outside');
        // Camina hacia la cumbrera/centro, corre y salta encima sin caer dentro.
        const dir = rotateXZ(-Math.sign(slab.center.x) * 0.5, 0, s.rotationY);
        run(b, ph, { moveX: dir.x, moveZ: dir.z, buttons: Buttons.SPRINT }, 8);
        run(b, ph, { buttons: Buttons.JUMP }, 2);
        const after = run(b, ph, {}, 40);
        expect(after.position.y - s.y, `${s.def.id} tras saltar`).toBeGreaterThan(surface);
        b.dispose();
      }
    }
  });
});
