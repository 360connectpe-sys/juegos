import { BoxGeometry, BufferAttribute, BufferGeometry, Color } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Utilidades low poly: cada pieza se pinta con color por vértice y se fusiona
 * en una sola geometría → 1 draw call por objeto (clave en móviles).
 */
export function paint(geo: BufferGeometry, color: string | Color): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = color instanceof Color ? color : new Color(color);
  const count = g.getAttribute('position').count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new BufferAttribute(arr, 3));
  return g;
}

export function box(
  w: number,
  h: number,
  d: number,
  color: string,
  x = 0,
  y = 0,
  z = 0,
  rotY = 0,
  rotX = 0,
  rotZ = 0,
): BufferGeometry {
  return transform(paint(new BoxGeometry(w, h, d), color), x, y, z, rotX, rotY, rotZ);
}

export function transform(g: BufferGeometry, x: number, y: number, z: number, rotX = 0, rotY = 0, rotZ = 0): BufferGeometry {
  if (rotX) g.rotateX(rotX);
  if (rotZ) g.rotateZ(rotZ);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  return g;
}

export function merge(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('No se pudieron fusionar las geometrías (atributos incompatibles)');
  parts.forEach((p) => p.dispose());
  merged.computeBoundingSphere();
  return merged;
}
