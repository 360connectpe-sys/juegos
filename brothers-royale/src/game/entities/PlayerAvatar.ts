import { SHIRTS } from '@shared/lobby/profile';
import {
  Bone,
  type BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Skeleton,
  SkinnedMesh,
  Sphere,
  Uint16BufferAttribute,
  Vector3,
} from 'three';
import { PLAYER } from '@shared/constants';
import { damp, wrapAngle } from '@shared/math';
import type { Locomotion, PlayerState } from '@shared/types';
import { unpackGear, type Gear } from '@shared/combat/gear';
import { box, merge, paint, transform } from '../world/geometry';

export interface AvatarColors {
  shirt: string;
  pants: string;
  skin: string;
  hair: string;
}

export const DEFAULT_COLORS: AvatarColors = { shirt: '#ff8c1a', pants: '#2b3a67', skin: '#f1c27d', hair: '#3b2416' };

/** Paleta para distinguir jugadores en línea (índice = color del roster). */
export const AVATAR_PALETTE: readonly AvatarColors[] = SHIRTS.map(([,shirt]) => ({...DEFAULT_COLORS,shirt}));

export const paletteColors = (index: number): AvatarColors => AVATAR_PALETTE[((index % AVATAR_PALETTE.length) + AVATAR_PALETTE.length) % AVATAR_PALETTE.length]!;

/** Pose objetivo de cada locomoción (ángulos en rad). Datos, no código. */
interface Pose {
  armSwing: number;
  legSwing: number;
  /** Frecuencia de zancada por m/s. */
  cadence: number;
  lean: number;
  armsUp: number;
  legsTuck: number;
  bob: number;
}

const POSE_KEYS: (keyof Pose)[] = ['armSwing', 'legSwing', 'cadence', 'lean', 'armsUp', 'legsTuck', 'bob'];

const POSES: Record<Locomotion, Pose> = {
  idle: { armSwing: 0.05, legSwing: 0, cadence: 0, lean: 0, armsUp: 0, legsTuck: 0, bob: 0.02 },
  walk: { armSwing: 0.7, legSwing: 0.75, cadence: 2.1, lean: 0.06, armsUp: 0, legsTuck: 0, bob: 0.05 },
  run: { armSwing: 1.1, legSwing: 1.0, cadence: 1.75, lean: 0.22, armsUp: 0.2, legsTuck: 0, bob: 0.09 },
  jump: { armSwing: 0, legSwing: 0, cadence: 0, lean: 0.05, armsUp: 2.4, legsTuck: 0.6, bob: 0 },
  fall: { armSwing: 0, legSwing: 0, cadence: 0, lean: -0.05, armsUp: 1.3, legsTuck: 0.25, bob: 0 },
};

// ---------------------------------------------------------------------------
// Recursos compartidos por TODOS los avatares (fase 3.2)
// ---------------------------------------------------------------------------

/** Huesos del esqueleto rígido (índice = skinIndex de los vértices). */
const BONE = { root: 0, body: 1, armL: 2, armR: 3, legL: 4, legR: 5 } as const;

/** Un solo material para todos los avatares: un único programa de shader. */
let sharedMaterial: MeshLambertMaterial | null = null;
const geometryCache = new Map<string, BufferGeometry>();

function avatarMaterial(): MeshLambertMaterial {
  sharedMaterial ??= new MeshLambertMaterial({ vertexColors: true });
  return sharedMaterial;
}

/** Asigna todos los vértices de una pieza a un hueso (peso 1: piezas rígidas). */
function bind(geo: BufferGeometry, bone: number): BufferGeometry {
  const n = geo.getAttribute('position').count;
  const idx = new Uint16Array(n * 4);
  const w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    idx[i * 4] = bone;
    w[i * 4] = 1;
  }
  geo.setAttribute('skinIndex', new Uint16BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new Float32BufferAttribute(w, 4));
  return geo;
}

/**
 * Geometría del personaje en pose de reposo, con todas las piezas fusionadas
 * en UNA malla (1 draw call) y cada pieza ligada a su hueso. Se cachea por
 * paleta: 8 jugadores con 8 colores = como mucho 8 geometrías pequeñas.
 */
