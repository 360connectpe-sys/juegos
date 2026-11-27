import { BatchedMesh, type BufferGeometry, Group, InstancedMesh, Matrix4, MeshLambertMaterial } from 'three';
import type { ItemKind, Rarity } from '@shared/items';
import { box, merge } from '../world/geometry';

/**
 * Modelos low poly de lo que se lleva en la mano (armas, hacha, botiquín),
 * con color por vértice y una franja del color de la rareza. Eje del arma: +Z
 * adelante, +Y arriba, empuñadura en el origen.
 */
export type HeldKind = Extract<ItemKind, 'axe' | 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'medkit'>;
export const HELD_KINDS: readonly HeldKind[] = ['axe', 'pistol', 'smg', 'shotgun', 'rifle', 'medkit'];

export const RARITY_COLOR: Record<Rarity, string> = { common: '#a7adb4', rare: '#3d8bff', epic: '#b45cff' };

const METAL = '#5a616a';
const DARK = '#33383e';
const WOOD = '#8b5a2b';

/** Boca del cañón en coordenadas del arma (para fogonazos y trazadoras). */
export const MUZZLE: Record<HeldKind, number> = { axe: 0.55, pistol: 0.24, smg: 0.44, shotgun: 0.72, rifle: 0.82, medkit: 0.1 };

export function heldGeometry(kind: HeldKind, rarity: Rarity): BufferGeometry {
  const accent = RARITY_COLOR[rarity];
  switch (kind) {
    case 'pistol':
      return merge([
        box(0.07, 0.09, 0.24, METAL, 0, 0.05, 0.1),
        box(0.05, 0.13, 0.07, DARK, 0, -0.03, 0, 0, -0.25),
        box(0.072, 0.02, 0.1, accent, 0, 0.1, 0.12),
      ]);
    case 'smg':
      return merge([
        box(0.08, 0.1, 0.36, METAL, 0, 0.05, 0.14),
        box(0.035, 0.035, 0.1, DARK, 0, 0.06, 0.37),
        box(0.045, 0.16, 0.06, DARK, 0, -0.07, 0.16),
        box(0.05, 0.12, 0.06, DARK, 0, -0.03, 0, 0, -0.2),
        box(0.05, 0.06, 0.16, DARK, 0, 0.03, -0.1),
        box(0.082, 0.025, 0.14, accent, 0, 0.1, 0.12),
      ]);
    case 'rifle':
      return merge([
        box(0.07, 0.1, 0.5, METAL, 0, 0.05, 0.2),
        box(0.035, 0.035, 0.32, DARK, 0, 0.06, 0.62),
        box(0.05, 0.15, 0.07, DARK, 0, -0.07, 0.24),
        box(0.05, 0.12, 0.06, DARK, 0, -0.03, 0, 0, -0.2),
        box(0.06, 0.11, 0.22, WOOD, 0, 0.03, -0.14),
        box(0.045, 0.05, 0.16, DARK, 0, 0.13, 0.18),
        box(0.072, 0.025, 0.2, accent, 0, 0.1, 0.32),
      ]);
    case 'shotgun':
      return merge([
        box(0.08, 0.09, 0.3, METAL, 0, 0.05, 0.12),
        box(0.045, 0.045, 0.46, DARK, 0, 0.07, 0.48),
        box(0.04, 0.04, 0.4, DARK, 0, 0.02, 0.45),
        box(0.07, 0.06, 0.16, WOOD, 0, 0.0, 0.42),
        box(0.06, 0.11, 0.24, WOOD, 0, 0.02, -0.14),
        box(0.082, 0.025, 0.12, accent, 0, 0.1, 0.12),
      ]);
    case 'axe':
      return merge([
        box(0.04, 0.04, 0.6, WOOD, 0, 0, 0.25),
        box(0.03, 0.2, 0.14, '#c9ced4', 0, 0.06, 0.52),
        box(0.032, 0.04, 0.05, DARK, 0, 0.14, 0.55),
      ]);
    case 'medkit':
      return merge([
        box(0.22, 0.16, 0.1, '#e8eef2', 0, 0, 0.05),
        box(0.1, 0.03, 0.105, '#d63a3a', 0, 0, 0.05),
        box(0.03, 0.1, 0.105, '#d63a3a', 0, 0, 0.05),
      ]);
  }
}

export const heldKey = (kind: HeldKind, rarity: Rarity): string => `${kind}:${kind === 'axe' || kind === 'medkit' ? 'common' : rarity}`;

function allHeldGeometries(): [string, BufferGeometry][] {
  const geos: [string, BufferGeometry][] = [];
  for (const kind of HELD_KINDS)
    for (const rarity of kind === 'axe' || kind === 'medkit' ? (['common'] as const) : (['common', 'rare', 'epic'] as const))
      geos.push([heldKey(kind, rarity), heldGeometry(kind, rarity)]);
  return geos;
}

/**
 * Todo lo que se lleva en la mano de TODOS los jugadores (y el arma de 1ª
 * persona) en un BatchedMesh. En el juego se aloja en el lote de edificios
 * (mismo material de color por vértice): 0 draw calls extra. Sin anfitrión
 * (pruebas) crea su propio lote: 1 draw call.
 */
export class WeaponBatch implements HeldItemsRenderer {
  static readonly MAX = 24;
  readonly mesh: BatchedMesh;
  private readonly own: boolean;
  private readonly geometryIds = new Map<string, number>();
  private readonly owners = new Map<string, number>();
  private readonly used = new Set<string>();

