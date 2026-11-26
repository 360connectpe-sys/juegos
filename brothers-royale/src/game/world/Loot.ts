import { Color, Euler, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3 } from 'three';
import { BoxGeometry } from 'three';
import { ITEMS, type ItemKind, type ItemStack } from '@shared/items';
import type { Pickup } from '@shared/match/MatchState';
import type { ChestPlacement } from '@shared/world/layout';
import { CHEST } from '@shared/world/structures';
import { box, merge, paint, transform } from './geometry';

/** Material compartido por cofres y objetos (color por vértice + tinte por instancia). */
let lootMaterial: MeshLambertMaterial | null = null;
const material = () => (lootMaterial ??= new MeshLambertMaterial({ vertexColors: true }));

const LID_OPEN = 1.9; // rad
const HINGE = new Vector3(0, CHEST.height * 0.68, -CHEST.depth / 2);

/**
 * Todos los cofres del mapa con 2 InstancedMesh (cuerpo y tapa): 2 draw
 * calls tengan los cofres que tengan. Al abrirse, la tapa gira sobre su
 * bisagra durante 0,4 s; solo se actualizan los que se están animando.
 */
export class ChestView {
  readonly body: InstancedMesh;
  readonly lid: InstancedMesh;
  private readonly base: Matrix4[];
  private readonly angle: number[];
  private readonly target: number[];
  private readonly m = new Matrix4();
  private readonly hinge = new Matrix4();
  private readonly rot = new Matrix4();

  constructor(readonly chests: readonly ChestPlacement[], castShadow: boolean) {
    const bodyH = HINGE.y;
    const bodyGeo = merge([
      box(CHEST.width, bodyH, CHEST.depth, '#8b5a2b', 0, bodyH / 2, 0),
      box(CHEST.width + 0.02, 0.06, CHEST.depth + 0.02, '#5e3b1c', 0, 0.03, 0),
      box(0.08, bodyH + 0.01, CHEST.depth + 0.03, '#d9b44a', -CHEST.width * 0.32, bodyH / 2, 0),
      box(0.08, bodyH + 0.01, CHEST.depth + 0.03, '#d9b44a', CHEST.width * 0.32, bodyH / 2, 0),
    ]);
    const lidH = CHEST.height - bodyH;
    // Tapa con el pivote en la bisagra (borde trasero superior).
    const lidGeo = merge([
      box(CHEST.width + 0.02, lidH, CHEST.depth + 0.02, '#a06a35', 0, lidH / 2, CHEST.depth / 2),
      box(0.16, 0.14, 0.04, '#e8c35a', 0, 0.02, CHEST.depth + 0.02),
      box(0.08, lidH + 0.01, CHEST.depth + 0.04, '#d9b44a', -CHEST.width * 0.32, lidH / 2, CHEST.depth / 2),
      box(0.08, lidH + 0.01, CHEST.depth + 0.04, '#d9b44a', CHEST.width * 0.32, lidH / 2, CHEST.depth / 2),
    ]);
    const n = Math.max(chests.length, 1);
    this.body = new InstancedMesh(bodyGeo, material(), n);
    this.lid = new InstancedMesh(lidGeo, material(), n);
    this.body.name = 'chests';
    this.lid.name = 'chest-lids';
    this.body.count = this.lid.count = chests.length;
    this.base = chests.map((c) => new Matrix4().compose(new Vector3(c.x, c.y, c.z), new Quaternion().setFromEuler(new Euler(0, c.yaw, 0)), new Vector3(1, 1, 1)));
    this.angle = chests.map(() => 0);
    this.target = chests.map(() => 0);
    this.hinge.makeTranslation(HINGE.x, HINGE.y, HINGE.z);
    chests.forEach((_, i) => {
      this.body.setMatrixAt(i, this.base[i]!);
      this.writeLid(i);
    });
    this.body.instanceMatrix.needsUpdate = true;
    this.lid.instanceMatrix.needsUpdate = true;
    void castShadow;
    for (const mesh of [this.body, this.lid]) {
      // Los cofres son bajos: su sombra apenas se ve y costaría 2 draw calls más.
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      mesh.matrixAutoUpdate = false;
    }
  }

  /** Los cofres no proyectan sombra en ninguna calidad (ver constructor). */
  set castShadow(_v: boolean) {
    this.body.castShadow = this.lid.castShadow = false;
  }

  private writeLid(i: number): void {
    this.rot.makeRotationX(-this.angle[i]!);
    this.m.multiplyMatrices(this.base[i]!, this.hinge).multiply(this.rot);
    this.lid.setMatrixAt(i, this.m);
  }

  /** Estado de todos los cofres (al cambiar de sesión). `instant` sin animación. */
  sync(opened: readonly boolean[], instant = true): void {
    opened.forEach((o, i) => this.setOpened(i, o, instant));
  }

  setOpened(id: number, open: boolean, instant = false): void {
    if (id < 0 || id >= this.chests.length) return;
    this.target[id] = open ? LID_OPEN : 0;
    if (instant) {
      this.angle[id] = this.target[id]!;
      this.writeLid(id);
      this.lid.instanceMatrix.needsUpdate = true;
    }
  }

  /** Anima las tapas que se están abriendo (normalmente ninguna: coste 0). */
  update(dt: number): void {
    let changed = false;
    for (let i = 0; i < this.angle.length; i++) {
      const a = this.angle[i]!;
      const t = this.target[i]!;
      if (a === t) continue;
      const step = (LID_OPEN / 0.4) * dt;
      this.angle[i] = Math.abs(t - a) <= step ? t : a + Math.sign(t - a) * step;
      this.writeLid(i);
      changed = true;
    }
    if (changed) this.lid.instanceMatrix.needsUpdate = true;
  }
}

