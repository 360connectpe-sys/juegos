import { describe, expect, it } from 'vitest';
import { BuildingState, BUILD, BUILD_KINDS, validBuildRequest, type BuildRequest } from '@shared/building/BuildingState';
import { BuildingWorld } from '@/physics/BuildingWorld';
import { PhysicsWorld, loadRapier } from '@/physics/PhysicsWorld';
import { generateWorldLayout } from '@shared/world/layout';
import { CharacterBody } from '@/physics/CharacterBody';
import { rotateXZ } from '@shared/math';
import { OfflineSession } from '@/net/OfflineSession';
import { ServerWorld } from '../server/ServerWorld';
import { Buttons, emptyInput } from '@shared/types';
const feet = { x: 0, y: 0, z: 5 };
const wall: BuildRequest = { kind: 'wall', x: 0, y: 0, z: 0, rotation: 0 };
function pure() {
  const state = new BuildingState(1, 120, { ground: () => 0, clear: () => true, changed: () => undefined });
  state.addPlayer('a'); state.wood.set('a', 100);
  return state;
}
describe('madera y construcciones autoritativas', () => {
  it('cobra diez, no conserva campos extra ni permite editar o repetir', () => {
    const state = pure();
    expect(state.place('a', { ...wall, owner: 'b', id: 900, command: 'edit' }, feet)).toBe(true);
    expect(state.wood.get('a')).toBe(90);
    expect(state.pieces.get(1)).toMatchObject({ owner: 'a', hp: BUILD.hp });
    expect(state.pieces.get(1)).not.toHaveProperty('command');
    expect(state.place('a', wall, feet)).toBe(false);
    expect(state.wood.get('a')).toBe(90);
  });
  it.each([null, {}, { ...wall, x: NaN }, { ...wall, rotation: 4 }, { ...wall, x: 0.2 }, { ...wall, kind: 'stone' }])('rechaza solicitudes malformadas %j', request => {
    expect(validBuildRequest(request)).toBe(false);
    expect(pure().place('a', request, feet)).toBe(false);
  });
  it('rechaza distancia, mapa, altura, falta de soporte y material', () => {
    const state = pure();
    for (const r of [{ ...wall, x: 60 }, { ...wall, y: 30 }, { ...wall, y: 0.2 }, { ...wall, x: 12 }]) expect(state.place('a', r, feet)).toBe(false);
    state.wood.set('a', 9); expect(state.place('a', wall, feet)).toBe(false);
  });
  it('la destrucción del soporte elimina la cadena elevada', () => {
    const s = pure();
    expect(s.place('a', wall, feet)).toBe(true);
    expect(s.place('a', { ...wall, kind: 'floor', y: 3 }, { x: 0, y: 1, z: 5 })).toBe(true);
    expect(s.place('a', { ...wall, y: 3.18 }, { x: 0, y: 2, z: 5 })).toBe(true);
    s.hitPiece(1, 150);
    expect(s.pieces.size).toBe(0);
    expect(s.wood.get('a')).toBe(70);
  });
  it('golpes simultáneos no duplican madera ni reviven árboles', () => {
    const s = pure();s.wood.set('a', 0);s.addPlayer('b');
    for (let i = 0; i < 20; i++) s.hitTree(i % 2 ? 'a' : 'b', 0, 15, true);
    expect(s.trees[0]).toBe(0);
    expect(s.wood.get('a')! + s.wood.get('b')!).toBe(30);
    expect(s.hitTree('a', 0, 15, true)).toBe(false);
  });
  it('las balas dañan pero no conceden madera', () => {
    const s = pure();s.wood.set('a', 0);s.hitTree('a', 0, 90, false);expect(s.wood.get('a')).toBe(0);
  });
  it('limita piezas por jugador y por sala', () => {
    const s = pure();
    for (let user = 0; user < 5; user++) {
      const id = 'p' + user;s.addPlayer(id);s.wood.set(id, 999);
      for (let i = 0; i < 32; i++) {
        const r = { ...wall, x: (i % 8 - 4) * 3, z: (Math.floor(i / 8) + user * 4 - 9) * 3 };
        const ok = s.place(id, r, { x: r.x, y: 0, z: r.z + 4 });
        expect(ok).toBe(user < 4);
      }
    }
    expect(s.pieces.size).toBe(128);
  });
});
describe('colisiones de construcción reales', () => {
  it.each(BUILD_KINDS)('coloca %s y bloquea superposiciones con Rapier', async kind => {
    const physics = new PhysicsWorld(await loadRapier());
    const layout = { ...generateWorldLayout(), trees: [], structures: [] };
    physics.addTerrain(layout.terrain);physics.step();
    const world = new BuildingWorld(physics, layout, () => []);
    try {
      world.state.addPlayer('a');world.state.wood.set('a', 100);
      const r = { kind, x: 0, y: 0, z: 12, rotation: 0 };
      expect(world.state.place('a', r, { x: 0, y: 0, z: 17 })).toBe(true);
      physics.step();
      // Fase 15: la misma pieza otra vez se rechaza; una pared también desde la casilla vecina
      // (el borde compartido es una sola pared).
      expect(world.state.place('a', { ...r }, { x: 0, y: 0, z: 17 })).toBe(false);
      if (kind === 'wall') expect(world.state.place('a', { ...r, z: 15, rotation: 2 }, { x: 0, y: 0, z: 17 })).toBe(false);
    } finally { world.dispose();physics.dispose(); }
  });
  it('el personaje sube la rampa en las cuatro rotaciones sin atravesarla', async () => {
    for (let rotation = 0; rotation < 4; rotation++) {
      const physics = new PhysicsWorld(await loadRapier());
      const layout = { ...generateWorldLayout(), trees: [], structures: [] };
      physics.addTerrain(layout.terrain);
      const world = new BuildingWorld(physics, layout, () => []);
      let body: CharacterBody | undefined;
      try {
        world.state.addPlayer('a');world.state.wood.set('a', 30);
        const approach = rotateXZ(0, 4, rotation * Math.PI / 2);
        const direction = rotateXZ(0, -1, rotation * Math.PI / 2);
        expect(world.state.place('a', { kind: 'ramp', x: 0, y: 0, z: 12, rotation }, { x: approach.x, y: 0, z: 12 + approach.z })).toBe(true);
        body = new CharacterBody(physics, 'a', 'A', { x: approach.x, y: 0.05, z: 12 + approach.z });
        let highest = 0;
        for (let seq = 1; seq <= 100; seq++) {
          body.step({ ...emptyInput(seq), moveX: direction.x, moveZ: direction.z }, 1 / 30);
          physics.step();highest = Math.max(highest, body.state.position.y);
        }
        expect(highest, JSON.stringify({ rotation, position: body.state.position })).toBeGreaterThan(2.5);
      } finally { body?.dispose();world.dispose();physics.dispose(); }
    }
  });

  it('rechaza sobre jugadores y detrás de paredes', async () => {
    const physics = new PhysicsWorld(await loadRapier());
    const layout = { ...generateWorldLayout(), trees: [], structures: [] };
    physics.addTerrain(layout.terrain);physics.step();
    const occupants = [{ x: 0, y: 0, z: 13.5 }]; // fase 15: la pared va en el borde (z = 13,5)
    const world = new BuildingWorld(physics, layout, () => occupants);
    try {
      world.state.addPlayer('a');world.state.wood.set('a', 100);
      const r = { ...wall, z: 12 };
      expect(world.state.place('a', r, { x: 0, y: 0, z: 17 })).toBe(false);
      occupants.length = 0;
      physics.addStatic({ kind: 'box', center: { x: 0, y: 1.5, z: 15 }, halfExtents: { x: 3, y: 1.5, z: 0.1 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, layer: 'structure' });
      physics.step();
      expect(world.state.place('a', r, { x: 0, y: 0, z: 17 })).toBe(false);
    } finally { world.dispose();physics.dispose(); }
  });
  it('recupera colliders y árboles al cargar otra sala con ids reutilizados', async () => {
    const physics = new PhysicsWorld(await loadRapier());
    const layout = { ...generateWorldLayout(), trees: [], structures: [] };
    physics.addTerrain(layout.terrain);physics.step();
    const world = new BuildingWorld(physics, layout, () => []);
    try {
      world.state.addPlayer('a');world.state.wood.set('a', 100);
      expect(world.state.place('a', { ...wall, z: 12 }, { x: 0, y: 0, z: 17 })).toBe(true);
      physics.step();
      const snap = world.state.snapshot();
      expect(world.load({ ...snap, pieces: snap.pieces.map(p => ({ ...p, x: 6 })) })).toBe(true);
      expect(physics.castStatic({ x: 0, y: 1.5, z: 10 }, { x: 0, y: 0, z: 1 }, 4)).toBeNull();
      expect(physics.castStatic({ x: 6, y: 1.5, z: 10 }, { x: 0, y: 0, z: 1 }, 4)).not.toBeNull();
      expect(world.load({ ...snap, pieces: [{ ...snap.pieces[0]!, x: NaN }] })).toBe(false);
    } finally { world.dispose();physics.dispose(); }
  });

  it('una sesión offline nueva restaura árboles, colisiones y materiales', async () => {
    const physics = new PhysicsWorld(await loadRapier());
    const layout = generateWorldLayout();
    physics.addTerrain(layout.terrain);
    const world = new BuildingWorld(physics, layout, () => []);
    let offline: OfflineSession | undefined;
    try {
      world.state.addPlayer('anterior');
      world.state.hitTree('anterior', 0, 90, true);
      expect(world.state.place('anterior', { ...wall, z: 12 }, { x: 0, y: 0, z: 17 })).toBe(true);
      offline = new OfflineSession(physics, { x: 0, y: 0.05, z: 17 }, 'Jugador', [], 1, [], world);
      expect(world.state.trees[0]).toBe(90);
      expect(world.state.pieces.size).toBe(0);
      expect([...world.state.wood]).toEqual([['local', 0]]);
      expect(physics.castStatic({ x: 0, y: 1.5, z: 10 }, { x: 0, y: 0, z: 1 }, 4)).toBeNull();
      const t = layout.trees[0]!;
      expect(physics.castStatic({ x: t.x, y: t.y + 1, z: t.z + 2 }, { x: 0, y: 0, z: -1 }, 3)).not.toBeNull();
    } finally { offline?.dispose(); world.dispose(); physics.dispose(); }
  });

  it('las paredes construidas bloquean daño hasta romperse y el hacha también las destruye', async () => {
    const world = await ServerWorld.create();
    try {
      const a = world.addPlayer('a', 'A'), b = world.addPlayer('b', 'B');
      a.body.teleport({ x: 0, y: 0.05, z: 17 });b.body.teleport({ x: 0, y: 0.05, z: 7 });
      world.building.state.wood.set('a', 30);
      expect(world.building.state.place('a', { ...wall, z: 12 }, a.body.state.position)).toBe(true);
      world.giveBenchLoadout('a', 0);
      const run = (start: number, ticks: number) => {
        for (let seq = start; seq < start + ticks; seq++) {
          world.queueInput('a', { ...emptyInput(seq), buttons: Buttons.FIRE | Buttons.AIM, aimYaw: Math.PI });world.step();
        }
      };
      run(1, 15);
      expect(world.building.state.pieces.size).toBe(1);
      expect(world.combat.hp('b')).toBe(100);
      run(16, 110);
      expect(world.building.state.pieces.size).toBe(0);
      expect(world.combat.hp('b')).toBeLessThan(100);
      expect(world.building.state.place('a', { ...wall, z: 12 }, a.body.state.position)).toBe(true);
      for (let hit = 0; hit < 10; hit++) expect(world.building.damageRay('a', { x: 0, y: 1.4, z: 14.5 }, { x: 0, y: 0, z: -1 }, 1.9, 15, true)).toBe(true);
      expect(world.building.state.pieces.size).toBe(0);
      expect(world.building.state.wood.get('a')).toBe(10);
    } finally { world.dispose(); }
  });

  it('el hacha real recolecta, quita el collider y limita la cadencia', async () => {
    const world = await ServerWorld.create();
    try {
      const p = world.addPlayer('a', 'A');
      const tree = world.layout.trees[0]!;
      p.body.teleport({ x: tree.x, y: tree.y, z: tree.z + 1 });
      for (let i = 1; i <= 150; i++) { world.queueInput(p.id, { ...emptyInput(i), buttons: Buttons.FIRE, aimYaw: Math.PI });world.step(); }
      expect(world.building.state.trees[0]).toBe(0);
      expect(world.building.state.wood.get(p.id)).toBe(30);
      const before = world.building.state.wood.get(p.id);
      for (let i = 151; i <= 180; i++) {world.queueInput(p.id, { ...emptyInput(i), buttons: Buttons.FIRE, aimYaw: Math.PI });world.step();}
      expect(world.building.state.wood.get(p.id)).toBe(before);
    } finally { world.dispose(); }
  });
});
