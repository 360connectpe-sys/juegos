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
 * (pinos y árboles redondos, cada uno con su tronco).
 */
export function createTrees(trees: TreePlacement[], seed: number, castShadow: boolean): Group {
  const group = new Group();
  group.name = 'trees';
  const material = new MeshLambertMaterial({ vertexColors: true });

  // Fase 3.2: tronco y copa en la MISMA geometría (colores horneados) → 2 draw
  // calls para todos los árboles en lugar de 3. El color por instancia es un
  // multiplicador cercano a blanco que solo varía un poco tono y brillo.
  const trunk = () => transform(paint(new CylinderGeometry(0.18, 0.28, 1.6, 6), '#8b5a2b'), 0, 0.8, 0);
  const pineGeo = merge([
    trunk(),
    transform(paint(new ConeGeometry(1.3, 2, 6), '#2f7d4a'), 0, 2.2, 0),
    transform(paint(new ConeGeometry(1, 1.6, 6), '#2f7d4a'), 0, 3.1, 0),
    transform(paint(new ConeGeometry(0.65, 1.2, 6), '#2f7d4a'), 0, 3.9, 0),
  ]);
  const roundGeo = merge([trunk(), transform(paint(new IcosahedronGeometry(1.35, 0), '#6cbf3f'), 0, 2.6, 0)]);

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
  const varied = () => {
    const k = 0.9 + rng() * 0.18; // brillo
    return new Color(k * (0.97 + rng() * 0.06), k * (0.97 + rng() * 0.06), k * (0.97 + rng() * 0.06));
  };

  make(pineGeo, pines, varied, 'tree-pines');
  make(roundGeo, rounds, varied, 'tree-rounds');
  return group;
}