type Category = 'weapon' | 'ammo' | 'heal';
const RARITY_TINT: Record<string, string> = { common: '#c9ced6', rare: '#4d9de0', epic: '#b35cff' };
const AMMO_TINT: Partial<Record<ItemKind, string>> = { ammo_light: '#f2c94c', ammo_medium: '#6fcf97', ammo_shells: '#eb5757' };

export function pickupTint(item: ItemStack): Color {
  if (item.rarity) return new Color(RARITY_TINT[item.rarity] ?? '#ffffff');
  return new Color(AMMO_TINT[item.kind] ?? '#ffffff');
}

const categoryOf = (item: ItemStack): Category => {
  const c = ITEMS[item.kind].category;
  return c === 'weapon' ? 'weapon' : c === 'ammo' ? 'ammo' : 'heal';
};

/**
 * Objetos en el suelo: 3 InstancedMesh (armas, munición, botiquines) con
 * color por instancia (rareza o tipo de munición). Giran y flotan un poco
 * para verse; se recolocan como mucho unas decenas por frame.
 */
export class PickupView {
  static readonly CAPACITY = 192;
  readonly meshes: Record<Category, InstancedMesh>;
  private readonly slots: Record<Category, number[]> = { weapon: [], ammo: [], heal: [] };
  private readonly where = new Map<number, { cat: Category; index: number; p: Pickup }>();
  private time = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly one = new Vector3(1, 1, 1);
  private readonly up = new Vector3(0, 1, 0);

  constructor() {
    const weapon = merge([box(0.75, 0.13, 0.16, '#ffffff', 0, 0, 0), box(0.14, 0.24, 0.12, '#5b4636', -0.18, -0.15, 0), box(0.12, 0.1, 0.1, '#3a3a3a', 0.36, 0.02, 0)]);
    const ammo = merge([box(0.32, 0.22, 0.22, '#ffffff', 0, 0, 0), box(0.34, 0.05, 0.24, '#3a3a3a', 0, 0.09, 0)]);
    const heal = merge([
      transform(paint(new BoxGeometry(0.38, 0.26, 0.3), '#ffffff'), 0, 0, 0),
      box(0.22, 0.06, 0.02, '#e04848', 0, 0, 0.16),
      box(0.06, 0.2, 0.02, '#e04848', 0, 0, 0.16),
    ]);
    const make = (geo: typeof weapon, name: string) => {
      const mesh = new InstancedMesh(geo, material(), PickupView.CAPACITY);
      mesh.count = 0;
      mesh.visible = false; // sin objetos no se dibuja (ni gasta draw call en la pasada de sombras)
      mesh.name = name;
      mesh.frustumCulled = false; // los objetos están repartidos; son 3 draw calls como mucho
      mesh.setColorAt(0, new Color(1, 1, 1));
      return mesh;
    };
    this.meshes = { weapon: make(weapon, 'pickups-weapons'), ammo: make(ammo, 'pickups-ammo'), heal: make(heal, 'pickups-heal') };
  }

  get size(): number {
    return this.where.size;
  }

  reset(pickups: Iterable<Pickup>): void {
    this.where.clear();
    for (const c of Object.keys(this.slots) as Category[]) {
      this.slots[c] = [];
      this.meshes[c].count = 0;
      this.meshes[c].visible = false;
    }
    for (const p of pickups) this.add(p);
  }

  add(p: Pickup): void {
    if (this.where.has(p.id)) return this.update(p);
    const cat = categoryOf(p.item);
    const list = this.slots[cat];
    if (list.length >= PickupView.CAPACITY) return; // nunca pasa en una partida normal
    const index = list.length;
    list.push(p.id);
    this.where.set(p.id, { cat, index, p });
    const mesh = this.meshes[cat];
    mesh.count = list.length;
    mesh.visible = true;
    mesh.setColorAt(index, pickupTint(p.item));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.place(p.id);
  }

  update(p: Pickup): void {
    const w = this.where.get(p.id);
    if (!w) return this.add(p);
    w.p = p;
  }

  remove(id: number): void {
    const w = this.where.get(id);
    if (!w) return;
    const list = this.slots[w.cat];
    const mesh = this.meshes[w.cat];
    const lastId = list[list.length - 1]!;
    // Intercambio con el último: sin huecos ni recrear buffers.
    if (lastId !== id) {
      list[w.index] = lastId;
      const last = this.where.get(lastId)!;
      last.index = w.index;
      mesh.setColorAt(w.index, pickupTint(last.p.item));
      this.place(lastId);
    }
    list.pop();
    mesh.count = list.length;
    mesh.visible = list.length > 0;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.where.delete(id);
  }

  private place(id: number): void {
    const w = this.where.get(id)!;
    const spin = this.time * 1.6 + id;
    this.q.setFromAxisAngle(this.up, spin);
    this.v.set(w.p.x, w.p.y + 0.35 + Math.sin(this.time * 2.4 + id) * 0.06, w.p.z);
    this.m.compose(this.v, this.q, this.one);
    this.meshes[w.cat].setMatrixAt(w.index, this.m);
    this.meshes[w.cat].instanceMatrix.needsUpdate = true;
  }

  /** Giro y flotación de los objetos visibles (cada frame). */
  animate(dt: number): void {
    this.time += dt;
    for (const id of this.where.keys()) this.place(id);
  }
}
