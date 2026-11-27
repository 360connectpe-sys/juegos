import { BatchedMesh, BoxGeometry, type BufferGeometry, ExtrudeGeometry, Group, Matrix4, Mesh, MeshLambertMaterial, Quaternion, Shape, Vector3 } from 'three';
import { damp } from '@shared/math';
import { facesCamera, insideState, type InsideState, type PartLayer, type PlacedPrefab } from '@shared/world/prefab';
import { merge, paint, transform } from './geometry';

export type GroupKey = `${PartLayer}` | `${PartLayer}-cut`;

const CUT = 0.18;
const TARGETS: Record<InsideState, Readonly<Record<GroupKey, number>>> = {
  outside: Object.freeze({ base: 1, 'base-cut': 1, upper: 1, 'upper-cut': 1, roof: 1, 'roof-cut': 1 }),
  lower: Object.freeze({ base: 1, 'base-cut': CUT, upper: 0, 'upper-cut': 0, roof: 0, 'roof-cut': 0 }),
  upper: Object.freeze({ base: 1, 'base-cut': CUT, upper: 1, 'upper-cut': CUT, roof: 0, 'roof-cut': 0 }),
};

/**
 * Opacidad objetivo de cada grupo según dónde esté el jugador.
 * Pura y sin asignaciones (devuelve tablas constantes).
 */
export function visibilityTargets(state: InsideState): Readonly<Record<GroupKey, number>> {
  return TARGETS[state];
}

/** Geometrías por grupo (capa × cara a cámara) en coordenadas LOCALES del prefab. */
export function buildPrefabBuckets(placed: PlacedPrefab): Map<GroupKey, BufferGeometry[]> {
  const buckets = new Map<GroupKey, BufferGeometry[]>();
  const add = (key: GroupKey, g: BufferGeometry) => {
    const list = buckets.get(key) ?? [];
    list.push(g);
    buckets.set(key, list);
  };
  for (const part of placed.def.parts) {
    if (part.kind === 'box') {
      if (!part.visible) continue;
      const g = transform(
        paint(new BoxGeometry(part.size.x, part.size.y, part.size.z), part.color),
        part.center.x,
        part.center.y,
        part.center.z,
        part.rot?.x ?? 0,
        part.rot?.y ?? 0,
        part.rot?.z ?? 0,
      );
      add(facesCamera(placed, part.facing) ? `${part.layer}-cut` : part.layer, g);
    } else {
      const shape = new Shape();
      shape.moveTo(-part.halfWidth, 0);
      shape.lineTo(part.halfWidth, 0);
      shape.lineTo(0, part.height);
      shape.closePath();
      add(part.layer, transform(paint(new ExtrudeGeometry(shape, { depth: part.thickness, bevelEnabled: false }), part.color), 0, part.y, part.z));
    }
  }
  return buckets;
}

const prefabMatrix = (p: PlacedPrefab): Matrix4 =>
  new Matrix4().compose(new Vector3(p.x, p.y, p.z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), p.rotationY), new Vector3(1, 1, 1));

/** Material opaco compartido por todo lo estático con color por vértice. */
let staticMaterial: MeshLambertMaterial | null = null;
export function sharedStaticMaterial(): MeshLambertMaterial {
  staticMaterial ??= new MeshLambertMaterial({ vertexColors: true });
  return staticMaterial;
}