export function avatarGeometry(colors: AvatarColors): BufferGeometry {
  const key = `${colors.shirt}|${colors.pants}|${colors.skin}|${colors.hair}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;
  // Fase 15: personaje low poly propio menos cuadrado (cilindros de 7 lados y cabeza
  // facetada) con las MISMAS alturas, huesos y anchura: hitbox, armas y animaciones intactas.
  const cyl = (rt: number, rb: number, h: number, color: string, x: number, y: number, z = 0, sz = 1) => {
    const g = paint(new CylinderGeometry(rt, rb, h, 7), color);
    if (sz !== 1) g.scale(1, 1, sz);
    return transform(g, x, y, z);
  };
  const ball = (r: number, color: string, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
    const g = paint(new IcosahedronGeometry(r, 1), color);
    g.scale(sx, sy, sz);
    return transform(g, x, y, z);
  };
  const parts = [
    // Cadera, torso (más ancho en los hombros), hombros, cuello, cabeza, pelo, rostro y mochila → "body"
    bind(cyl(0.2, 0.21, 0.2, colors.pants, 0, 0.84, 0, 0.75), BONE.body),
    bind(cyl(0.29, 0.22, 0.62, colors.shirt, 0, 1.14, 0, 0.66), BONE.body),
    bind(ball(0.11, colors.shirt, -0.3, 1.4, 0, 1, 0.8, 1), BONE.body),
    bind(ball(0.11, colors.shirt, 0.3, 1.4, 0, 1, 0.8, 1), BONE.body),
    bind(cyl(0.075, 0.085, 0.14, colors.skin, 0, 1.5, 0), BONE.body),
    bind(ball(0.24, colors.skin, 0, 1.73, 0.01, 0.95, 1.05, 0.95), BONE.body),
    bind(ball(0.25, colors.hair, 0, 1.82, -0.03, 1, 0.62, 1), BONE.body),
    bind(box(0.4, 0.22, 0.08, colors.hair, 0, 1.73, -0.19), BONE.body),
    bind(box(0.07, 0.07, 0.02, '#1d1d1d', -0.09, 1.75, 0.225), BONE.body),
    bind(box(0.07, 0.07, 0.02, '#1d1d1d', 0.09, 1.75, 0.225), BONE.body),
    bind(box(0.05, 0.07, 0.05, colors.skin, 0, 1.69, 0.235), BONE.body),
    bind(box(0.12, 0.025, 0.02, '#8a4b3a', 0, 1.62, 0.22), BONE.body),
    bind(box(0.4, 0.46, 0.18, '#4c8c4a', 0, 1.16, -0.24), BONE.body),
    bind(box(0.42, 0.08, 0.2, '#3a6f39', 0, 1.4, -0.24), BONE.body),
  ];
  // Brazos (hombro en y = 1,45): brazo, antebrazo y mano. Piernas (cadera en y = 0,8): muslo, pierna y calzado.
  for (const [sx, bone] of [[-1, BONE.armL], [1, BONE.armR]] as const) {
    parts.push(bind(cyl(0.08, 0.07, 0.32, colors.shirt, sx * 0.39, 1.45 - 0.17), bone));
    parts.push(bind(cyl(0.065, 0.058, 0.26, colors.skin, sx * 0.41, 1.45 - 0.45), bone));
    parts.push(bind(ball(0.07, colors.skin, sx * 0.41, 1.45 - 0.62, 0.01, 0.9, 1, 1.1), bone));
  }
  for (const [sx, bone] of [[-1, BONE.legL], [1, BONE.legR]] as const) {
    parts.push(bind(cyl(0.11, 0.09, 0.42, colors.pants, sx * 0.13, 0.58), bone));
    parts.push(bind(cyl(0.09, 0.075, 0.38, colors.pants, sx * 0.13, 0.2), bone));
    parts.push(bind(box(0.15, 0.09, 0.27, '#2a2a33', sx * 0.13, 0.045, 0.04), bone));
  }
  const geo = merge(parts);
  geometryCache.set(key, geo);
  return geo;
}

/** Libera los recursos compartidos (al destruir el juego). Se recrean si hacen falta. */
export function disposeAvatarResources(): void {
  for (const g of geometryCache.values()) g.dispose();
  geometryCache.clear();
  sharedMaterial?.dispose();
  sharedMaterial = null;
}

/** Radio generoso para el recorte por frustum (incluye brazos levantados). */
const CULL_SPHERE = new Sphere(new Vector3(0, 1, 0), 1.5);

/**
 * Personaje provisional low poly como SkinnedMesh rígida: 1 draw call (+1 en
 * el pase de sombras) en lugar de 6. Solo es la VISTA: el estado viene de un
 * PlayerState (local o remoto) y se interpola entre ticks.
 */
export class PlayerAvatar {
  readonly root = new Group();
  readonly mesh: SkinnedMesh;
  private readonly bones: Bone[];
  private readonly prev = new Vector3();
  private readonly curr = new Vector3();
  /**
   * Fase 15 (H16): error visual de una corrección del servidor. La simulación ya está
   * corregida; solo el dibujo absorbe el salto y lo reduce en ~0,1 s (sin retrasar controles).
   */
  private readonly smooth = new Vector3();
  /** Suaviza una corrección (dx, dy, dz = posición nueva − anterior). Saltos grandes = teletransporte. */
  absorbCorrection(dx: number, dy: number, dz: number): void {
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return;
    if (d > 2.5) { this.smooth.set(0, 0, 0); return; }
    this.smooth.x -= dx; this.smooth.y -= dy; this.smooth.z -= dz;
  }
  private prevYaw = 0;
  private currYaw = 0;
  private phase = 0;
  private speed = 0;
  private locomotion: Locomotion = 'idle';
  private landTimer = 0;
  private time = 0;
  /** Pose actual suavizada. */
  private readonly pose: Pose = { ...POSES.idle };
  readonly velocity = new Vector3();
  /** Combate visible (arma en mano, acción, eliminado). */
  gear: Gear = unpackGear(0);
  private gearRaw = -1;
  /** Mezcla 0..1 de la pose de combate y temporizadores de animación. */
  private hold = 0;
  private kickT = 0;
  private swingT = 0;
  private deadT = 0;

  /**
   * @param colors Colores del personaje (o índice de la paleta).
   * @param castShadow Proyecta sombra real (calidad Normal).
   */
  constructor(colors: AvatarColors | number = DEFAULT_COLORS, castShadow = true) {
    const c = typeof colors === 'number' ? paletteColors(colors) : colors;
    const bones = Array.from({ length: 6 }, () => new Bone());
    const [root, body, armL, armR, legL, legR] = bones as [Bone, Bone, Bone, Bone, Bone, Bone];
    body.position.set(0, 0.8, 0);
    armL.position.set(-0.41, 0.65, 0);
    armR.position.set(0.41, 0.65, 0);
    legL.position.set(-0.15, 0.8, 0);
    legR.position.set(0.15, 0.8, 0);
    root.add(body, legL, legR);
    body.add(armL, armR);
    this.bones = bones;

    this.mesh = new SkinnedMesh(avatarGeometry(c), avatarMaterial());
    this.mesh.add(root);
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new Skeleton(bones));
    this.mesh.boundingSphere = CULL_SPHERE.clone();
    this.mesh.castShadow = castShadow;
    this.mesh.name = 'avatar';
    this.root.add(this.mesh);
    this.root.name = 'player-avatar';
  }

  set castShadow(v: boolean) {
    this.mesh.castShadow = v;
  }

  /** Recibe el estado tras un tick de simulación. */
  pushState(s: PlayerState, snap = false): void {
    // Aterrizaje detectado desde el propio estado (sirve igual para jugadores remotos).
    const wasAirborne = this.locomotion === 'jump' || this.locomotion === 'fall';
    const impactSpeed = -this.velocity.y;
    const landed = wasAirborne && s.grounded;
    if (snap) this.prev.set(s.position.x, s.position.y, s.position.z);
    else this.prev.copy(this.curr);
    this.prevYaw = snap ? s.yaw : this.currYaw;
    this.curr.set(s.position.x, s.position.y, s.position.z);
    this.currYaw = s.yaw;
    this.velocity.set(s.velocity.x, s.velocity.y, s.velocity.z);
    this.speed = Math.hypot(s.velocity.x, s.velocity.z);
    this.locomotion = s.locomotion;
    this.setGear(s.gear ?? 0);
    if (landed && impactSpeed > 4) this.landTimer = Math.min(0.22, 0.08 + impactSpeed * 0.012);
  }

  /** Estado de combate visible (empaquetado). */
  setGear(raw: number): void {
    if (raw === this.gearRaw) return;
    const prev = this.gear;
    this.gearRaw = raw;
    this.gear = unpackGear(raw);
    if (this.gear.action === 'melee' && prev.action !== 'melee') this.swingT = 0.3;
  }

  /** Retroceso de un disparo (lo dispara el evento del servidor o la predicción local). */
  kick(): void {
    this.kickT = 0.12;
  }

  /** Golpe de hacha (evento). */
  swing(): void {
    this.swingT = 0.3;
  }

  /**
   * Interpola entre los dos últimos ticks y anima.
   * @param animate false si está fuera de cámara: solo se mueve, no se calcula la pose.
   */
  render(alpha: number, dt: number, animate = true): void {
    this.root.position.lerpVectors(this.prev, this.curr, alpha);
    if (this.smooth.x !== 0 || this.smooth.y !== 0 || this.smooth.z !== 0) {
      this.root.position.add(this.smooth);
      const k = Math.exp(-dt / 0.06); // ≈95 % absorbido en 0,18 s
      this.smooth.multiplyScalar(k);
      if (this.smooth.lengthSq() < 1e-6) this.smooth.set(0, 0, 0);
    }
    this.root.rotation.y = this.prevYaw + wrapAngle(this.currYaw - this.prevYaw) * alpha;
    this.time += dt;
    if (!animate) {
      this.landTimer = 0;
      return;
    }

    // Mezcla suave hacia la pose de la locomoción actual.
    const target = POSES[this.locomotion];
    const p = this.pose;
    for (const key of POSE_KEYS) p[key] = damp(p[key], target[key], 12, dt);

    this.phase += dt * this.speed * p.cadence;
    const s = Math.sin(this.phase);
    const amp = Math.min(this.speed / PLAYER.walkSpeed, 1.2);
    const legSwing = s * p.legSwing * amp;
    const armSwing = s * p.armSwing * amp;
    const idleBreath = this.locomotion === 'idle' ? Math.sin(this.time * 2.2) : 0;
    // Acceso por índice: desestructurar un array usa el iterador (basura por frame).
    const b = this.bones;
    const root = b[0]!, body = b[1]!, armL = b[2]!, armR = b[3]!, legL = b[4]!, legR = b[5]!;

    legL.rotation.x = legSwing - p.legsTuck;
    legR.rotation.x = -legSwing - p.legsTuck * 0.4;
    armL.rotation.x = -armSwing - p.armsUp;
    armR.rotation.x = armSwing - p.armsUp;
    armL.rotation.z = -0.05 - idleBreath * 0.03 - p.armsUp * 0.12;
    armR.rotation.z = 0.05 + idleBreath * 0.03 + p.armsUp * 0.12;
    body.rotation.x = p.lean;

    // Rebote al caminar/correr + respiración en reposo.
    let bob = Math.abs(Math.cos(this.phase)) * p.bob * amp + idleBreath * p.bob * 0.5;
    // Aplastamiento al aterrizar.
    let squash = 1;
    if (this.landTimer > 0) {
      this.landTimer = Math.max(0, this.landTimer - dt);
      const t = this.landTimer / 0.22;
      squash = 1 - Math.sin(t * Math.PI) * 0.18;
      bob -= (1 - squash) * 0.5;
    }
    root.position.y = bob;
    root.scale.set(2 - squash, squash, 2 - squash);
    this.combatPose(dt);
  }

  /**
   * Capa de combate sobre la locomoción: brazos al frente con arma, retroceso
   * al disparar, recarga, hachazo, botiquín y caída al ser eliminado.
   */
  private combatPose(dt: number): void {
    const g = this.gear;
    const b = this.bones;
    const root = b[0]!, body = b[1]!, armL = b[2]!, armR = b[3]!;
    this.deadT = damp(this.deadT, g.dead ? 1 : 0, 10, dt);
    root.rotation.x = -this.deadT * 1.45;
    root.position.y += this.deadT * 0.25;
    if (this.deadT > 0.5) return;
    const gun = g.held === 'pistol' || g.held === 'smg' || g.held === 'rifle' || g.held === 'shotgun' || g.held === 'sniper';
    const holding = gun || g.held === 'axe' || g.held === 'medkit';
    this.hold = damp(this.hold, holding ? 1 : 0, 14, dt);
    this.kickT = Math.max(0, this.kickT - dt);
    this.swingT = Math.max(0, this.swingT - dt);
    const w = this.hold;
    if (w < 0.01) return;
    const mix = (cur: number, target: number) => cur + (target - cur) * w;
    if (gun) {
      const reload = g.action === 'reload';
      const kick = (this.kickT / 0.12) * (g.held === 'sniper' ? 0.6 : g.held === 'shotgun' ? 0.45 : 0.22);
      const t = this.time * (g.held === 'sniper' ? 5 : 9);
      armR.rotation.x = mix(armR.rotation.x, reload ? -0.7 + Math.sin(t) * 0.12 : -Math.PI / 2 - kick);
      armR.rotation.z = mix(armR.rotation.z, 0.08);
      armL.rotation.x = mix(armL.rotation.x, reload ? -1.0 - Math.sin(t) * 0.2 : -Math.PI / 2 * 0.92 - kick * 0.6);
      armL.rotation.z = mix(armL.rotation.z, reload ? -0.3 : -0.55);
      body.rotation.x = mix(body.rotation.x, reload ? 0.12 : 0.04);
    } else if (g.held === 'axe') {
      // Hachazo de arriba abajo en 0,3 s; en reposo, el hacha delante.
      const k = this.swingT > 0 ? 1 - this.swingT / 0.3 : 1;
      const swing = this.swingT > 0 ? -2.7 + k * 2.4 : -0.5;
      armR.rotation.x = mix(armR.rotation.x, swing);
      armR.rotation.z = mix(armR.rotation.z, 0.1);
    } else if (g.held === 'medkit') {
      const heal = g.action === 'heal';
      const t = this.time * 6;
      armR.rotation.x = mix(armR.rotation.x, heal ? -1.0 + Math.sin(t) * 0.1 : -0.7);
      armL.rotation.x = mix(armL.rotation.x, heal ? -1.0 - Math.sin(t) * 0.1 : armL.rotation.x);
      armL.rotation.z = mix(armL.rotation.z, heal ? -0.45 : armL.rotation.z);
    }
  }

  /** Hueso del brazo derecho (para colocar lo que lleva en la mano). */
  get handBone(): Bone {
    return this.bones[3]!;
  }

  /** Eliminado (y casi en el suelo): no se dibuja lo que llevaba en la mano. */
  get downed(): boolean {
    return this.deadT > 0.5;
  }

  get position(): Vector3 {
    return this.root.position;
  }

  /** Retira el avatar de la escena. La geometría y el material son compartidos: no se liberan aquí. */
  dispose(): void {
    this.root.removeFromParent();
    this.mesh.skeleton.dispose();
  }
}

/**
 * Sombras de mancha de TODOS los personajes en un único InstancedMesh
 * (1 draw call). Se usan en calidad Baja, sin sombras reales.
 */
export class BlobShadows {
  static readonly MAX = 16;
  readonly mesh: InstancedMesh;
  private readonly m = new Matrix4();

  constructor() {
    const geo = new CircleGeometry(PLAYER.radius * 1.4, 12);
    geo.rotateX(-Math.PI / 2);
    const mat = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
    this.mesh = new InstancedMesh(geo, mat, BlobShadows.MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // se reubica cada frame; su esfera no sirve
    this.mesh.name = 'blob-shadows';
    this.mesh.renderOrder = 1;
  }

  /** Coloca una mancha bajo cada avatar. */
  update(avatars: Iterable<PlayerAvatar>): void {
    let i = 0;
    for (const a of avatars) {
      if (i >= BlobShadows.MAX) break;
      const p = a.position;
      this.m.makeTranslation(p.x, p.y + 0.03, p.z);
      this.mesh.setMatrixAt(i++, this.m);
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  set visible(v: boolean) {
    this.mesh.visible = v;
  }
}
