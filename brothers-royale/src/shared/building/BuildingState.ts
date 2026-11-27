import type { Vec3 } from '../types';
import type { PrefabDef, BoxPart, PlacedPrefab } from '../world/prefab';

export const BUILD = { size: 3, cost: 10, hp: 150, treeHp: 90, woodPerHit: 5, woodCap: 999, maxPieces: 128, perPlayer: 32, range: 6, height: 15 } as const;
export const BUILD_KINDS = ['wall', 'floor', 'ramp', 'roof'] as const;
export type BuildKind = typeof BUILD_KINDS[number];
export interface BuildRequest { kind: BuildKind; x: number; y: number; z: number; rotation: number }
export interface BuildPiece extends BuildRequest { id: number; owner: string; hp: number }
export interface BuildingSnapshot { revision: number; trees: number[]; pieces: BuildPiece[]; wood: Record<string, number> }
export interface BuildingEnvironment {
  ground(x: number, z: number): number;
  clear(request: BuildRequest, feet: Vec3): boolean;
  changed(): void;
}
export function validBuildRequest(raw: unknown): raw is BuildRequest {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as BuildRequest;
  return BUILD_KINDS.includes(r.kind) && [r.x, r.y, r.z].every(Number.isFinite)
    && Number.isInteger(r.rotation) && r.rotation >= 0 && r.rotation < 4
    && Math.abs(r.x / 3 - Math.round(r.x / 3)) < 1e-6 && Math.abs(r.z / 3 - Math.round(r.z / 3)) < 1e-6;
}
const part = (center: Vec3, size: Vec3, rot?: Vec3): BoxPart => ({
  kind: 'box', center, size, rot, color: '#a67545', layer: 'base', collide: true, visible: true,
});
export function buildDef(kind: BuildKind): PrefabDef {
  let parts: BoxPart[];
  if (kind === 'wall') parts = [part({ x: 0, y: 1.5, z: 0 }, { x: 3, y: 2.96, z: 0.16 })];
  else if (kind === 'floor') parts = [part({ x: 0, y: 0.1, z: 0 }, { x: 2.96, y: 0.16, z: 2.96 })];
  else if (kind === 'ramp') parts = [part({ x: 0, y: 1.5, z: 0 }, { x: 2.96, y: 0.16, z: Math.sqrt(18) - 0.17 }, { x: Math.PI / 4, y: 0, z: 0 })];
  else parts = [
    part({ x: -0.75, y: 0.45, z: 0 }, { x: 1.74, y: 0.16, z: 2.96 }, { x: 0, y: 0, z: Math.PI / 6 }),
    part({ x: 0.75, y: 0.45, z: 0 }, { x: 1.74, y: 0.16, z: 2.96 }, { x: 0, y: 0, z: -Math.PI / 6 }),
  ];
  return { id: 'build-' + kind, parts, clearRadius: 2.2 };
}
export function buildPrefab(request: BuildRequest): PlacedPrefab {
  return { def: buildDef(request.kind), x: request.x, y: request.y, z: request.z, rotationY: request.rotation * Math.PI / 2 };
}
export const buildTop = (p: BuildRequest): number => p.y + (p.kind === 'wall' || p.kind === 'ramp' ? 3 : p.kind === 'floor' ? 0.18 : 0.96);

