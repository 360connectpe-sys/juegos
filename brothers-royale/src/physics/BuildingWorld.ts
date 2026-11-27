import type RAPIER from '@dimforge/rapier3d-compat';
import { BuildingState, BUILD, validBuildRequest, buildPrefab, type BuildingSnapshot } from '@shared/building/BuildingState';
import { prefabColliders, treeCollider } from '@shared/world/colliders';
import type { WorldLayout } from '@shared/world/layout';
import { terrainHeight } from '@shared/world/terrain';
import type { Vec3 } from '@shared/types';
import { placePart } from '@shared/world/prefab';
import { PhysicsWorld } from './PhysicsWorld';
import { CAMERA_QUERY_GROUPS } from './groups';

/** Adaptador de colisiones reutilizado por autoridad offline, servidor y réplica cliente. */
export class BuildingWorld {
  readonly state: BuildingState;
  private readonly trees = new Map<number, RAPIER.Collider>();
  private readonly pieces = new Map<number, RAPIER.Collider[]>();
  private collidersChanged = false;
  private readonly handles = new Map<number, { tree?: number; piece?: number }>();
  constructor(readonly physics: PhysicsWorld, readonly layout: WorldLayout, players: () => readonly Vec3[]) {
    this.state = new BuildingState(layout.trees.length, layout.terrain.size, {
      ground: (x, z) => terrainHeight(x, z, layout.terrain),
      clear: (r, feet) => {
        if (!physics.lineOfSight({ ...feet, y: feet.y + 1.4 }, { x: r.x, y: r.y + 1, z: r.z })) return false;
        const R = physics.R;
        for (const spec of prefabColliders(buildPrefab(r), 'build')) {
          if (spec.kind !== 'box') continue;
          const h = spec.halfExtents;
          // Separación numérica para permitir piezas adyacentes sin solaparlas.
          const shape = new R.Cuboid(Math.max(0.01, h.x - 0.015), Math.max(0.01, h.y - 0.015), Math.max(0.01, h.z - 0.015));
          if (physics.world.intersectionWithShape(spec.center, spec.rotation, shape, undefined, CAMERA_QUERY_GROUPS)) return false;
        }
        // Cápsulas de todos los jugadores, incluidas las plazas reservadas.
        for (const feet of players()) for (const part of buildPrefab(r).def.parts) {
          if (part.kind !== 'box') continue;
          const placed = placePart(buildPrefab(r), part);
          const rotation = placed.rotation;
          const shape = new R.Cuboid(part.size.x / 2 + 0.35, part.size.y / 2 + 0.35, part.size.z / 2 + 0.35);
          // Muestrea toda la altura de la cápsula para paredes, suelos y rampas.
          for (const dy of [0.1, 0.7, 1.3, 1.7]) if (shape.containsPoint(placed.center, rotation, { x: feet.x, y: feet.y + dy, z: feet.z })) return false;
        }
        return true;
      },
      changed: () => this.sync(),
    });
    this.sync();
  }
  reset(): void {
    this.load({ revision: this.state.revision + 1, trees: this.layout.trees.map(() => BUILD.treeHp), pieces: [], wood: {} });
  }
  load(snapshot: BuildingSnapshot): boolean {
    if (!snapshot || !Number.isSafeInteger(snapshot.revision) || !Array.isArray(snapshot.trees) || snapshot.trees.length !== this.layout.trees.length ||
      !snapshot.trees.every(hp => Number.isFinite(hp) && hp >= 0 && hp <= BUILD.treeHp) ||
      !Array.isArray(snapshot.pieces) || snapshot.pieces.length > BUILD.maxPieces ||
      !snapshot.pieces.every(p => validBuildRequest(p) && Number.isSafeInteger(p.id) && p.id > 0 && typeof p.owner === 'string' && Number.isFinite(p.hp) && p.hp > 0 && p.hp <= BUILD.hp) ||
      !snapshot.wood || typeof snapshot.wood !== 'object' || Object.values(snapshot.wood).some(n => !Number.isInteger(n) || n < 0 || n > BUILD.woodCap)) return false;
    const incoming = new Map(snapshot.pieces.map(p => [p.id, p]));
    for (const [id, colliders] of this.pieces) {
      const old = this.state.pieces.get(id), next = incoming.get(id);
      if (!next || !old || ['kind', 'x', 'y', 'z', 'rotation'].some(key => old[key as keyof typeof old] !== next[key as keyof typeof next])) {
        for (const c of colliders) { this.handles.delete(c.handle); this.physics.removeStatic(c); this.collidersChanged = true; }
        this.pieces.delete(id);
      }
    }
    this.state.load(snapshot); return true;
  }
  private sync(): void {
    for (let i = 0; i < this.state.trees.length; i++) {
      const collider = this.trees.get(i);
      if (this.state.trees[i]! > 0 && !collider) {
        const c = this.physics.addStatic(treeCollider(this.layout.trees[i]!));
        this.collidersChanged = true; this.trees.set(i, c); this.handles.set(c.handle, { tree: i });
      } else if (this.state.trees[i] === 0 && collider) {
        this.handles.delete(collider.handle); this.physics.removeStatic(collider); this.collidersChanged = true; this.trees.delete(i);
      }
    }
    for (const [id, colliders] of this.pieces) if (!this.state.pieces.has(id)) {
      for (const c of colliders) { this.handles.delete(c.handle); this.physics.removeStatic(c); this.collidersChanged = true; }
      this.pieces.delete(id);
    }
    for (const p of this.state.pieces.values()) if (!this.pieces.has(p.id)) {
      const colliders = prefabColliders(buildPrefab(p), 'build').map(spec => this.physics.addStatic(spec));
      this.collidersChanged = true; this.pieces.set(p.id, colliders);
      for (const c of colliders) this.handles.set(c.handle, { piece: p.id });
    }
    this.physics.world.propagateModifiedBodyPositionsToColliders();
    if (this.collidersChanged) {
      // Rapier 0.21 actualiza el broad-phase en step. Solo hay cuerpos cinemáticos:
      // esto publica colliders nuevos sin avanzar el motor ni el tick de juego.
      this.physics.step();
      this.collidersChanged = false;
    }
  }
  damageRay(by: string, origin: Vec3, dir: Vec3, range: number, damage: number, axe: boolean): boolean {
    const hit = this.physics.world.castRay(new this.physics.R.Ray(origin, dir), range + 0.02, true, undefined, CAMERA_QUERY_GROUPS);
    if (!hit) return false;
    const target = this.handles.get(hit.collider.handle);
    if (target?.tree !== undefined) return this.state.hitTree(by, target.tree, damage, axe);
    if (target?.piece !== undefined) return this.state.hitPiece(target.piece, damage);
    return false;
  }
  dispose(): void {
    for (const c of this.trees.values()) this.physics.removeStatic(c);
    for (const list of this.pieces.values()) for (const c of list) this.physics.removeStatic(c);
    this.trees.clear(); this.pieces.clear(); this.handles.clear();
  }
}
