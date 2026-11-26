import { BoxGeometry, type BufferGeometry, ExtrudeGeometry, Group, Mesh, MeshLambertMaterial, Shape } from 'three';
import { damp } from '@shared/math';
import { facesCamera, insideState, type InsideState, type PartLayer, type PlacedPrefab } from '@shared/world/prefab';
import { merge, paint, transform } from './geometry';

export type GroupKey = `${PartLayer}` | `${PartLayer}-cut`;

/**
 * Opacidad objetivo de cada grupo según dónde esté el jugador.
 * Pura → testeable y reutilizable para construcciones de jugadores.
 */
export function visibilityTargets(state: InsideState): Record<GroupKey, number> {
  const inside = state !== 'outside';
  const CUT = 0.18;
  return {
    base: 1,
    'base-cut': inside ? CUT : 1,
    upper: state === 'lower' ? 0 : 1,
    'upper-cut': state === 'lower' ? 0 : inside ? CUT : 1,
    roof: inside ? 0 : 1,
    'roof-cut': inside ? 0 : 1,
  };
}

/**
 * Vista 3D de un prefab: una malla fusionada por grupo (capa × cara a cámara),
 * normalmente 3-5 draw calls por edificio. Gestiona la ocultación de techos y
 * plantas cuando el jugador entra.
 */
export class PrefabView {
  readonly root = new Group();
  private readonly meshes = new Map<GroupKey, Mesh>();
  private readonly opacity = new Map<GroupKey, number>();
  state: InsideState = 'outside';

  constructor(
    readonly placed: PlacedPrefab,
    castShadow: boolean,
  ) {
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
        const cut = facesCamera(placed, part.facing);
        add(cut ? `${part.layer}-cut` : part.layer, g);
      } else {
        const shape = new Shape();
        shape.moveTo(-part.halfWidth, 0);
        shape.lineTo(part.halfWidth, 0);
        shape.lineTo(0, part.height);
        shape.closePath();
        const g = transform(
          paint(new ExtrudeGeometry(shape, { depth: part.thickness, bevelEnabled: false }), part.color),
          0,
          part.y,
          part.z,
        );
        add(part.layer, g);
      }
    }

    for (const [key, geos] of buckets) {
      // Cada grupo tiene su material para poder desvanecerlo por separado.
      const mat = new MeshLambertMaterial({ vertexColors: true, transparent: key !== 'base', opacity: 1 });
      const mesh = new Mesh(merge(geos), mat);
      mesh.name = `${placed.def.id}:${key}`;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.meshes.set(key, mesh);
      this.opacity.set(key, 1);
      this.root.add(mesh);
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

  /** Actualiza la visibilidad según la posición (pies) del jugador local. */
  update(px: number, py: number, pz: number, dt: number): void {
    if (!this.hasInterior) return;
    this.state = insideState(this.placed, px, py, pz);
    const targets = visibilityTargets(this.state);
    for (const [key, mesh] of this.meshes) {
      const current = this.opacity.get(key) ?? 1;
      const target = targets[key];
      if (current === target) continue;
      let next = damp(current, target, 14, dt);
      if (Math.abs(next - target) < 0.01) next = target;
      this.opacity.set(key, next);
      const mat = mesh.material as MeshLambertMaterial;
      mat.opacity = next;
      mat.depthWrite = next > 0.98;
      mesh.visible = next > 0.01;
    }
  }

  groupOpacity(key: GroupKey): number | undefined {
    return this.opacity.get(key);
  }
}