function staticMesh(geo: BufferGeometry, name: string, castShadow: boolean): Mesh {
  const mesh = new Mesh(geo, sharedStaticMaterial());
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

/**
 * Fusiona en UNA malla todos los prefabs sin interior (mirador, cajas…):
 * 1 draw call en lugar de uno por prefab. Coordenadas de mundo ya aplicadas.
 */
export function createStaticPrefabBatch(placed: readonly PlacedPrefab[], castShadow: boolean): Mesh | null {
  const geos: BufferGeometry[] = [];
  for (const p of placed) {
    const m = prefabMatrix(p);
    for (const list of buildPrefabBuckets(p).values()) for (const g of list) geos.push(g.applyMatrix4(m));
  }
  return geos.length ? staticMesh(merge(geos), 'static-prefabs', castShadow) : null;
}

/**
 * Todos los edificios con interior (casa grande y casas pequeñas) en UN
 * BatchedMesh: 1 draw call (+1 de sombra) los veas todos o ninguno, con
 * recorte por edificio fuera de cámara. Cuando el jugador entra en uno, solo
 * ese se oculta del lote y su PrefabView muestra las piezas recortables.
 */
export class InteriorBatch {
  readonly mesh: BatchedMesh;
  private readonly ids: number[] = [];

  /**
   * @param reserve Capacidad extra (instancias y vértices) para otros objetos
   * con el MISMO material que comparten este draw call (fase 6: lo que llevan
   * los jugadores en la mano, ver WeaponBatch).
   */
  constructor(placed: readonly PlacedPrefab[], castShadow: boolean, reserve: { instances: number; vertices: number } = { instances: 0, vertices: 0 }) {
    const geos = placed.map((p) => {
      const all: BufferGeometry[] = [];
      for (const list of buildPrefabBuckets(p).values()) all.push(...list);
      return merge(all);
    });
    const vertices = geos.reduce((n, g) => n + g.getAttribute('position').count, 0);
    this.mesh = new BatchedMesh(Math.max(placed.length + reserve.instances, 1), Math.max(vertices + reserve.vertices, 3), 0, sharedStaticMaterial());
    this.mesh.name = 'buildings';
    placed.forEach((p, i) => {
      const id = this.mesh.addInstance(this.mesh.addGeometry(geos[i]!));
      this.mesh.setMatrixAt(id, prefabMatrix(p));
      this.ids.push(id);
      geos[i]!.dispose();
    });
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = true;
    this.mesh.computeBoundingSphere();
    this.mesh.matrixAutoUpdate = false;
  }

  setVisible(index: number, visible: boolean): void {
    const id = this.ids[index];
    if (id !== undefined) this.mesh.setVisibleAt(id, visible);
  }
}

/**
 * Vista de un prefab CON interior (la casa). Fuera de ella se dibuja como una
 * sola malla opaca (1 draw call). Al entrar se cambia a mallas por grupo para
 * desvanecer techo, planta alta y paredes que tapan la cámara; esas mallas solo
 * son transparentes mientras no están opacas del todo.
 */
export class PrefabView {
  readonly root = new Group();
  /** Malla completa propia (si no forma parte de un InteriorBatch). */
  private readonly whole: Mesh | null;
  private readonly meshes = new Map<GroupKey, Mesh>();
  private readonly opacity = new Map<GroupKey, number>();
  private split = false;
  state: InsideState = 'outside';

  constructor(
    readonly placed: PlacedPrefab,
    castShadow: boolean,
    /** Si se da, la vista "desde fuera" la pone el lote compartido. */
    private readonly batch: { setVisible(visible: boolean): void } | null = null,
  ) {
    const buckets = buildPrefabBuckets(placed);
    const all: BufferGeometry[] = [];
    for (const [key, geos] of buckets) {
      all.push(...geos.map((g) => g.clone()));
      const mat = new MeshLambertMaterial({ vertexColors: true, transparent: false, opacity: 1 });
      const mesh = new Mesh(merge(geos), mat);
      mesh.name = `${placed.def.id}:${key}`;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.visible = false;
      this.meshes.set(key, mesh);
      this.opacity.set(key, 1);
      this.root.add(mesh);
    }
    if (batch) {
      all.forEach((g) => g.dispose());
      this.whole = null;
    } else {
      this.whole = staticMesh(merge(all), `${placed.def.id}:whole`, castShadow);
      this.root.add(this.whole);
    }

    this.root.name = `prefab:${placed.def.id}`;
    this.root.position.set(placed.x, placed.y, placed.z);
    this.root.rotation.y = placed.rotationY;
    this.root.updateMatrix();
    this.root.matrixAutoUpdate = false;
    this.root.updateMatrixWorld(true);
  }

  get hasInterior(): boolean {
    return this.placed.def.interior !== undefined;
  }

  /** Draw calls actuales de este prefab (para métricas y pruebas). */
  get visibleMeshes(): number {
    let n = this.whole ? (this.whole.visible ? 1 : 0) : this.split ? 0 : 1;
    for (const m of this.meshes.values()) if (m.visible) n++;
    return n;
  }

  set castShadow(v: boolean) {
    if (this.whole) this.whole.castShadow = v;
    for (const m of this.meshes.values()) m.castShadow = v;
  }

  /** Actualiza la visibilidad según la posición (pies) del jugador local. */
  update(px: number, py: number, pz: number, dt: number, cutaway = true): void {
    if (!this.hasInterior) return;
    // En 3ª/1ª persona no se recorta nada: la cámara está dentro con el jugador.
    this.state = cutaway ? insideState(this.placed, px, py, pz) : 'outside';
    const targets = visibilityTargets(this.state);
    let allOpaque = true;
    for (const [key, mesh] of this.meshes) {
      const current = this.opacity.get(key) ?? 1;
      const target = targets[key];
      let next = current;
      if (current !== target) {
        // (solo hay animación en las transiciones; en reposo no se toca nada)
        next = damp(current, target, 14, dt);
        if (Math.abs(next - target) < 0.01) next = target;
        this.opacity.set(key, next);
      }
      if (next < 1) allOpaque = false;
      const mat = mesh.material as MeshLambertMaterial;
      const transparent = next < 1;
      if (mat.transparent !== transparent) {
        mat.transparent = transparent;
        mat.needsUpdate = true;
      }
      mat.opacity = next;
      mat.depthWrite = next > 0.98;
      mesh.visible = this.split && next > 0.01;
    }
    // Fuera y con todo opaco: una sola malla.
    const split = !(this.state === 'outside' && allOpaque);
    if (split !== this.split) {
      this.split = split;
      if (this.whole) this.whole.visible = !split;
      this.batch?.setVisible(!split);
      if (!split) for (const m of this.meshes.values()) m.visible = false;
    }
  }

  groupOpacity(key: GroupKey): number | undefined {
    return this.opacity.get(key);
  }
}
