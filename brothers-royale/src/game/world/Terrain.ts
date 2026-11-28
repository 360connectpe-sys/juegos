import { BufferAttribute, BufferGeometry, Color, Mesh, MeshLambertMaterial, PlaneGeometry } from 'three';
import { WORLD } from '@shared/constants';
import { sampleTerrainGrid, sectorAt, WATER_LEVEL, type Sector, type TerrainParams } from '@shared/world/terrain';

const SAND = new Color('#e8d08a');
const GRASS_LOW = new Color('#7cc456');
const GRASS_HIGH = new Color('#4f9a3a');
const tmp = new Color();
const PATH = new Color('#b59a6a');
/** Fase 15: tinte por sector (multiplicador suave: se distinguen sin colores chillones). */
const SECTOR_TINT: Record<Sector, Color> = {
  residential: new Color(1.04, 1.02, 0.94), rural: new Color(1.08, 1.04, 0.82), forest: new Color(0.82, 0.92, 0.8), open: new Color(1.0, 1.06, 0.92),
};
/** Distancia de (x, z) al segmento a-b. */
function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
  return Math.hypot(ax + dx * t - x, az + dz * t - z);
}

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
/** `paths`: destinos de caminos de tierra desde el pueblo (puertas de las casas). Solo color. */
export function createTerrainMesh(params: TerrainParams, segments: number = WORLD.segments, paths: readonly { x: number; z: number }[] = []): Mesh {
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
    const hAvg = (y0 + y1 + y2) / 3;
    colorForHeight(hAvg, tmp);
    if (hAvg > -0.2) {
      const cx = (vx(c0) + vx(c1) + vx(c2)) / 3, cz = (vx(r0) + vx(r1) + vx(r2)) / 3;
      tmp.multiply(SECTOR_TINT[sectorAt(cx, cz, params.seed)]);
      // Variación suave por cara (determinista) para que el césped no sea plano.
      const v = 0.96 + (((Math.sin(cx * 12.9898 + cz * 78.233) * 43758.5453) % 1 + 1) % 1) * 0.08;
      tmp.multiplyScalar(v);
      // Caminos ligeros del pueblo a cada casa.
      for (const p of paths) if (segDist(cx, cz, 0, 0, p.x, p.z) < 1.1) { tmp.lerp(PATH, 0.75); break; }
    }
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
  mesh.position.y = WATER_LEVEL;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}
