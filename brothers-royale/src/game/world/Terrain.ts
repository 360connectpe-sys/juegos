import { BufferAttribute, BufferGeometry, Color, Mesh, MeshLambertMaterial, PlaneGeometry } from 'three';
import { WORLD } from '@shared/constants';
import { sampleTerrainGrid, type TerrainParams } from '@shared/world/terrain';

const SAND = new Color('#e8d08a');
const GRASS_LOW = new Color('#7cc456');
const GRASS_HIGH = new Color('#4f9a3a');
const tmp = new Color();

function colorForHeight(h: number, out: Color): Color {
  // La arena solo aparece cerca del nivel del mar; la zona plana de la casa es césped.
  if (h < -0.45) return out.copy(SAND);
  if (h < -0.2) return out.copy(SAND).lerp(GRASS_LOW, (h + 0.45) / 0.25);
  return out.copy(GRASS_LOW).lerp(GRASS_HIGH, Math.min(Math.max(h, 0) / 3, 1));
}

/**
 * Malla del terreno con sombreado plano (caras sin índice) y color por cara.
 * Usa la misma rejilla y triangulación que el heightfield de Rapier.
 */
export function createTerrainMesh(params: TerrainParams, segments: number = WORLD.segments): Mesh {
  const n = segments + 1;
  const heights = sampleTerrainGrid(params, segments);
  const step = params.size / segments;
  const half = params.size / 2;
  const triCount = segments * segments * 2;
  const pos = new Float32Array(triCount * 9);
  const col = new Float32Array(triCount * 9);
  let o = 0;

  const vx = (c: number) => -half + c * step;
  const h = (r: number, c: number) => heights[r * n + c]!;

  const pushTri = (r0: number, c0: number, r1: number, c1: number, r2: number, c2: number) => {
    const y0 = h(r0, c0);
    const y1 = h(r1, c1);
    const y2 = h(r2, c2);
    colorForHeight((y0 + y1 + y2) / 3, tmp);
    const verts: [number, number, number][] = [
      [vx(c0), y0, vx(r0)],
      [vx(c1), y1, vx(r1)],
      [vx(c2), y2, vx(r2)],
    ];
    for (const [x, y, z] of verts) {
      pos[o] = x;
      pos[o + 1] = y;
      pos[o + 2] = z;
      col[o] = tmp.r;
      col[o + 1] = tmp.g;
      col[o + 2] = tmp.b;
      o += 3;
    }
  };

  for (let r = 0; r < segments; r++) {
    for (let c = 0; c < segments; c++) {
      // Orden antihorario visto desde arriba (+Y).
      pushTri(r, c, r + 1, c, r, c + 1);
      pushTri(r, c + 1, r + 1, c, r + 1, c + 1);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('color', new BufferAttribute(col, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mesh = new Mesh(geo, new MeshLambertMaterial({ vertexColors: true }));
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

/** Mar alrededor de la isla: un plano barato sin sombras. */
export function createWater(size: number): Mesh {
  const geo = new PlaneGeometry(size * 4, size * 4);
  geo.rotateX(-Math.PI / 2);
  // Opaca (fase 3.2): sin mezcla alfa sobre media pantalla. Color = el de antes ya mezclado con la arena.
  const mesh = new Mesh(geo, new MeshLambertMaterial({ color: '#4aa8d0' }));
  mesh.name = 'water';
  // Se dibuja al FINAL de la pasada opaca: así la prueba de profundidad descarta
  // todo lo que ya cubre el terreno y no se pinta la pantalla dos veces.
  mesh.renderOrder = 1;
  mesh.position.y = -0.55;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}