/** Autoridad compartida. Las consultas de colisión son inyectadas por el mundo físico. */
export class BuildingState {
  onHarvest: ((id:string,amount:number)=>void)|null=null;
  onBuild: ((id:string)=>void)|null=null;
  readonly pieces = new Map<number, BuildPiece>();
  readonly wood = new Map<string, number>();
  readonly trees: number[];
  revision = 0;
  private nextId = 1;
  private cached: BuildingSnapshot | null = null;
  constructor(treeCount: number, readonly mapSize: number, private readonly env: BuildingEnvironment) {
    this.trees = Array.from({ length: treeCount }, () => BUILD.treeHp);
  }
  addPlayer(id: string): void { if (!this.wood.has(id)) { this.wood.set(id, 0); this.touch(); } }
  removePlayer(id: string): void { this.wood.delete(id); this.touch(); }
  snapshot(): BuildingSnapshot {
    if (!this.cached || this.cached.revision !== this.revision) this.cached = { revision: this.revision, trees: [...this.trees], pieces: [...this.pieces.values()].map(p => ({ ...p })), wood: Object.fromEntries(this.wood) };
    return this.cached;
  }
  load(s: BuildingSnapshot): void {
    this.trees.splice(0, this.trees.length, ...s.trees);
    this.pieces.clear(); for (const p of s.pieces) this.pieces.set(p.id, { ...p });
    this.wood.clear(); for (const [id, n] of Object.entries(s.wood)) this.wood.set(id, n);
    this.revision = s.revision;
    this.cached = null;
    this.nextId = Math.max(0, ...this.pieces.keys()) + 1;
    this.env.changed();
  }
  private grounded(p: BuildRequest): boolean {
    return [[0, 0], [-1.3, -1.3], [1.3, 1.3], [-1.3, 1.3], [1.3, -1.3]]
      .every(([dx, dz]) => Math.abs(p.y - this.env.ground(p.x + dx!, p.z + dz!)) < 0.06);
  }
  private supports(a: BuildRequest, b: BuildRequest): boolean {
    const dx = Math.abs(a.x - b.x), dz = Math.abs(a.z - b.z);
    if (Math.abs(buildTop(a) - b.y) < 0.12 && dx <= 1.51 && dz <= 1.51) return true;
    return a.kind === 'floor' && b.kind === 'floor' && Math.abs(a.y - b.y) < 0.02 && dx + dz <= 3.01;
  }
  canPlace(id: string, r: unknown, feet: Vec3): boolean {
    if (!validBuildRequest(r) || !this.wood.has(id) || (this.wood.get(id) ?? 0) < BUILD.cost) return false;
    if (this.pieces.size >= BUILD.maxPieces || [...this.pieces.values()].filter(p => p.owner === id).length >= BUILD.perPlayer) return false;
    if (Math.abs(r.x) > this.mapSize / 2 - 3 || Math.abs(r.z) > this.mapSize / 2 - 3 || r.y < -2 || r.y > BUILD.height) return false;
    if (Math.hypot(r.x - feet.x, r.y - feet.y, r.z - feet.z) > BUILD.range) return false;
    if (!this.grounded(r) && ![...this.pieces.values()].some(p => this.supports(p, r))) return false;
    if ([...this.pieces.values()].some(p => p.kind === r.kind && p.x === r.x && p.z === r.z && Math.abs(p.y - r.y) < 0.1 && (p.rotation === r.rotation || r.kind === 'floor' || r.kind === 'roof'))) return false;
    return this.env.clear(r, feet);
  }
  place(id: string, r: unknown, feet: Vec3): boolean {
    if (!this.canPlace(id, r, feet) || !validBuildRequest(r)) return false;
    this.wood.set(id, this.wood.get(id)! - BUILD.cost);
    this.pieces.set(this.nextId, { kind: r.kind, x: r.x, y: r.y, z: r.z, rotation: r.rotation, id: this.nextId++, owner: id, hp: BUILD.hp });
    this.onBuild?.(id);
    this.touch(); return true;
  }
  hitTree(id: string, index: number, damage: number, axe: boolean): boolean {
    if (!this.wood.has(id) || !(damage > 0) || !(this.trees[index]! > 0)) return false;
    const actual = Math.min(this.trees[index]!, damage);
    this.trees[index] = Math.max(0, this.trees[index]! - damage);
    if (axe) {
      const before=this.wood.get(id)!;const after=Math.min(BUILD.woodCap,before+Math.floor(actual/15*BUILD.woodPerHit));
      this.wood.set(id,after);if(after>before)this.onHarvest?.(id,after-before);
    }
    this.touch(); return true;
  }
  hitPiece(id: number, damage: number): boolean {
    const p = this.pieces.get(id); if (!p || !(damage > 0)) return false;
    p.hp = Math.max(0, p.hp - damage);
    if (p.hp === 0) {
      this.pieces.delete(id);
      const supported = new Set<number>();
      let progress = true;
      while (progress) {
        progress = false;
        for (const piece of this.pieces.values()) if (!supported.has(piece.id) && (this.grounded(piece) || [...supported].some(key => this.supports(this.pieces.get(key)!, piece)))) {
          supported.add(piece.id); progress = true;
        }
      }
      for (const key of this.pieces.keys()) if (!supported.has(key)) this.pieces.delete(key);
    }
    this.touch(); return true;
  }
  private touch(): void { this.revision++; this.env.changed(); }
}
