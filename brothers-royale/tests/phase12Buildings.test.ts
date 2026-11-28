/** Fase 12 — seis diseños de edificio: presentes en cada partida, recorribles y sin atascos. */
import { beforeAll, describe, expect, it } from 'vitest';
import { CharacterBody } from '@/physics/CharacterBody';
import { loadRapier, PhysicsWorld, type Rapier } from '@/physics/PhysicsWorld';
import { SIMULATION } from '@shared/constants';
import { rotateXZ } from '@shared/math';
import { Buttons, emptyInput } from '@shared/types';
import { EXTRA_SIZE, extraChestSpots, FURNITURE_SIZE } from '@shared/world/buildings';
import { worldColliders } from '@shared/world/colliders';
import { generateWorldLayout, REQUIRED_VARIANTS, variantOf, type BuildingVariant } from '@shared/world/layout';
import type { BoxPart, PlacedPrefab } from '@shared/world/prefab';
import { CHEST, SMALL_HOUSE_SIZE, smallHouseChestSpot } from '@shared/world/structures';

let R: Rapier;
beforeAll(async () => { R = await loadRapier(); });
const layout = generateWorldLayout();

describe('fase 12: diseños de edificio', () => {
  it('cada partida tiene los 6 diseños (rural, familiar de 2 plantas, moderna con azotea, balcón, garaje, abandonado)', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const l = generateWorldLayout({ seed: seed * 7919 });
      const ids = new Set(l.structures.map((s) => s.def.id));
      expect(ids.has('house'), `semilla ${seed}`).toBe(true);
      for (const v of REQUIRED_VARIANTS) expect(l.houses.some((h) => variantOf(h) === v), `semilla ${seed}: ${v}`).toBe(true);
    }
  });

  it('muebles, armas y recursos: cada diseño tiene muebles y al menos un cofre dentro', () => {
    const seen = new Set<string>();
    for (const h of layout.houses) {
      if (seen.has(h.def.id)) continue;
      seen.add(h.def.id);
      const hidden = h.def.parts.filter((p) => p.kind === 'box' && p.collide && !p.visible && !p.rot);
      expect(hidden.length, `${h.def.id}: muebles`).toBeGreaterThan(0);
      expect(layout.chests.some((c) => c.where === 'small-house' && Math.hypot(c.x - h.x, c.z - h.z) < 6), h.def.id).toBe(true);
    }
    expect(Object.keys(FURNITURE_SIZE)).toEqual(expect.arrayContaining(['bed', 'table', 'chair', 'shelf', 'crate']));
  });

  it('ningún mueble ni pared se solapa con un cofre', () => {
    const variants: BuildingVariant[] = ['cabin', 'stone', 'long', 'porch', 'modern', 'balcony', 'garage', 'ruin'];
    for (const v of variants) {
      const h = generateWorldLayout({ seed: 1 }).houses.find((x) => variantOf(x) === v) ?? [...Array(40)].map((_, i) => generateWorldLayout({ seed: i + 2 }).houses.find((x) => variantOf(x) === v)).find(Boolean);
      if (!h) continue;
      const spots = v in EXTRA_SIZE ? extraChestSpots(v as keyof typeof EXTRA_SIZE) : [{ ...smallHouseChestSpot(v as keyof typeof SMALL_HOUSE_SIZE), y: 0 }];
      for (const c of spots) {
        const turned = Math.abs(Math.sin(c.yaw)) > 0.5;
        const cw = (turned ? CHEST.depth : CHEST.width) / 2, cd = (turned ? CHEST.width : CHEST.depth) / 2;
        for (const p of h.def.parts) {
          if (p.kind !== 'box' || !p.collide || p.rot) continue;
          const b = p as BoxPart;
          const ox = Math.abs(b.center.x - c.x) < b.size.x / 2 + cw - 0.01;
          const oz = Math.abs(b.center.z - c.z) < b.size.z / 2 + cd - 0.01;
          const oy = b.center.y + b.size.y / 2 > c.y + 0.05 && b.center.y - b.size.y / 2 < c.y + CHEST.height;
          expect(ox && oz && oy, `${v}: cofre en ${c.x},${c.y},${c.z} choca con pieza en ${JSON.stringify(b.center)}`).toBe(false);
        }
      }
    }
  });

  it('se entra por la puerta y se llega a cada cofre (también por escaleras a la planta alta y a la azotea)', () => {
    const physics = new PhysicsWorld(R);
    physics.addTerrain(layout.terrain);
    worldColliders(layout).forEach((c) => physics.addStatic(c));
    physics.step();
    let seq = 0;
    const walk = (body: CharacterBody, h: PlacedPrefab, lx: number, lz: number, label: string) => {
      const w = rotateXZ(lx, lz, h.rotationY);
      const tx = h.x + w.x, tz = h.z + w.z;
      let d = Infinity;
      for (let i = 0; i < 360 && d > 0.3; i++) {
        const dx = tx - body.state.position.x, dz = tz - body.state.position.z;
        d = Math.hypot(dx, dz);
        body.step({ ...emptyInput(++seq), moveX: dx / Math.max(d, 1), moveZ: dz / Math.max(d, 1), buttons: d > 1.5 ? Buttons.SPRINT : 0 }, SIMULATION.fixedDt);
        physics.step();
      }
      expect(d, label).toBeLessThan(0.6);
    };
    const tested = new Set<string>();
    for (const h of layout.houses) {
      const v = variantOf(h);
      if (tested.has(v)) continue;
      tested.add(v);
      const size = v in EXTRA_SIZE ? EXTRA_SIZE[v as keyof typeof EXTRA_SIZE] : SMALL_HOUSE_SIZE[v as keyof typeof SMALL_HOUSE_SIZE];
      const hd = size.d / 2;
      const start = rotateXZ(size.door, hd + 1.6, h.rotationY);
      const body = new CharacterBody(physics, v, v, { x: h.x + start.x, y: h.y + 0.1, z: h.z + start.z });
      const spots = v in EXTRA_SIZE ? extraChestSpots(v as keyof typeof EXTRA_SIZE) : [{ ...smallHouseChestSpot(v as keyof typeof SMALL_HOUSE_SIZE), y: 0 }];
      const ground = spots.filter((s) => s.y === 0);
      for (const c of ground) {
        walk(body, h, size.door, hd + 1.4, `${v}: delante de la puerta`);
        walk(body, h, size.door, hd - 1.0, `${v}: dentro por la puerta`);
        walk(body, h, 0, 0.3, `${v}: centro`);
        const turned = Math.abs(Math.sin(c.yaw)) > 0.5;
        walk(body, h, c.x + (turned ? 0.85 : 0), c.z + (turned ? 0 : 0.85), `${v}: junto al cofre`);
        expect(body.state.position.y - h.y, `${v}: a ras de suelo`).toBeLessThan(0.3);
      }
      if (v === 'balcony') {
        walk(body, h, 0, 0.3, 'balcón: centro');
        walk(body, h, -1.95, 2.1, 'balcón: pie de la escalera');
        walk(body, h, -1.95, -2.0, 'balcón: arriba de la escalera');
        expect(body.state.position.y - h.y).toBeGreaterThan(2.6);
        walk(body, h, -1.0, -1.9, 'balcón: rellano');
        walk(body, h, -1.0, 0.0, 'balcón: planta alta');
        walk(body, h, 2.1, -1.2, 'balcón: cofre de arriba');
        walk(body, h, 0, 1.6, 'balcón: puerta del balcón');
        walk(body, h, 0, 3.5, 'balcón: sobre el balcón');
        expect(body.state.position.y - h.y).toBeGreaterThan(2.6);
      }
      if (v === 'modern') {
        walk(body, h, 0, 0.3, 'moderna: centro');
        walk(body, h, size.door, hd - 1.0, 'moderna: puerta por dentro');
        walk(body, h, size.door, hd + 1.4, 'moderna: delante');
        walk(body, h, 3.9, hd + 1.0, 'moderna: pie de la escalera exterior');
        walk(body, h, 3.8, -2.3, 'moderna: rellano');
        walk(body, h, 2.3, -2.3, 'moderna: azotea');
        walk(body, h, -2.0, -1.05, 'moderna: cofre de la azotea');
        expect(body.state.position.y - h.y).toBeGreaterThan(2.9);
      }
      if (v === 'ruin') {
        walk(body, h, 1.2, 2.3, 'abandonado: pie de la losa caída');
        walk(body, h, 1.2, -1.6, 'abandonado: media cubierta');
        expect(body.state.position.y - h.y).toBeGreaterThan(2.8);
      }
      body.dispose();
    }
    expect(tested.size).toBeGreaterThanOrEqual(5);
  });
});
