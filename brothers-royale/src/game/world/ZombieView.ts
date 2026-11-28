import { BufferAttribute, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3, type BufferGeometry } from 'three';
import type { PublicZombie } from '@/physics/ZombieDirector';
import { box, merge } from './geometry';

const MAX = 16;
/** Partes: 0 cuerpo/cabeza (fijo), 1-2 brazos (izq./der.), 3-4 piernas (izq./der.). */
function part(g: BufferGeometry, limb: number): BufferGeometry {
  const n = g.getAttribute('position').count;
  g.setAttribute('limb', new BufferAttribute(new Float32Array(n).fill(limb), 1));
  return g;
}
/** Zombi low poly original: piel verde, camisa rota morada, ojos rojos, brazos al frente. */
function zombieGeometry(): BufferGeometry {
  const skin = '#86a95f', shirt = '#5d4a7a', torn = '#43355a', pants = '#34465a', eye = '#ff3b30', dark = '#2b2b2b';
  return merge([
    part(box(0.62, 0.72, 0.36, shirt, 0, 1.18, 0), 0),
    part(box(0.5, 0.18, 0.37, torn, 0.04, 0.86, 0.01), 0),
    part(box(0.48, 0.46, 0.44, skin, 0, 1.78, 0.03), 0),
    part(box(0.12, 0.07, 0.02, eye, -0.11, 1.82, 0.26), 0),
    part(box(0.12, 0.07, 0.02, eye, 0.11, 1.82, 0.26), 0),
    part(box(0.3, 0.06, 0.02, dark, 0, 1.64, 0.26), 0),
    part(box(0.18, 0.62, 0.2, skin, -0.42, 1.08, 0), 1),
    part(box(0.18, 0.62, 0.2, skin, 0.42, 1.08, 0), 2),
    part(box(0.22, 0.8, 0.24, pants, -0.15, 0.4, 0), 3),
    part(box(0.22, 0.8, 0.24, pants, 0.15, 0.4, 0), 4),
  ]);
}

/** Animación por vértice (sin esqueleto): balanceo de extremidades, golpe, ataque y caída. */
const VERTEX_HEAD = /* glsl */ `
attribute float limb;
attribute vec3 iAnim; // x = animación, y = fase de paso, z = progreso de muerte / golpe
vec3 rotX(vec3 p, float pivot, float a) { float s = sin(a), c = cos(a); float y = p.y - pivot; return vec3(p.x, pivot + y * c - p.z * s, y * s + p.z * c); }
`;
const VERTEX_BODY = /* glsl */ `
vec3 transformed = vec3(position);
float anim = iAnim.x;
float walk = sin(iAnim.y);
float moving = (anim > 0.5 && anim < 2.5) ? (anim > 1.5 ? 1.0 : 0.6) : 0.0;
float side = (limb == 1.0 || limb == 3.0) ? 1.0 : -1.0;
if (limb > 0.5 && limb < 2.5) {
  float attack = anim > 2.5 && anim < 3.5 ? -0.7 * abs(sin(iAnim.y * 2.2)) : 0.0;
  transformed = rotX(transformed, 1.36, -1.35 + 0.18 * walk * side * moving + attack);
} else if (limb > 2.5) {
  transformed = rotX(transformed, 0.8, 0.6 * walk * side * moving);
}
// Golpeado: se echa hacia atrás; muerto: cae de espaldas desde los pies.
if (anim > 3.5 && anim < 4.5) transformed = rotX(transformed, 0.0, -0.25 * iAnim.z);
if (anim > 4.5) { transformed = rotX(transformed, 0.0, -1.5 * iAnim.z); transformed.y -= 0.05 * iAnim.z; }
`;

interface Slot { num: number; pos: Vector3; target: Vector3; yaw: number; targetYaw: number; anim: number; phase: number; t: number; hp: number; seen: boolean }

/**
 * Todos los zombis en UNA InstancedMesh (1 draw call). Las extremidades se animan en el
 * shader de vértices con un atributo por instancia; las posiciones se suavizan entre los
 * snapshots del servidor (20 Hz).
 */
export class ZombieView {
  readonly mesh: InstancedMesh;
  private readonly anim: InstancedBufferAttribute;
  private readonly slots = new Map<number, Slot>();
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);
  private readonly one = new Vector3(1, 1, 1);

  constructor(shadows: boolean) {
    const geo = zombieGeometry();
    this.anim = new InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.anim.setUsage(DynamicDrawUsage);
    geo.setAttribute('iAnim', this.anim);
    const mat = new MeshLambertMaterial({ vertexColors: true });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`).replace('#include <begin_vertex>', VERTEX_BODY);
    };
    mat.customProgramCacheKey = () => 'br-zombie';
    this.mesh = new InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.visible = false; this.mesh.frustumCulled = false; this.mesh.castShadow = shadows;
  }

  /** Zombis por número (para la barra de salud y el sonido). */
  get list(): ReadonlyMap<number, Readonly<Slot>> { return this.slots; }

  /** Estado autoritativo más reciente (lista completa). */
  sync(list: readonly PublicZombie[]): void {
    for (const s of this.slots.values()) s.seen = false;
    for (const z of list) {
      let s = this.slots.get(z.num);
      if (!s) {
        s = { num: z.num, pos: new Vector3(z.x, z.y, z.z), target: new Vector3(), yaw: z.yaw, targetYaw: z.yaw, anim: z.anim, phase: Math.random() * 6, t: 0, hp: z.hp, seen: true };
        this.slots.set(z.num, s);
      }
      s.target.set(z.x, z.y, z.z); s.targetYaw = z.yaw; s.hp = z.hp; s.seen = true;
      if (z.anim !== s.anim) { s.anim = z.anim; if (z.anim !== 5) s.t = 0; }
    }
    for (const [num, s] of this.slots) if (!s.seen) this.slots.delete(num);
  }

  update(dt: number): void {
    let n = 0;
    const k = Math.min(1, dt * 12);
    for (const s of this.slots.values()) {
      if (n >= MAX) break;
      s.pos.lerp(s.target, k);
      let d = s.targetYaw - s.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      s.yaw += d * k;
      const speed = s.anim === 2 ? 9 : s.anim === 1 ? 6 : 3;
      s.phase += dt * speed;
      s.t = s.anim === 5 ? Math.min(1, s.t + dt / 0.6) : s.anim === 4 ? Math.max(0, 1 - (s.t += dt) * 4) : 0;
      this.q.setFromAxisAngle(this.up, s.yaw);
      this.m.compose(s.pos, this.q, this.one);
      this.mesh.setMatrixAt(n, this.m);
      this.anim.setXYZ(n, s.anim, s.phase, s.anim === 4 ? Math.max(0, 1 - s.t) : s.t);
      n++;
    }
    this.mesh.count = n; this.mesh.visible = n > 0;
    if (n) { this.mesh.instanceMatrix.needsUpdate = true; this.anim.needsUpdate = true; }
  }

  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); (this.mesh.material as MeshLambertMaterial).dispose(); this.mesh.dispose(); }
}