  /** Capacidad que hay que reservar en el lote anfitrión. */
  static reserve(): { instances: number; vertices: number } {
    const geos = allHeldGeometries();
    const vertices = geos.reduce((n, [, g]) => n + g.getAttribute('position').count, 0);
    geos.forEach(([, g]) => g.dispose());
    return { instances: WeaponBatch.MAX, vertices };
  }

  constructor(host: BatchedMesh | null = null) {
    const geos = allHeldGeometries();
    this.own = host === null;
    if (host) {
      this.mesh = host;
      // Las armas van por todo el mapa: el lote no se descarta entero por su esfera;
      // cada instancia (edificio o arma) se sigue recortando por separado.
      host.frustumCulled = false;
      host.perObjectFrustumCulled = true;
    } else {
      const vertices = geos.reduce((n, [, g]) => n + g.getAttribute('position').count, 0);
      this.mesh = new BatchedMesh(WeaponBatch.MAX, vertices, 0, new MeshLambertMaterial({ vertexColors: true }));
      this.mesh.name = 'held-items';
      this.mesh.frustumCulled = false; // se reubican cada frame
      this.mesh.castShadow = false;
    }
    for (const [key, g] of geos) {
      this.geometryIds.set(key, this.mesh.addGeometry(g));
      g.dispose();
    }
  }

  /** ¿Comparte draw call con otro lote? */
  get hosted(): boolean {
    return !this.own;
  }

  /** Empieza un frame: lo que no se coloque en él se oculta. */
  begin(): void {
    this.used.clear();
  }

  place(owner: string, key: string, matrix: Matrix4): void {
    const geo = this.geometryIds.get(key);
    if (geo === undefined) return;
    let id = this.owners.get(owner);
    if (id === undefined) {
      if (this.owners.size >= WeaponBatch.MAX) return;
      id = this.mesh.addInstance(geo);
      this.owners.set(owner, id);
    } else {
      this.mesh.setGeometryIdAt(id, geo);
    }
    this.mesh.setMatrixAt(id, matrix);
    this.mesh.setVisibleAt(id, true);
    this.used.add(owner);
  }

  end(): void {
    for (const [owner, id] of this.owners) if (!this.used.has(owner)) this.mesh.setVisibleAt(id, false);
    if (this.own) this.mesh.visible = this.used.size > 0;
  }

  /** Quien se fue libera su instancia. */
  release(owner: string): void {
    const id = this.owners.get(owner);
    if (id === undefined) return;
    this.mesh.deleteInstance(id);
    this.owners.delete(owner);
  }

  get count(): number {
    return this.used.size;
  }

  dispose(): void {
    if (!this.own) return; // el anfitrión libera el lote
    this.mesh.removeFromParent();
    this.mesh.dispose();
    (this.mesh.material as MeshLambertMaterial).dispose();
  }
}

/** Lo mínimo que el juego usa para dibujar lo que se lleva en la mano. */
export interface HeldItemsRenderer {
  begin(): void;
  place(owner: string, key: string, matrix: Matrix4): void;
  end(): void;
  release(owner: string): void;
  readonly count: number;
  dispose(): void;
}

/**
 * Alternativa a WeaponBatch sin WEBGL_multi_draw (Safari en iOS): una
 * InstancedMesh por modelo (14 como mucho), creada al primer uso y oculta si
 * nadie lo lleva. Draw calls = modelos distintos a la vista (normalmente 1-4)
 * en vez de 1 por jugador. Sin sombras.
 */
export class InstancedHeldItems implements HeldItemsRenderer {
  static readonly MAX = 24;
  readonly root = new Group();
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly meshes = new Map<string, InstancedMesh>();
  private readonly counts = new Map<string, number>();
  private used = 0;

  constructor() {
    this.root.name = 'held-items';
  }

  begin(): void {
    for (const k of this.counts.keys()) this.counts.set(k, 0);
    this.used = 0;
  }

  place(_owner: string, key: string, matrix: Matrix4): void {
    let mesh = this.meshes.get(key);
    if (!mesh) {
      const [kind, rarity] = key.split(':') as [HeldKind, Rarity];
      if (!HELD_KINDS.includes(kind)) return;
      mesh = new InstancedMesh(heldGeometry(kind, rarity ?? 'common'), this.material, InstancedHeldItems.MAX);
      mesh.name = `held:${key}`;
      mesh.frustumCulled = false; // se reubican cada frame por todo el mapa
      mesh.count = 0;
      this.meshes.set(key, mesh);
      this.root.add(mesh);
    }
    const n = this.counts.get(key) ?? 0;
    if (n >= InstancedHeldItems.MAX) return;
    mesh.setMatrixAt(n, matrix);
    this.counts.set(key, n + 1);
    this.used++;
  }

  end(): void {
    for (const [key, mesh] of this.meshes) {
      const n = this.counts.get(key) ?? 0;
      mesh.count = n;
      mesh.visible = n > 0;
      if (n > 0) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  release(): void {
    /* sin estado por jugador: cada frame se recoloca todo */
  }

  get count(): number {
    return this.used;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const m of this.meshes.values()) {
      m.geometry.dispose();
      m.dispose();
    }
    this.meshes.clear();
    this.material.dispose();
  }
}

/** Empuñadura en el hueso del brazo derecho: mano en (0, -0,62, 0), arma a lo largo del brazo. */
export const GRIP_IN_ARM = new Matrix4().makeRotationX(Math.PI / 2).premultiply(new Matrix4().makeTranslation(0, -0.6, 0.04));
