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
const wallTop = (s: PlacedPrefab) => Math.max(...s.def.parts.filter((p): p is BoxPart => p.kind === 'box' && p.layer !== 'roof' && p.collide && p.visible).map((p) => p.center.y + p.size.y / 2));
const halfWidth = (s: PlacedPrefab) => Math.max(...s.def.parts.filter((p): p is BoxPart => p.kind === 'box' && p.layer === 'roof' && p.collide).map((p) => Math.abs(p.center.x) + p.size.x / 4));

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
      for (const side of [-1, 1]) {
        const p = world(s, side * halfWidth(s) * 0.5, 0.3);
        const top = wallTop(s);
        const b = new CharacterBody(ph, 'r', 'r', { x: p.x, y: s.y + top + 25, z: p.z });
        const st = run(b, ph, {}, 150);
        expect(st.grounded, `${s.def.id} lado ${side}`).toBe(true);
        expect(st.position.y - s.y, s.def.id).toBeGreaterThan(top - 0.05);
        expect(insideState(s, st.position.x, st.position.y, st.position.z), s.def.id).toBe('outside');
        // Camina, corre y salta encima sin caer dentro.
        const back = rotateXZ(-side, 0, s.rotationY);
        run(b, ph, { moveX: back.x * 0.5, moveZ: back.z * 0.5 }, 10);
        run(b, ph, { buttons: Buttons.JUMP }, 2);
        const after = run(b, ph, {}, 40);
        expect(after.position.y - s.y, `${s.def.id} tras saltar`).toBeGreaterThan(top - 0.05);
        b.dispose();
      }
    }
  });
});
