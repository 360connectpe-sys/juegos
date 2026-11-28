/** Fase 12 — avión de transporte, caída libre, paracaídas y reaparición desde el avión (autoridad del servidor). */
import { describe, expect, it } from 'vitest';
import { ServerWorld } from '../server/ServerWorld';
import { FLIGHT, mapCircle, planeAt, respawnRoute, startRoute } from '@shared/battle/flight';
import { validRound } from '@shared/battle/validation';
import { contains, zoneAt, zonePlan, ZONE_PHASES } from '@shared/battle/zone';
import { PROTOCOL_VERSION } from '@shared/protocol';
import { Buttons, emptyInput } from '@shared/types';
import { addItem } from '@shared/inventory';
import { rotateXZ } from '@shared/math';
import type { BoxPart } from '@shared/world/prefab';

async function world(n: number) {
  const w = await ServerWorld.create(undefined, 7);
  const ids = Array.from({ length: n }, (_, i) => w.addPlayer(`p${i}`, `P${i}`).id);
  const seq = new Map(ids.map((id) => [id, 0]));
  /** Un tick con la entrada dada para cada jugador (por defecto, neutra). */
  const tick = (inputs: Record<string, Partial<ReturnType<typeof emptyInput>>> = {}) => {
    for (const id of ids) { const s = seq.get(id)! + 1; seq.set(id, s); w.queueInput(id, { ...emptyInput(s), ...inputs[id] }); }
    w.step();
  };
  return { w, ids, tick };
}

describe('fase 12: rutas del avión (puras)', () => {
  it('la ruta inicial cruza el mapa y el salto automático cae dentro; es reproducible por semilla', () => {
    for (let seed = 1; seed < 40; seed++) {
      const r = startRoute(120, seed);
      expect(r).toEqual(startRoute(120, seed));
      expect(Math.hypot(r.ax, r.az)).toBeGreaterThan(60); // empieza fuera del mapa
      expect(contains(mapCircle(120), { x: r.bx, z: r.bz })).toBe(true);
      expect(r.y).toBe(FLIGHT.altitude);
    }
    expect(startRoute(120, 1)).not.toEqual(startRoute(120, 2));
  });
  it('la ruta de reaparición termina DENTRO de la zona actual y se acorta en las zonas finales', () => {
    const plan = zonePlan(120, 3);
    for (const { start, close } of ZONE_PHASES) {
      const zone = zoneAt(plan, start + close + 1).current;
      for (let id = 1; id < 20; id++) {
        const r = respawnRoute(zone, 120, 3, id, 100);
        expect(contains(zone, { x: r.bx, z: r.bz }, 0) || zone.radius < 0.5).toBe(true);
        expect(r.duration).toBeLessThanOrEqual(FLIGHT.maxRouteSeconds + 0.01);
      }
    }
    const small = respawnRoute({ x: 0, z: 0, radius: 5 }, 120, 3, 1, 0), big = respawnRoute({ x: 0, z: 0, radius: 85 }, 120, 3, 1, 0);
    expect(small.duration).toBeLessThan(big.duration);
    expect(planeAt(small, small.start + small.duration).progress).toBe(1);
  });
});

