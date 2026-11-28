import { CylinderGeometry, BatchedMesh, type BufferGeometry, Group, InstancedMesh, Matrix4, MeshLambertMaterial } from 'three';
import type { ItemKind, Rarity } from '@shared/items';
import { box, merge, paint, transform } from '../world/geometry';

/**
 * Modelos low poly de lo que se lleva en la mano (armas, hacha, botiquín),
 * con color por vértice y una franja del color de la rareza. Eje del arma: +Z
 * adelante, +Y arriba, empuñadura en el origen.
 */
export type HeldKind = Extract<ItemKind, 'axe' | 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'sniper' | 'scope2' | 'medkit'>;
export const HELD_KINDS: readonly HeldKind[] = ['axe', 'pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'scope2', 'medkit'];

export const RARITY_COLOR: Record<Rarity, string> = { common: '#a7adb4', rare: '#3d8bff', epic: '#b45cff' };

const METAL = '#5a616a';
const DARK = '#33383e';
const WOOD = '#8b5a2b';

/** Boca del cañón en coordenadas del arma (para fogonazos y trazadoras). */
export const MUZZLE: Record<HeldKind, number> = { axe: 0.66, pistol: 0.29, smg: 0.48, shotgun: 0.76, rifle: 0.84, sniper: 1.03, scope2: 0.1, medkit: 0.1 };

/** Cañones y lentes de seis lados, compartidos dentro de cada geometría fusionada. */
function barrel(radius:number,length:number,z:number,y=.07,color=DARK):BufferGeometry {
  return transform(paint(new CylinderGeometry(radius,radius,length,6),color),0,y,z,Math.PI/2,0,0);
}

function baseHeldGeometry(kind: HeldKind, rarity: Rarity): BufferGeometry {
  const accent = RARITY_COLOR[rarity];
  switch (kind) {
    case 'sniper':
      return merge([
 box(.09,.12,.46,METAL,0,.05,.19),barrel(.022,.56,.75),
 box(.075,.14,.38,WOOD,0,.015,-.21),box(.055,.13,.075,DARK,0,-.055,0,0,-.2),
 box(.055,.10,.08,DARK,0,-.07,.23),box(.092,.025,.22,accent,0,.115,.21),
 box(.04,.07,.08,DARK,0,.16,.14),barrel(.05,.32,.16,.225),barrel(.046,.008,.325,.225,'#55a3bd'),
 ]);
    case 'scope2': return merge([box(.10,.09,.22,DARK,0,.05,.1),box(.105,.075,.01,'#55a3bd',0,.05,.22)]);
    case 'pistol':
      return merge([
 box(.085,.095,.30,METAL,0,.065,.13),barrel(.023,.08,.25,.065),
 box(.065,.17,.09,DARK,0,-.055,0,0,-.2),box(.08,.025,.13,accent,0,.12,.12),
 box(.018,.022,.025,DARK,0,.128,.24),box(.018,.022,.03,DARK,0,.128,.015),
 box(.065,.02,.10,DARK,0,-.07,.08),
 ]);
    case 'smg':
      return merge([
 box(.095,.12,.34,METAL,0,.06,.14),barrel(.027,.16,.40),
 box(.06,.19,.075,DARK,0,-.08,.19),box(.055,.14,.08,DARK,0,-.04,0),
 box(.055,.045,.18,DARK,0,.045,-.12),box(.10,.03,.16,accent,0,.13,.12),
 box(.055,.10,.07,DARK,0,-.02,.32),box(.04,.025,.06,DARK,0,.145,.29),
 ]);
    case 'rifle':
      return merge([
 box(.085,.12,.43,METAL,0,.06,.2),barrel(.023,.36,.66),
 box(.08,.055,.25,DARK,0,.045,.45),box(.065,.16,.09,DARK,0,-.07,.23,0,.16),
 box(.065,.10,.11,DARK,0,-.15,.24,0,.3),box(.06,.13,.075,DARK,0,-.04,0,0,-.2),
 box(.07,.12,.25,WOOD,0,.035,-.14),box(.09,.028,.20,accent,0,.13,.22),
 box(.025,.04,.025,DARK,0,.1,.67),
 ]);
    case 'shotgun':
      return merge([
 box(.095,.105,.30,METAL,0,.055,.12),barrel(.031,.48,.52,.08),barrel(.025,.43,.49,.01),
 box(.10,.075,.20,WOOD,0,.005,.40),box(.08,.13,.27,WOOD,0,.02,-.16),
 box(.06,.12,.07,DARK,0,-.035,0,0,-.2),box(.10,.022,.13,accent,0,.118,.12),
 ]);
    case 'axe':
      return merge([
 box(.045,.045,.61,WOOD,0,0,.25),box(.06,.055,.16,DARK,0,0,.02),
 box(.06,.17,.14,METAL,0,.04,.52),box(.035,.26,.12,'#c9ced4',0,.10,.57,0,-.18),
 box(.065,.04,.07,accent,0,-.015,.49),
 ]);
    case 'medkit':
      return merge([
        box(0.22, 0.16, 0.1, '#e8eef2', 0, 0, 0.05),
        box(0.1, 0.03, 0.105, '#d63a3a', 0, 0, 0.05),
        box(0.03, 0.1, 0.105, '#d63a3a', 0, 0, 0.05),
      ]);
  }
}

export function heldGeometry(kind: HeldKind, rarity: Rarity, scope?: 'x2'): BufferGeometry {
  const base = baseHeldGeometry(kind,rarity);
  if(!scope || !['pistol','smg','rifle','shotgun'].includes(kind)) return base;
  return merge([base,box(.04,.06,.08,DARK,0,.15,.12),box(.08,.07,.19,DARK,0,.20,.12),box(.082,.06,.01,'#55a3bd',0,.20,.22)]);
}
export const heldKey = (kind: HeldKind, rarity: Rarity, scope?: 'x2'): string => `${kind}:${kind === 'axe' || kind === 'medkit' || kind === 'scope2' ? 'common' : rarity}${scope ? ':x2' : ''}`;

function allHeldGeometries(): [string, BufferGeometry][] {
  const geos: [string, BufferGeometry][] = [];
  for (const kind of HELD_KINDS)
    for (const rarity of kind === 'axe' || kind === 'medkit' || kind === 'scope2' ? (['common'] as const) : (['common', 'rare', 'epic'] as const))
      {
        geos.push([heldKey(kind, rarity), heldGeometry(kind, rarity)]);
        if(['pistol','smg','rifle','shotgun'].includes(kind)) geos.push([heldKey(kind,rarity,'x2'),heldGeometry(kind,rarity,'x2')]);
      }
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
      const [kind, rarity, scope] = key.split(':') as [HeldKind, Rarity, 'x2' | undefined];
      if (!HELD_KINDS.includes(kind)) return;
      mesh = new InstancedMesh(heldGeometry(kind, rarity ?? 'common', scope), this.material, InstancedHeldItems.MAX);
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
