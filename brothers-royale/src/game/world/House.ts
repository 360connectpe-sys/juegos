import { ExtrudeGeometry, Mesh, MeshLambertMaterial, Shape } from 'three';
import { HOUSE_STYLE } from '@shared/world/colliders';
import type { HousePlacement } from '@shared/world/layout';
import { box, merge, paint, transform } from './geometry';

const C = {
  wall: '#f4e3c3',
  trim: '#8a5a3b',
  roof: '#d9534f',
  roofDark: '#b23a37',
  floor: '#b88a5e',
  window: '#5bc0eb',
  door: '#6b4226',
  chimney: '#9c9c9c',
};

/**
 * Casa low poly fusionada en una sola malla (1 draw call). Las paredes usan
 * las mismas medidas que `houseColliders`, así lo que se ve es lo que choca.
 */
export function createHouse(h: HousePlacement, baseY = 0): Mesh {
  const { wallThickness: t, doorWidth, doorHeight, floorHeight } = HOUSE_STYLE;
  const W = h.width;
  const D = h.depth;
  const H = h.wallHeight;
  const hw = W / 2;
  const hd = D / 2;
  const parts = [];

  // Suelo y cimientos
  parts.push(box(W + 0.4, 0.4, D + 0.4, C.trim, 0, -0.2 + floorHeight / 2, 0));
  parts.push(box(W - t * 2, floorHeight, D - t * 2, C.floor, 0, floorHeight / 2, 0));

  // Paredes (idénticas a los colisionadores)
  parts.push(box(W, H, t, C.wall, 0, H / 2, -hd + t / 2));
  parts.push(box(t, H, D, C.wall, -hw + t / 2, H / 2, 0));
  parts.push(box(t, H, D, C.wall, hw - t / 2, H / 2, 0));
  const doorHalf = doorWidth / 2;
  const segW = hw - doorHalf;
  parts.push(box(segW, H, t, C.wall, -doorHalf - segW / 2, H / 2, hd - t / 2));
  parts.push(box(segW, H, t, C.wall, doorHalf + segW / 2, H / 2, hd - t / 2));
  // Dintel sobre la puerta (solo visual, más alto que el personaje)
  parts.push(box(doorWidth, H - doorHeight, t, C.wall, 0, doorHeight + (H - doorHeight) / 2, hd - t / 2));
  // Marco de la puerta
  parts.push(box(0.12, doorHeight, t + 0.08, C.trim, -doorHalf, doorHeight / 2, hd - t / 2));
  parts.push(box(0.12, doorHeight, t + 0.08, C.trim, doorHalf, doorHeight / 2, hd - t / 2));
  parts.push(box(doorWidth + 0.12, 0.12, t + 0.08, C.trim, 0, doorHeight, hd - t / 2));
  // Puerta abierta, girada hacia dentro
  parts.push(box(0.08, doorHeight - 0.1, doorWidth * 0.9, C.door, -doorHalf + 0.1, doorHeight / 2, hd - t - doorWidth * 0.45));

  // Ventanas (relieve exterior)
  const win = (x: number, z: number, rotY: number) => {
    parts.push(box(1.1, 0.9, 0.06, C.window, x, 1.7, z, rotY));
    parts.push(box(1.3, 0.12, 0.1, C.trim, x, 1.19, z, rotY));
  };
  win(-hw + 1.6, hd + 0.01, 0);
  win(hw - 1.6, hd + 0.01, 0);
  win(-hw - 0.01, 0, Math.PI / 2);
  win(hw + 0.01, 0, Math.PI / 2);
  win(-1.8, -hd - 0.01, 0);
  win(1.8, -hd - 0.01, 0);

  // Esquinas de madera
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(0.22, H, 0.22, C.trim, sx * (hw - 0.05), H / 2, sz * (hd - 0.05)));

  // Tejado a dos aguas: hastiales triangulares + dos faldones
  const roofH = 1.8;
  const gable = new Shape();
  gable.moveTo(-hw, 0);
  gable.lineTo(hw, 0);
  gable.lineTo(0, roofH);
  gable.closePath();
  for (const z of [hd - t, -hd]) {
    parts.push(transform(paint(new ExtrudeGeometry(gable, { depth: t, bevelEnabled: false }), C.wall), 0, H, z));
  }
  const slope = Math.atan2(roofH, hw);
  const slab = Math.hypot(hw, roofH) + 0.5;
  for (const sx of [-1, 1]) {
    parts.push(
      box(slab, 0.22, D + 0.8, sx < 0 ? C.roof : C.roofDark, (sx * hw) / 2 + sx * 0.05, H + roofH / 2 + 0.12, 0, 0, 0, -sx * slope),
    );
  }
  parts.push(box(0.3, 0.3, D + 0.9, C.trim, 0, H + roofH + 0.12, 0));
  // Chimenea
  parts.push(box(0.6, 1.4, 0.6, C.chimney, hw * 0.45, H + roofH * 0.75, -hd * 0.35));

  const mesh = new Mesh(merge(parts), new MeshLambertMaterial({ vertexColors: true }));
  mesh.name = 'house';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(h.x, baseY, h.z);
  mesh.rotation.y = h.rotation;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}
