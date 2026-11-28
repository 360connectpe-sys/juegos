import { BufferAttribute, BufferGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial } from 'three';
import { BUILD, BUILD_KINDS, WALL_EDGE, buildDef, type BuildingSnapshot, type BuildKind, type BuildRequest } from '@shared/building/BuildingState';
import type { TreePlacement } from '@shared/world/layout';
import { box, merge } from './geometry';

/** Vista previa: marrón oscuro semitransparente si es válida, rojo si no. */
/** Fase 15: verde = se puede colocar; rojo = no (antes marrón/rojo). */
export const PREVIEW_COLORS = { valid: '#2fbf4a', invalid: '#e02424' } as const;

/**
 * Estructuras de madera: TODAS las piezas en UNA malla dinámica = 1 draw call
 * (+1 de sombra), haya 1 o 128 piezas y tenga o no la GPU WEBGL_multi_draw
 * (sin ella, el BatchedMesh anterior costaba 1 draw call POR pieza en Safari
 * iOS: 128 piezas = 128 llamadas, 256 con sombras). Los vértices se reescriben
 * solo cuando cambia la revisión de la autoridad (colocar, dañar, destruir),
 * nunca por frame. Geometrías compartidas con la vista previa.
 */
export class BuildingView {
  readonly root = new Group();
  readonly ghost: Mesh;
  private readonly geometries = new Map<BuildKind, BufferGeometry>();
  /** Malla única con todas las piezas colocadas. */
  readonly structures: Mesh;
  private readonly counts: Record<BuildKind, number> = { wall: 0, floor: 0, ramp: 0, roof: 0 };
  private readonly matrix = new Matrix4();
  private readonly rotation = new Matrix4();
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
    const maxVerts = Math.max(...[...this.geometries.values()].map(g => g.getAttribute('position').count)) * BUILD.maxPieces;
    const geometry = new BufferGeometry();
    for (const name of ['position', 'normal', 'color']) {
      const attr = new BufferAttribute(new Float32Array(maxVerts * 3), 3);
      attr.setUsage(35048); // DynamicDrawUsage
      geometry.setAttribute(name, attr);
    }
    geometry.setDrawRange(0, 0);
    this.structures = new Mesh(geometry, material);
    this.structures.name = 'wood-structures';
    this.structures.visible = false;
    this.structures.frustumCulled = false; // repartidas por el mapa
    this.structures.matrixAutoUpdate = false;
    this.root.add(this.structures);
    this.ghost = new Mesh(this.geometries.get('wall')!, new MeshBasicMaterial({ vertexColors: false, transparent: true, opacity: 0.45, depthWrite: false }));
    this.ghost.renderOrder = 3;
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
      this.writePieces(state);
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
    if (request.slot !== undefined) {
      // Panel de hueco: la pared estándar (borde +Z) escalada al hueco y centrada en él.
      const a = request.yaw!, w = request.w!, h = request.h!;
      this.ghost.rotation.y = a;
      this.ghost.scale.set(w / BUILD.size, h / 3, 1);
      this.ghost.position.set(request.x - Math.sin(a) * WALL_EDGE, request.y, request.z - Math.cos(a) * WALL_EDGE);
    } else {
      this.ghost.scale.set(1, 1, 1);
      this.ghost.position.set(request.x, request.y, request.z);
      this.ghost.rotation.y = request.rotation * Math.PI / 2;
    }
    (this.ghost.material as MeshBasicMaterial).color.set(valid ? PREVIEW_COLORS.valid : PREVIEW_COLORS.invalid);
  }
  /** Copia las piezas (rotadas, colocadas y tintadas por resistencia) en la malla única. */
  private writePieces(state: BuildingSnapshot): void {
    const g = this.structures.geometry;
    const pos = g.getAttribute('position') as BufferAttribute;
    const nor = g.getAttribute('normal') as BufferAttribute;
    const col = g.getAttribute('color') as BufferAttribute;
    const P = pos.array as Float32Array, N = nor.array as Float32Array, C = col.array as Float32Array;
    const capacity = pos.count;
    let o = 0;
    this.counts.wall = this.counts.floor = this.counts.ramp = this.counts.roof = 0;
    for (const piece of state.pieces) {
      const src = this.geometries.get(piece.kind);
      if (!src) continue;
      const sp = src.getAttribute('position').array as ArrayLike<number>;
      const sn = src.getAttribute('normal').array as ArrayLike<number>;
      const sc = src.getAttribute('color').array as ArrayLike<number>;
      const n = sp.length / 3;
      if (o + n > capacity) break;
      this.counts[piece.kind]++;
      const slot = piece.slot !== undefined;
      const a = slot ? piece.yaw! : piece.rotation * Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
      // Panel de hueco: misma geometría de pared, escalada al hueco y sin el desplazamiento al borde.
      const sx = slot ? piece.w! / BUILD.size : 1, sy = slot ? piece.h! / 3 : 1, oz = slot ? -WALL_EDGE : 0;
      const tint = 0.7 + piece.hp / BUILD.hp * 0.3;
      for (let i = 0; i < n; i++) {
        const k = i * 3, d = (o + i) * 3;
        const x = sp[k]! * sx, z = sp[k + 2]! + oz;
        // Rotación Y (misma convención que makeRotationY) + traslación.
        P[d] = x * c + z * s + piece.x; P[d + 1] = sp[k + 1]! * sy + piece.y; P[d + 2] = -x * s + z * c + piece.z;
        const nx = sn[k]!, nz = sn[k + 2]!;
        N[d] = nx * c + nz * s; N[d + 1] = sn[k + 1]!; N[d + 2] = -nx * s + nz * c;
        C[d] = sc[k]! * tint; C[d + 1] = sc[k + 1]! * tint; C[d + 2] = sc[k + 2]! * tint;
      }
      o += n;
    }
    for (const attr of [pos, nor, col]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, Math.max(3, o * 3));
      attr.needsUpdate = true;
    }
    g.setDrawRange(0, o);
    this.structures.visible = o > 0;
  }
  /** Piezas dibujadas por clase (pruebas y depuración). */
  get drawn(): Record<BuildKind, number> {
    return { ...this.counts };
  }
  setShadows(enabled: boolean): void { this.structures.castShadow = this.structures.receiveShadow = enabled; }
  dispose(): void {
    this.root.removeFromParent();
    this.structures.geometry.dispose();
    for (const geometry of this.geometries.values()) geometry.dispose();
    const material = this.structures.material;
    for (const m of Array.isArray(material) ? material : [material]) m.dispose();
    (this.ghost.material as MeshBasicMaterial).dispose();
  }
}
