import { describe, expect, it, vi } from 'vitest';
import { BatchedMesh, MeshBasicMaterial, Scene } from 'three';
import { Engine } from '@/engine/Engine';
import { AdaptiveResolution } from '@/engine/AdaptiveResolution';
import { ReplicatedMatch, isValidPickup } from '@/net/MatchView';
import { createInventory, isValidInventory } from '@shared/inventory';
import { MatchState } from '@shared/match/MatchState';
import { PhysicsWorld, loadRapier } from '@/physics/PhysicsWorld';

describe('regresiones de auditoría integral', () => {
  it.each(['toString', '__proto__', 'constructor'])('rechaza objetos heredados %s', (kind) => {
    const inv = createInventory();
    inv.slots[1] = { kind, qty: 1 } as never;
    expect(isValidInventory(inv)).toBe(false);
  });
  it('rechaza cantidades fuera de límites y rarezas desconocidas', () => {
    const inv = createInventory();
    inv.ammo.ammo_light = 361;
    expect(isValidInventory(inv)).toBe(false);
    inv.ammo.ammo_light = 0;
    inv.slots[1] = { kind: 'pistol', qty: 2 };
    expect(isValidInventory(inv)).toBe(false);
    inv.slots[1] = { kind: 'pistol', qty: 1, rarity: 'malicious' } as never;
    expect(isValidInventory(inv)).toBe(false);
  });
  it('rechaza pickups con identificador, cantidad o rareza malformados', () => {
    const pickup = { id: 1, x: 0, y: 0, z: 0, item: { kind: 'pistol', qty: 1 } };
    expect(isValidPickup(pickup)).toBe(true);
    expect(isValidPickup({ ...pickup, id: -1 })).toBe(false);
    expect(isValidPickup({ ...pickup, item: { kind: 'pistol', qty: 2 } })).toBe(false);
    expect(isValidPickup({ ...pickup, item: { kind: 'pistol', qty: 1, rarity: 'constructor' } })).toBe(false);
  });
  it('una bienvenida inválida no conserva el inventario de una sesión anterior', () => {
    const replica = new ReplicatedMatch([]);
    replica.load({ opened: [], pickups: [] }, createInventory());
    replica.load(undefined, undefined);
    expect(replica.inventory).toBeNull();
  });
  it('dar de alta dos veces no elimina objetos existentes', () => {
    const match = new MatchState([], 1);
    const inv = match.addPlayer('a');
    inv.ammo.ammo_light = 12;
    expect(match.addPlayer('a')).toBe(inv);
    expect(match.totals().ammo_light).toBe(12);
  });
  it('una pared cercana al objetivo bloquea la visión sin ocultar el propio cofre', async () => {
    const physics = new PhysicsWorld(await loadRapier());
    const spec = { kind: 'box' as const, center: { x: 0, y: 1, z: 2 }, halfExtents: { x: 0.3, y: 0.3, z: 0.3 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, layer: 'structure' as const };
    try {
      physics.addStatic({ ...spec, interactionTarget: true });
      physics.step();
      expect(physics.lineOfSight({ x: 0, y: 1, z: 0 }, spec.center)).toBe(true);
      physics.addStatic({ ...spec, center: { x: 0, y: 1, z: 1.6 }, halfExtents: { x: 1, y: 1, z: 0.05 } });
      physics.step();
      expect(physics.lineOfSight({ x: 0, y: 1, z: 0 }, spec.center)).toBe(false);
    } finally { physics.dispose(); }
  });
  it('reiniciar la resolución permite detectar otra frecuencia de pantalla', () => {
    const adaptive = new AdaptiveResolution({ min: 0.5, max: 1, window: 0.5 });
    for (let i = 0; i < 100; i++) adaptive.update(1 / 120);
    expect(adaptive.refreshHz).toBe(120);
    adaptive.reset();
    for (let i = 0; i < 60; i++) adaptive.update(1 / 30);
    expect(adaptive.refreshHz).toBe(30);
  });
  it('la limpieza del motor libera las texturas internas de BatchedMesh', () => {
    const scene = new Scene();
    const batch = new BatchedMesh(2, 100, 100, new MeshBasicMaterial());
    scene.add(batch);
    const dispose = vi.spyOn(batch, 'dispose');
    const noop = () => undefined;
    const engine = { stop: noop, resizeObserver: { disconnect: noop }, contextMonitor: { dispose: noop }, timer: { dispose: noop }, handleVisibility: noop, scene, renderer: { dispose: noop } };
    vi.stubGlobal('document', { removeEventListener: noop });
    try { Engine.prototype.dispose.call(engine as unknown as Engine); expect(dispose).toHaveBeenCalledOnce(); }
    finally { vi.unstubAllGlobals(); }
  });
});
