import { BatchedMesh, type BufferGeometry, Color, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial } from 'three';
import { BUILD, BUILD_KINDS, buildDef, type BuildingSnapshot, type BuildKind, type BuildRequest } from '@shared/building/BuildingState';
import type { TreePlacement } from '@shared/world/layout';
import { box, merge } from './geometry';

/** Un lote para las cuatro piezas, recursos compartidos con la vista previa. */
export class BuildingView {
  readonly root = new Group();
  readonly ghost: Mesh;
  private readonly geometries = new Map<BuildKind, BufferGeometry>();
  private readonly batch: BatchedMesh;
  private readonly geometryIds = new Map<BuildKind, number>();
  private readonly instances = new Map<number, { id: number; kind: BuildKind }>();
  private readonly matrix = new Matrix4();
  private readonly rotation = new Matrix4();
  private readonly tint = new Color();
  private readonly treeInstances: { mesh: InstancedMesh; index: number; base: Matrix4 }[];
  private treeHp: number[] = [];
  private readonly shake = new Map<number, number>();
  private lastState: BuildingSnapshot | null = null;
  constructor(trees: readonly TreePlacement[], group: Group) {
    const material = new MeshLambertMaterial({ vertexColors: true });
    for (const kind of BUILD_KINDS) {
      const geometry = merge(buildDef(kind).parts.flatMap(part => part.kind === 'box' && part.visible ? [
        box(part.size.x, part.size.y, part.size.z, part.color, part.center.x, part.center.y, part.center.z, part.rot?.y, part.rot?.x, part.rot?.z),
      ] : []));
      this.geometries.set(kind, geometry);
    }
    const vertices = [...this.geometries.values()].reduce((n, g) => n + g.getAttribute('position').count, 0);
    this.batch = new BatchedMesh(BUILD.maxPieces, vertices, 0, material);
    for (const [kind, geometry] of this.geometries) this.geometryIds.set(kind, this.batch.addGeometry(geometry));
    this.batch.name = 'wood-structures';
    this.batch.visible = false;
    this.batch.frustumCulled = false;
    this.batch.perObjectFrustumCulled = false;
    this.root.add(this.batch);
    this.ghost = new Mesh(this.geometries.get('wall')!, new MeshBasicMaterial({ vertexColors: false, transparent: true, opacity: 0.45, depthWrite: false }));
    this.ghost.visible = false; this.ghost.name = 'build-preview'; this.root.add(this.ghost);
    const offsets: [number, number] = [0, 0];
    this.treeInstances = trees.map(tree => {
      const mesh = group.children[tree.variant] as InstancedMesh;
      const index = offsets[tree.variant]++;
      const base = new Matrix4(); mesh.getMatrixAt(index, base);
      return { mesh, index, base };
    });
  }
  update(state: BuildingSnapshot, dt: number): void {
    if (state !== this.lastState) {
      this.lastState = state;
      const live = new Set(state.pieces.map(p => p.id));
      for (const [key, instance] of this.instances) if (!live.has(key)) {
        this.batch.deleteInstance(instance.id); this.instances.delete(key);
      }
      for (const piece of state.pieces) {
        let instance = this.instances.get(piece.id);
        if (instance && instance.kind !== piece.kind) {
          this.batch.deleteInstance(instance.id); this.instances.delete(piece.id); instance = undefined;
        }
        if (!instance) {
          instance = { id: this.batch.addInstance(this.geometryIds.get(piece.kind)!), kind: piece.kind };
          this.instances.set(piece.id, instance);
        }
        this.matrix.makeRotationY(piece.rotation * Math.PI / 2); this.matrix.setPosition(piece.x, piece.y, piece.z);
        this.batch.setMatrixAt(instance.id, this.matrix);
        const tint = 0.7 + piece.hp / BUILD.hp * 0.3;
        this.batch.setColorAt(instance.id, this.tint.setRGB(tint, tint, tint));
      }
      this.batch.visible = state.pieces.length > 0;
      state.trees.forEach((hp, i) => {
        if (this.treeHp[i] !== undefined && hp < this.treeHp[i]!) this.shake.set(i, 0.25);
        if (hp > 0 && this.treeHp[i] === 0) {
          const t = this.treeInstances[i]!; t.mesh.setMatrixAt(t.index, t.base); t.mesh.instanceMatrix.needsUpdate = true;
        }
        if (hp === 0) {
          const t = this.treeInstances[i]!; t.mesh.setMatrixAt(t.index, new Matrix4().makeScale(0, 0, 0)); t.mesh.instanceMatrix.needsUpdate = true;
        }
      });
      this.treeHp = [...state.trees];
    }
    for (const [id, left] of this.shake) {
      const tree = this.treeInstances[id]!;
      const next = left - dt;
      this.matrix.copy(tree.base);
      if (next > 0 && this.treeHp[id]! > 0) this.matrix.multiply(this.rotation.makeRotationZ(Math.sin(next * 65) * next * 0.15));
      if (this.treeHp[id] === 0) this.matrix.makeScale(0, 0, 0);
      tree.mesh.setMatrixAt(tree.index, this.matrix); tree.mesh.instanceMatrix.needsUpdate = true;
      if (next <= 0) this.shake.delete(id); else this.shake.set(id, next);
    }
  }
  preview(request: BuildRequest | null, valid = false): void {
    this.ghost.visible = request !== null;
    if (!request) return;
    this.ghost.geometry = this.geometries.get(request.kind)!;
    this.ghost.position.set(request.x, request.y, request.z);
    this.ghost.rotation.y = request.rotation * Math.PI / 2;
    (this.ghost.material as MeshBasicMaterial).color.set(valid ? '#32dd66' : '#ff3333');
  }
  setShadows(enabled: boolean): void { this.batch.castShadow = this.batch.receiveShadow = enabled; }
  dispose(): void {
    this.root.removeFromParent();
    this.batch.dispose();
    for (const geometry of this.geometries.values()) geometry.dispose();
    const material = this.batch.material;
    for (const m of Array.isArray(material) ? material : [material]) m.dispose();
    (this.ghost.material as MeshBasicMaterial).dispose();
    this.instances.clear();
  }
}