describe('fase 12: transporte autoritativo con 8 jugadores', () => {
  it('todos empiezan en el avión: sin daño, sin disparar, construir ni abrir cofres; protocolo v10', async () => {
    const { w, ids, tick } = await world(8);
    try {
      expect(PROTOCOL_VERSION).toBe(10);
      w.round.start();
      tick();
      const snap = w.round.snapshot();
      expect(validRound(snap)).toBe(true);
      expect(snap.planes).toHaveLength(1);
      for (const id of ids) {
        expect(w.round.airMode(id)).toBe(1);
        expect(w.players.get(id)!.body.state.position.y).toBeCloseTo(FLIGHT.altitude, 3);
        expect(w.canBuild(id)).toBe(false);
      }
      w.combat.environmentalDamage('p0', 50, w.players.get('p0')!.body.state.position, w.tick);
      expect(w.combat.hp('p0')).toBe(100);
      // Arma en mano + disparo: nada ocurre en el aire.
      w.match.setInventory('p1', addItem(w.match.inventory('p1')!, { kind: 'rifle', qty: 1, rarity: 'rare' }).inventory);
      w.match.setInventory('p1', addItem(w.match.inventory('p1')!, { kind: 'ammo_medium', qty: 60 }).inventory);
      w.selectSlot('p1', 1);
      for (let t = 0; t < 40; t++) tick({ p1: { buttons: Buttons.FIRE } });
      expect(w.combat.log.of('p1').shots).toBe(0);
      // El avión se mueve y lleva a los pasajeros con él.
      const before = { ...w.players.get('p2')!.body.state.position };
      for (let t = 0; t < 30; t++) tick();
      const after = w.players.get('p2')!.body.state.position;
      expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(FLIGHT.speed * 0.8);
    } finally { w.dispose(); }
  });

  it('cada uno salta cuando quiere, dirige la caída, abre el paracaídas y aterriza con protección; el resto salta solo al final', async () => {
    const { w, ids, tick } = await world(8);
    try {
      w.round.start();
      const route = w.round.snapshot().planes[0]!;
      const landed = new Map<string, { x: number; z: number; t: number }>();
      const sawChute = new Set<string>(), sawFall = new Set<string>();
      for (let t = 0; t < 30 * 40 && landed.size < 8; t++) {
        const inputs: Record<string, Partial<ReturnType<typeof emptyInput>>> = {};
        ids.forEach((id, i) => {
          // p0..p5 saltan escalonados; p6 y p7 nunca pulsan (salto automático). p0 se dirige hacia +X.
          if (i < 6 && t === 45 + i * 25) inputs[id] = { buttons: Buttons.JUMP };
          if (id === 'p0' && w.round.airMode(id) >= 2) inputs[id] = { moveX: 1, moveZ: 0 };
        });
        tick(inputs);
        for (const id of ids) {
          const m = w.round.airMode(id);
          if (m === 2) sawFall.add(id);
          if (m === 3) sawChute.add(id);
          if (m === 0 && !landed.has(id) && w.players.get(id)!.body.state.grounded) {
            const p = w.players.get(id)!.body.state.position;
            landed.set(id, { x: p.x, z: p.z, t });
            expect(w.combat.vitals(id)?.descending).toBe(false);
            expect(w.combat.vitals(id)?.protection).toBe(3);
            expect(w.canBuild(id)).toBe(true);
          }
        }
      }
      expect(landed.size).toBe(8);
      expect(sawFall.size).toBe(8); expect(sawChute.size).toBe(8);
      // Salto automático: los dos que no pulsaron caen tras terminar la ruta.
      expect(landed.get('p6')!.t).toBeGreaterThan(route.duration * 30 * 0.9);
      // Aterrizajes distintos (saltos escalonados) y dentro del mapa.
      const spots = [...landed.values()];
      for (const s of spots) expect(contains(mapCircle(120), s, -0.5)).toBe(true);
      expect(new Set(spots.slice(0, 6).map((s) => `${Math.round(s.x)}:${Math.round(s.z)}`)).size).toBeGreaterThan(3);
      // p0 se dirigió hacia +X respecto a p1 (que saltó casi a la vez).
      const dirX = Math.cos(Math.atan2(route.bz - route.az, route.bx - route.ax));
      expect(landed.get('p0')!.x - landed.get('p1')!.x + dirX * FLIGHT.speed * (25 / 30)).toBeGreaterThan(3);
      expect(w.round.snapshot().planes.length).toBeLessThanOrEqual(1);
    } finally { w.dispose(); }
  });

  it('abrir el paracaídas antes (saltar de nuevo) frena la caída; correr hace picado', async () => {
    const { w, tick } = await world(2);
    try {
      w.round.start();
      tick({ p0: { buttons: Buttons.JUMP }, p1: { buttons: Buttons.JUMP } });
      tick();
      for (let t = 0; t < 15; t++) tick({ p0: { buttons: Buttons.SPRINT } });
      const y0 = w.players.get('p0')!.body.state.position.y, y1 = w.players.get('p1')!.body.state.position.y;
      expect(y0).toBeLessThan(y1 - 2); // picado
      tick({ p1: { buttons: Buttons.JUMP } });
      expect(w.round.airMode('p1')).toBe(3);
      const before = w.players.get('p1')!.body.state.position.y;
      for (let t = 0; t < 30; t++) tick();
      expect(before - w.players.get('p1')!.body.state.position.y).toBeLessThan(FLIGHT.chuteSpeed + 0.5);
    } finally { w.dispose(); }
  });

  it('se aterriza sobre tejados y azoteas de los edificios (no se atraviesan)', async () => {
    const { w, tick } = await world(1);
    try {
      w.round.start(); tick({ p0: { buttons: Buttons.JUMP } }); tick();
      const seen = new Set<string>();
      for (const s of w.layout.structures) {
        if (seen.has(s.def.id) || s.def.id === 'chest') continue;
        const roof = s.def.parts.find((p): p is BoxPart => p.kind === 'box' && p.layer === 'roof' && p.collide && p.size.x * p.size.z > 4);
        if (!roof) continue;
        seen.add(s.def.id);
        // Caída libre colocada sobre el tejado (la ronda sigue mandando: modo paracaídas).
        const c = rotateXZ(roof.center.x, roof.center.z, s.rotationY);
        const p = w.players.get('p0')!;
        if (w.round.airMode('p0') === 0) { w.combat.beginDescent('p0'); (w.round as unknown as { air: Map<string, unknown> }).air.set('p0', { mode: 3, plane: 0, bound: 'map', jumpY: 80 }); }
        p.body.teleport({ x: s.x + c.x, y: s.y + 20, z: s.z + c.z });
        for (let t = 0; t < 30 * 8 && w.round.airMode('p0') !== 0; t++) tick();
        expect(w.round.airMode('p0'), s.def.id).toBe(0);
        expect(p.body.state.position.y - s.y, s.def.id).toBeGreaterThan(roof.center.y - 0.5);
      }
      expect(seen.size).toBeGreaterThanOrEqual(6);
    } finally { w.dispose(); }
  });

  it('al perder una vida se vuelve en un avión propio hacia la zona segura, sin tocar los aviones de los demás', async () => {
    const { w, ids, tick } = await world(3);
    try {
      w.round.start();
      for (let t = 0; t < 30 * 40 && ids.some((id) => w.round.airMode(id) !== 0); t++) tick();
      expect(ids.every((id) => w.round.airMode(id) === 0)).toBe(true);
      for (let t = 0; t < 100; t++) tick(); // fin de la protección
      w.round.elapsed = 500; // fase 3: zona de 40 m
      w.combat.environmentalDamage('p1', 100, w.players.get('p1')!.body.state.position, w.tick);
      expect(w.combat.lives('p1')).toBe(2);
      for (let t = 0; t < 151; t++) tick();
      expect(w.combat.isDead('p1')).toBe(false);
      expect(w.round.airMode('p1')).toBe(1);
      expect(w.round.airMode('p0')).toBe(0);
      const snap = w.round.snapshot();
      expect(snap.planes).toHaveLength(1);
      expect(validRound(snap)).toBe(true);
      const zone = w.round.zone.current;
      expect(contains(zone, { x: snap.planes[0]!.bx, z: snap.planes[0]!.bz })).toBe(true);
      // Un segundo jugador muere: avión distinto, el primero no se reinicia.
      w.combat.environmentalDamage('p2', 100, w.players.get('p2')!.body.state.position, w.tick);
      for (let t = 0; t < 151; t++) tick();
      const two = w.round.snapshot().planes;
      expect(two).toHaveLength(2); expect(two[0]).toEqual(snap.planes[0]);
      // Ninguno pulsa: salto automático y aterrizaje DENTRO de la zona, sin daño mientras siguen dentro de su avión.
      w.combat.environmentalDamage('p1', 30, w.players.get('p1')!.body.state.position, w.tick);
      expect(w.combat.hp('p1')).toBe(100);
      for (let t = 0; t < 30 * 30 && (w.round.airMode('p1') !== 0 || w.round.airMode('p2') !== 0); t++) tick();
      for (const id of ['p1', 'p2']) {
        expect(w.round.airMode(id)).toBe(0);
        expect(contains(w.round.zone.current, w.players.get(id)!.body.state.position)).toBe(true);
      }
      expect(w.combat.lives('p1')).toBe(2);
    } finally { w.dispose(); }
  });
});
