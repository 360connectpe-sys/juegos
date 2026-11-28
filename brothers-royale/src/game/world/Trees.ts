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
import type { RockPlacement, TreePlacement } from '@shared/world/layout';
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
  // Fase 15: tronco más alto (2,3 m) y copas elevadas: tapan menos la cámara en 3ª persona y
  // al talar en 1ª persona se ve el tronco. Tronco con raíces (base ancha) y copas en dos tonos.
  const trunk = () => merge([
    transform(paint(new CylinderGeometry(0.17, 0.3, 2.3, 7), '#7a4e27'), 0, 1.15, 0),
    transform(paint(new CylinderGeometry(0.3, 0.42, 0.25, 7), '#6b4322'), 0, 0.12, 0),
  ]);
  const pineGeo = merge([
    trunk(),
    transform(paint(new ConeGeometry(1.45, 2.1, 7), '#2b7445'), 0, 2.9, 0),
    transform(paint(new ConeGeometry(1.1, 1.7, 7), '#2f8049'), 0, 3.85, 0),
    transform(paint(new ConeGeometry(0.7, 1.3, 7), '#38904f'), 0, 4.7, 0),
  ]);
  const roundGeo = merge([
    trunk(),
    transform(paint(new IcosahedronGeometry(1.45, 0), '#5fae38'), 0, 3.4, 0),
    transform(paint(new IcosahedronGeometry(0.95, 0), '#71c246'), 0.55, 4.1, 0.25),
  ]);

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

/**
 * Fase 15: rocas (las mismas que colisionan, `rockCollider`) y arbustos (solo visuales) en
 * 2 InstancedMesh con geometría y material compartidos; variación de escala, giro y tono.
 */
export function createRocksAndBushes(rocks: readonly RockPlacement[], bushes: readonly RockPlacement[], seed: number): Group {
  const group = new Group();
  group.name = 'rocks-bushes';
  const material = new MeshLambertMaterial({ vertexColors: true });
  const rockGeo = merge([
    transform(paint(new IcosahedronGeometry(0.9, 0), '#8d8a84'), 0, 0.4, 0),
    transform(paint(new IcosahedronGeometry(0.55, 0), '#a29e96'), 0.5, 0.75, -0.2),
  ]);
  rockGeo.scale(1, 0.75, 1);
  const bushGeo = merge([
    transform(paint(new IcosahedronGeometry(0.7, 0), '#4c9a3a'), 0, 0.5, 0),
    transform(paint(new IcosahedronGeometry(0.5, 0), '#5aad42'), 0.45, 0.45, 0.2),
    transform(paint(new IcosahedronGeometry(0.45, 0), '#468c35'), -0.4, 0.4, -0.15),
  ]);
  const rng = createRng(seed ^ 0x5a5a);
  const m = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0), sc = new Vector3(), p = new Vector3();
  for (const [geo, list, name] of [[rockGeo, rocks, 'rocks'], [bushGeo, bushes, 'bushes']] as const) {
    const mesh = new InstancedMesh(geo, material, Math.max(1, list.length));
    mesh.name = name;
    mesh.count = list.length;
    list.forEach((r, i) => {
      q.setFromAxisAngle(up, r.rotation);
      sc.setScalar(r.scale);
      p.set(r.x, r.y - 0.08, r.z);
      mesh.setMatrixAt(i, m.compose(p, q, sc));
      const k = 0.9 + rng() * 0.2;
      mesh.setColorAt(i, new Color(k, k, k));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  return group;
}
