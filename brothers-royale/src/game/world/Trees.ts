import {
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { TreePlacement } from '@shared/world/layout';
import { createRng } from '@shared/random';
import { merge, paint, transform } from './geometry';

/**
 * Árboles con InstancedMesh: cientos de árboles en 3 draw calls
 * (tronco, copa de pino, copa redonda).
 */
export function createTrees(trees: TreePlacement[], seed: number, castShadow: boolean): Group {
  const group = new Group();
  group.name = 'trees';
  const material = new MeshLambertMaterial({ vertexColors: true });

  const trunkGeo = transform(paint(new CylinderGeometry(0.18, 0.28, 1.6, 6), '#8b5a2b'), 0, 0.8, 0);
  const pineGeo = merge([
    transform(paint(new ConeGeometry(1.3, 2, 6), '#ffffff'), 0, 2.2, 0),
    transform(paint(new ConeGeometry(1, 1.6, 6), '#ffffff'), 0, 3.1, 0),
    transform(paint(new ConeGeometry(0.65, 1.2, 6), '#ffffff'), 0, 3.9, 0),
  ]);
  const roundGeo = transform(paint(new IcosahedronGeometry(1.35, 0), '#ffffff'), 0, 2.6, 0);

  const pines = trees.filter((t) => t.variant === 0);
  const rounds = trees.filter((t) => t.variant === 1);

  const make = (geo: BufferGeometry, list: TreePlacement[], tint: (i: number) => Color | null, name: string) => {
    const mesh = new InstancedMesh(geo, material, Math.max(list.length, 1));
    mesh.name = name;
    mesh.count = list.length;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = false;
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const s = new Vector3();
    const p = new Vector3();
    list.forEach((t, i) => {
      q.setFromAxisAngle(up, t.rotation);
      s.setScalar(t.scale);
      p.set(t.x, t.y - 0.1, t.z);
      mesh.setMatrixAt(i, m.compose(p, q, s));
      const c = tint(i);
      if (c) mesh.setColorAt(i, c);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    return mesh;
  };

  const rng = createRng(seed ^ 0x9e3779b9);
  const pineBase = new Color('#2f7d4a');
  const roundBase = new Color('#6cbf3f');
  const varied = (base: Color) => () => base.clone().offsetHSL((rng() - 0.5) * 0.04, (rng() - 0.5) * 0.1, (rng() - 0.5) * 0.08);

  make(trunkGeo, trees, () => null, 'tree-trunks');
  make(pineGeo, pines, varied(pineBase), 'tree-pines');
  make(roundGeo, rounds, varied(roundBase), 'tree-rounds');
  return group;
}
