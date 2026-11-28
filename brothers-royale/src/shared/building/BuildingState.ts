import type { Vec3 } from '../types';
import type { PrefabDef, BoxPart, PlacedPrefab } from '../world/prefab';

export const BUILD = { size: 3, cost: 10, hp: 150, treeHp: 90, woodPerHit: 5, woodPerTree: 30, woodCap: 999, maxPieces: 128, perPlayer: 32, range: 6, height: 15 } as const;
export const BUILD_KINDS = ['wall', 'floor', 'ramp', 'roof'] as const;
export type BuildKind = typeof BUILD_KINDS[number];
export interface BuildRequest {
  kind: BuildKind; x: number; y: number; z: number; rotation: number;
  /**
   * Fase 15: panel que tapa un hueco de puerta de un edificio (índice en `buildSlots`). Su
   * posición, giro (`yaw`) y tamaño (`w`, `h`) los fija el mapa; la autoridad los compara.
   */
  slot?: number; yaw?: number; w?: number; h?: number;
}
/** Hueco de un edificio que se puede tapar con una pared a medida (puerta, boquete). */
export interface BuildSlot { x: number; y: number; z: number; yaw: number; w: number; h: number }
export interface BuildPiece extends BuildRequest { id: number; owner: string; hp: number }
export interface BuildingSnapshot { revision: number; trees: number[]; pieces: BuildPiece[]; wood: Record<string, number> }
export interface BuildingEnvironment {
  ground(x: number, z: number): number;
  clear(request: BuildRequest, feet: Vec3): boolean;
  changed(): void;
  /** Huecos tapables del mapa (deterministas: los calcula igual cliente y servidor). */
  slots?: readonly BuildSlot[];
}
export function validBuildRequest(raw: unknown): raw is BuildRequest {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as BuildRequest;
  if (!BUILD_KINDS.includes(r.kind) || ![r.x, r.y, r.z].every(Number.isFinite) || !Number.isInteger(r.rotation) || r.rotation < 0 || r.rotation >= 4) return false;
  if (r.slot !== undefined) {
    // Panel de hueco: solo paredes, tamaño acotado (la autoridad lo compara con el mapa).
    return r.kind === 'wall' && Number.isSafeInteger(r.slot) && r.slot >= 0 && r.slot < 256
      && typeof r.yaw === 'number' && Number.isFinite(r.yaw) && typeof r.w === 'number' && r.w > 0.3 && r.w <= 3.5
      && typeof r.h === 'number' && r.h > 0.5 && r.h <= 3.2;
  }
  if (r.yaw !== undefined || r.w !== undefined || r.h !== undefined) return false;
  return Math.abs(r.x / 3 - Math.round(r.x / 3)) < 1e-6 && Math.abs(r.z / 3 - Math.round(r.z / 3)) < 1e-6;
}
const part = (center: Vec3, size: Vec3, rot?: Vec3): BoxPart => ({
  kind: 'box', center, size, rot, color: '#a67545', layer: 'base', collide: true, visible: true,
});
/** Fase 15: la pared va en el BORDE +Z local de su casilla (antes en el centro: "pared a mitad de plataforma"). */
export const WALL_EDGE = BUILD.size / 2;
export function buildDef(kind: BuildKind): PrefabDef {
  let parts: BoxPart[];
  if (kind === 'wall') parts = [part({ x: 0, y: 1.5, z: WALL_EDGE }, { x: 3, y: 2.96, z: 0.16 })];
  else if (kind === 'floor') parts = [part({ x: 0, y: 0.1, z: 0 }, { x: 2.96, y: 0.16, z: 2.96 })];
  else if (kind === 'ramp') parts = [part({ x: 0, y: 1.5, z: 0 }, { x: 2.96, y: 0.16, z: Math.sqrt(18) - 0.17 }, { x: Math.PI / 4, y: 0, z: 0 })];
  else parts = [
    part({ x: -0.75, y: 0.45, z: 0 }, { x: 1.74, y: 0.16, z: 2.96 }, { x: 0, y: 0, z: Math.PI / 6 }),
    part({ x: 0.75, y: 0.45, z: 0 }, { x: 1.74, y: 0.16, z: 2.96 }, { x: 0, y: 0, z: -Math.PI / 6 }),
  ];
  return { id: 'build-' + kind, parts, clearRadius: 2.2 };
}
/** Panel a medida de un hueco: centrado en su posición, del tamaño del hueco. */
export function slotDef(w: number, h: number): PrefabDef {
  return { id: 'build-slot', parts: [part({ x: 0, y: h / 2, z: 0 }, { x: w, y: h, z: 0.16 })], clearRadius: 1 };
}
export function buildPrefab(request: BuildRequest): PlacedPrefab {
  if (request.slot !== undefined) return { def: slotDef(request.w!, request.h!), x: request.x, y: request.y, z: request.z, rotationY: request.yaw! };
  return { def: buildDef(request.kind), x: request.x, y: request.y, z: request.z, rotationY: request.rotation * Math.PI / 2 };
}
/**
 * Punto de referencia de una pieza para apoyos y duplicados: el centro de su casilla, o el
 * centro del BORDE en las paredes (así la pared es compartida por las dos casillas).
 */
export function anchorOf(p: BuildRequest): { x: number; z: number } {
  if (p.kind !== 'wall' || p.slot !== undefined) return { x: p.x, z: p.z };
  const [dx, dz] = QUADRANT_DIR[p.rotation]!;
  return { x: p.x + dx * WALL_EDGE, z: p.z + dz * WALL_EDGE };
}
/** ¿Dos paredes ocupan el mismo borde? (misma recta y mismo eje, a la misma altura). */
export function sameWall(a: BuildRequest, b: BuildRequest): boolean {
  if (a.kind !== 'wall' || b.kind !== 'wall' || Math.abs(a.y - b.y) >= 0.1) return false;
  if (a.slot !== undefined || b.slot !== undefined) return a.slot !== undefined && a.slot === b.slot;
  const ea = anchorOf(a), eb = anchorOf(b);
  return a.rotation % 2 === b.rotation % 2 && Math.abs(ea.x - eb.x) < 0.01 && Math.abs(ea.z - eb.z) < 0.01;
}
export const buildTop = (p: BuildRequest): number => p.y + (p.slot !== undefined ? p.h ?? 3 : p.kind === 'wall' || p.kind === 'ramp' ? 3 : p.kind === 'floor' ? 0.18 : 0.96);

/** Grosor del suelo: su superficie está a y + FLOOR_TOP (buildTop). */
export const FLOOR_TOP = 0.18;
/** Desnivel máximo del terreno bajo una pieza apoyada en el suelo (laderas). */
export const MAX_GROUND_SLOPE = 1.5;
/** Puntos de apoyo de una pieza en el terreno (centro y esquinas). */
const FOOTPRINT: readonly (readonly [number, number])[] = [[0, 0], [-1.3, -1.3], [1.3, 1.3], [-1.3, 1.3], [1.3, -1.3]];

/** Casilla vecina por cuadrante de orientación q: 0 = +Z, 1 = +X, 2 = −Z, 3 = −X (yaw de Three). */
export const QUADRANT_DIR: readonly (readonly [number, number])[] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/** Cuadrante (0..3) más cercano a un yaw. */
export const quadrantFromYaw = (yaw: number): number => (((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4);

/**
 * Rotación automática de una pieza según hacia dónde mira el jugador: la pared
 * de frente, la rampa subiendo hacia delante (su extremo alto está en −Z local).
 */
export const rotationForYaw = (kind: BuildKind, yaw: number): number => {
  const q = quadrantFromYaw(yaw);
  return kind === 'ramp' ? (q + 2) % 4 : q;
};

/** Dirección (x, z) en la que sube una rampa con esta rotación. */
export const rampRise = (rotation: number): readonly [number, number] => QUADRANT_DIR[(rotation + 2) % 4]!;

/** Altura del terreno bajo la huella de una pieza: [mínima, máxima]. */
export function groundRange(ground: (x: number, z: number) => number, x: number, z: number): [number, number] {
  let min = Infinity, max = -Infinity;
  for (const [dx, dz] of FOOTPRINT) {
    const h = ground(x + dx, z + dz);
    if (h < min) min = h;
    if (h > max) max = h;
  }
  return [min, max];
}

/** Huella en el terreno de una pieza: la casilla, o el borde en las paredes. */
export function pieceGroundRange(ground: (x: number, z: number) => number, p: BuildRequest): [number, number] {
  if (p.kind !== 'wall' || p.slot !== undefined) return groundRange(ground, p.x, p.z);
  const a = anchorOf(p), along = p.rotation % 2 === 0;
  let min = Infinity, max = -Infinity;
  for (const t of [-1.3, 0, 1.3]) {
    const h = ground(a.x + (along ? t : 0), a.z + (along ? 0 : t));
    if (h < min) min = h;
    if (h > max) max = h;
  }
  return [min, max];
}

/** Lo que el planificador necesita: el estado y una prueba de validez completa. */
export interface BuildPlanContext {
  pieces: Iterable<BuildPiece>;
  ground(x: number, z: number): number;
  canPlace(request: BuildRequest): boolean;
  /** Huecos tapables (puertas): la pared se ajusta a ellos si se mira uno de cerca. */
  slots?: readonly BuildSlot[];
}

export interface BuildPlan {
  request: BuildRequest;
  valid: boolean;
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

/** Ordena alturas: a la altura de los pies o por debajo (lo más alto primero), luego por encima. */
function orderHeights(heights: number[], feetY: number, surfaceOffset=0): number[] {
  const unique: number[] = [];
  for (const h of heights) if (!unique.some((u) => Math.abs(u - h) < 0.005)) unique.push(h);
  const below = (h: number) => h <= feetY + 1.2;
  return unique.sort((a,b)=>{
    if(below(a)!==below(b))return below(a)?-1:1;
    if(!below(a))return a-b;
    // Suelos: superficie a ras de los pies/rampa, antes de sumar otro grosor de 18 cm.
    return surfaceOffset ? Math.abs(a+surfaceOffset-feetY)-Math.abs(b+surfaceOffset-feetY) : b-a;
  });
}

/** Hueco de puerta al que se mira de cerca (≤ 2,8 m, delante, a la altura del jugador). */
export function slotInFront(slots: readonly BuildSlot[] | undefined, feet: Vec3, yaw: number): number | null {
  if (!slots) return null;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  let best: number | null = null, bestD = 2.8;
  slots.forEach((s, i) => {
    const dx = s.x - feet.x, dz = s.z - feet.z, d = Math.hypot(dx, dz);
    if (d > bestD || Math.abs(s.y - feet.y) > 1.0) return;
    if (d > 0.3 && (dx * fx + dz * fz) / d < 0.35) return;
    best = i; bestD = d;
  });
  return best;
}

/**
 * Elige casilla, orientación y ALTURA de una pieza sin que el jugador seleccione el nivel.
 * - Suelo, rampa y techo: la casilla vecina en la dirección de la mirada (plataformas seguidas).
 * - Pared (fase 15): el BORDE de la casilla propia en la dirección de la mirada (o el de la
 *   siguiente si ese borde está pegado al jugador); si se mira de cerca un hueco de puerta,
 *   un panel a su medida. `turn` gira la pieza en pasos de 90° antes de colocarla.
 * Puro: lo usa el cliente para la vista previa; la autoridad revalida al colocar.
 */
export function planBuild(kind: BuildKind, feet: Vec3, yaw: number, ctx: BuildPlanContext, turn = 0): BuildPlan {
  const q = quadrantFromYaw(yaw);
  const [dx, dz] = QUADRANT_DIR[q]!;
  const cx = Math.round(feet.x / BUILD.size) * BUILD.size, cz = Math.round(feet.z / BUILD.size) * BUILD.size;
  const pieces = [...ctx.pieces];
  if (kind === 'wall') {
    const slot = slotInFront(ctx.slots, feet, yaw);
    if (slot !== null) {
      const s = ctx.slots![slot]!;
      const request: BuildRequest = { kind, x: s.x, y: s.y, z: s.z, rotation: 0, slot, yaw: s.yaw, w: s.w, h: s.h };
      return { request, valid: ctx.canPlace(request) };
    }
    // Borde delante: el de la casilla propia, salvo que esté a menos de 0,6 m (entonces el siguiente).
    const ahead = WALL_EDGE - ((feet.x - cx) * dx + (feet.z - cz) * dz);
    const step = ahead < 0.6 ? 1 : 0;
    const x = cx + dx * BUILD.size * step + 0, z = cz + dz * BUILD.size * step + 0;
    const rotation = (q + turn) % 4; // girar una pared = otro borde de la misma casilla
    const probe: BuildRequest = { kind, x, y: 0, z, rotation };
    const edge = anchorOf(probe);
    const heights = [pieceGroundRange(ctx.ground, probe)[1]];
    for (const p of pieces) {
      const a = anchorOf(p);
      // Suelos de las dos casillas que comparten el borde, paredes del mismo borde (apilar), rampas.
      if ((p.kind === 'floor' || p.kind === 'ramp') && Math.abs(a.x - edge.x) <= 1.51 && Math.abs(a.z - edge.z) <= 1.51) heights.push(buildTop(p));
      if (p.kind === 'wall' && p.slot === undefined && near(a.x, edge.x) && near(a.z, edge.z) && p.rotation % 2 === rotation % 2) heights.push(buildTop(p));
    }
    let first: BuildRequest | null = null;
    for (const y of orderHeights(heights, feet.y)) {
      const request: BuildRequest = { kind, x, y, z, rotation };
      first ??= request;
      if (ctx.canPlace(request)) return { request, valid: true };
    }
    return { request: first ?? { ...probe, y: feet.y }, valid: false };
  }
  // `+ 0` normaliza −0 (la solicitud viaja por red y se compara en pruebas).
  // El techo cubre la casilla propia (cerrar la habitación en la que se está); el resto, la siguiente.
  // Una rampa puede ocupar la casilla propia si la siguiente está bloqueada.
  const steps = kind === 'ramp' ? [1,0] : [kind === 'roof' ? 0 : 1];
  let fallback: BuildRequest | null = null;
  for (const ahead of steps) {
    const x = cx + dx * BUILD.size * ahead + 0;
    const z = cz + dz * BUILD.size * ahead + 0;
    const rotation = (rotationForYaw(kind, yaw) + turn) % 4;
    const heights: number[] = [groundRange(ctx.ground, x, z)[1]];
    for (const p of pieces) {
      if (p.kind !== 'wall' && near(p.x, x) && near(p.z, z)) heights.push(buildTop(p));
      if (p.kind === 'wall' && p.slot === undefined) {
        // La parte alta de una pared de esta casilla sostiene un suelo o techo encima.
        const a = anchorOf(p);
        if (Math.abs(a.x - x) <= 1.51 && Math.abs(a.z - z) <= 1.51) heights.push(kind === 'floor' ? buildTop(p) - 0.0 : buildTop(p));
      }
      if (p.kind === 'ramp') {
        const [rx, rz] = rampRise(p.rotation);
        if (near(p.x + rx * BUILD.size, x) && near(p.z + rz * BUILD.size, z)) heights.push(kind === 'floor' ? p.y + 3 - FLOOR_TOP : p.y + 3);
      }
      if (p.kind === 'floor' && Math.abs(p.x - x) + Math.abs(p.z - z) < BUILD.size + 0.01 && (p.x !== x || p.z !== z)) heights.push(kind === 'floor' ? p.y : buildTop(p));
    }
    let first: BuildRequest | null = null;
    for (const y of orderHeights(heights, feet.y, kind==='floor'?FLOOR_TOP:0)) {
      if(kind==='ramp'&&ahead===0&&y>feet.y+.4)continue;
      const request: BuildRequest = { kind, x, y, z, rotation };
      first ??= request;
      if (ctx.canPlace(request)) return { request, valid: true };
    }
    fallback ??= first ?? { kind, x, y: feet.y, z, rotation };
  }
  return { request: fallback!, valid: false };
}

/** Solo un borde real puede tocar otra pieza; los paneles interiores nunca se ignoran. */
export function perimeterContact(wall: BuildRequest, piece: BuildRequest): boolean {
  if(wall.kind!=='wall'||wall.slot!==undefined||piece.kind==='wall')return false;
  const a=anchorOf(wall);
  return wall.rotation%2===0 ? Math.abs(Math.abs(a.z-piece.z)-WALL_EDGE)<.01 && Math.abs(a.x-piece.x)<.01
    : Math.abs(Math.abs(a.x-piece.x)-WALL_EDGE)<.01 && Math.abs(a.z-piece.z)<.01;
}

/** Autoridad compartida. Las consultas de colisión son inyectadas por el mundo físico. */
export class BuildingState {
  onHarvest: ((id:string,amount:number)=>void)|null=null;
  onBuild: ((id:string)=>void)|null=null;
  readonly pieces = new Map<number, BuildPiece>();
  readonly wood = new Map<string, number>();
  readonly trees: number[];
  revision = 0;
  private nextId = 1;
  private cached: BuildingSnapshot | null = null;
  constructor(treeCount: number, readonly mapSize: number, private readonly env: BuildingEnvironment) {
    this.trees = Array.from({ length: treeCount }, () => BUILD.treeHp);
  }
  addPlayer(id: string): void { if (!this.wood.has(id)) { this.wood.set(id, 0); this.touch(); } }
  removePlayer(id: string): void { this.wood.delete(id); this.touch(); }
  snapshot(): BuildingSnapshot {
    if (!this.cached || this.cached.revision !== this.revision) this.cached = { revision: this.revision, trees: [...this.trees], pieces: [...this.pieces.values()].map(p => ({ ...p })), wood: Object.fromEntries(this.wood) };
    return this.cached;
  }
  load(s: BuildingSnapshot): void {
    this.trees.splice(0, this.trees.length, ...s.trees);
    this.pieces.clear(); for (const p of s.pieces) this.pieces.set(p.id, { ...p });
    this.wood.clear(); for (const [id, n] of Object.entries(s.wood)) this.wood.set(id, n);
    this.revision = s.revision;
    this.cached = null;
    this.nextId = Math.max(0, ...this.pieces.keys()) + 1;
    this.env.changed();
  }
  /**
   * Apoyada en el terreno: la base coincide con el punto MÁS ALTO de la huella
   * (también en laderas, hasta MAX_GROUND_SLOPE de desnivel). Antes se exigía
   * terreno plano con 6 cm de tolerancia y casi cualquier ladera rechazaba el suelo.
   */
  private grounded(p: BuildRequest): boolean {
    if (p.slot !== undefined) return true; // el edificio lo sostiene
    const [min, max] = pieceGroundRange((x, z) => this.env.ground(x, z), p);
    return Math.abs(p.y - max) < 0.06 && max - min <= MAX_GROUND_SLOPE;
  }
  private supports(a: BuildRequest, b: BuildRequest): boolean {
    const aa = anchorOf(a), ab = anchorOf(b);
    const dx = Math.abs(aa.x - ab.x), dz = Math.abs(aa.z - ab.z);
    if (Math.abs(buildTop(a) - b.y) < 0.12 && dx <= 1.51 && dz <= 1.51) return true;
    if (a.kind === 'floor' && b.kind === 'floor' && Math.abs(a.y - b.y) < 0.02 && dx + dz <= 3.01) return true;
    // El extremo alto de una rampa sostiene la casilla siguiente: otra rampa o una pared
    // empiezan a su altura y un suelo queda con la superficie a ras (sin escalón).
    if (a.kind === 'ramp') {
      const [rx, rz] = rampRise(a.rotation);
      if (Math.abs(a.x + rx * BUILD.size - b.x) < 0.01 && Math.abs(a.z + rz * BUILD.size - b.z) < 0.01) {
        const top = a.y + 3;
        return b.kind === 'floor' ? Math.abs(top - buildTop(b)) < 0.12 : Math.abs(top - b.y) < 0.12;
      }
    }
    // Un suelo sostiene la rampa que arranca en su borde y sube alejándose de él.
    if (a.kind === 'floor' && b.kind === 'ramp') {
      const [rx, rz] = rampRise(b.rotation);
      if (Math.abs(a.x + rx * BUILD.size - b.x) < 0.01 && Math.abs(a.z + rz * BUILD.size - b.z) < 0.01) return Math.abs(buildTop(a) - b.y) < 0.12;
    }
    return false;
  }
  canPlace(id: string, r: unknown, feet: Vec3): boolean {
    if (!validBuildRequest(r) || !this.wood.has(id) || (this.wood.get(id) ?? 0) < BUILD.cost) return false;
    if (this.pieces.size >= BUILD.maxPieces || [...this.pieces.values()].filter(p => p.owner === id).length >= BUILD.perPlayer) return false;
    if (Math.abs(r.x) > this.mapSize / 2 - 3 || Math.abs(r.z) > this.mapSize / 2 - 3 || r.y < -2 || r.y > BUILD.height) return false;
    if (Math.hypot(r.x - feet.x, r.y - feet.y, r.z - feet.z) > BUILD.range) return false;
    if (r.slot !== undefined) {
      // Panel de hueco: debe coincidir EXACTAMENTE con el hueco del mapa (no se confía en el cliente).
      const s = this.env.slots?.[r.slot];
      if (!s || [s.x - r.x, s.y - r.y, s.z - r.z, s.yaw - r.yaw!, s.w - r.w!, s.h - r.h!].some(d => Math.abs(d) > 1e-4)) return false;
    }
    if (!this.grounded(r) && ![...this.pieces.values()].some(p => this.supports(p, r))) return false;
    // Duplicados: misma casilla para suelos/techos/rampas; mismo BORDE para paredes (la pared
    // entre dos casillas es una sola, se pida desde la que se pida).
    if ([...this.pieces.values()].some(p => r.kind === 'wall' ? sameWall(p, r)
      : p.kind === r.kind && p.x === r.x && p.z === r.z && Math.abs(p.y - r.y) < 0.1 && (p.rotation === r.rotation || r.kind === 'floor' || r.kind === 'roof'))) return false;
    return this.env.clear(r, feet);
  }
  place(id: string, r: unknown, feet: Vec3): boolean {
    if (!this.canPlace(id, r, feet) || !validBuildRequest(r)) return false;
    this.wood.set(id, this.wood.get(id)! - BUILD.cost);
    const piece: BuildPiece = { kind: r.kind, x: r.x, y: r.y, z: r.z, rotation: r.rotation, id: this.nextId++, owner: id, hp: BUILD.hp };
    if (r.slot !== undefined) Object.assign(piece, { slot: r.slot, yaw: r.yaw, w: r.w, h: r.h });
    this.pieces.set(piece.id, piece);
    this.onBuild?.(id);
    this.touch(); return true;
  }
  /** Fase 12: madera extra (botín de un zombi), con el mismo tope. Devuelve lo sumado. */
  giveWood(id: string, amount: number): number {
    if (!this.wood.has(id) || !(amount > 0)) return 0;
    const before = this.wood.get(id)!, after = Math.min(BUILD.woodCap, before + Math.floor(amount));
    if (after > before) { this.wood.set(id, after); this.touch(); }
    return after - before;
  }
  hitTree(id: string, index: number, damage: number, axe: boolean): boolean {
    if (!this.wood.has(id) || !(damage > 0) || !(this.trees[index]! > 0)) return false;
    const actual = Math.min(this.trees[index]!, damage);
    this.trees[index] = Math.max(0, this.trees[index]! - damage);
    if (axe) {
      // Fase 16: un árbol talado entero da exactamente BUILD.woodPerTree (30, lo que ya daba con golpes
      // de 15) en total, repartido por golpes sin perder decimales.
      const hpAfter=this.trees[index]!, hpBefore=hpAfter+actual;
      const gained=Math.floor((BUILD.treeHp-hpAfter)/BUILD.treeHp*BUILD.woodPerTree+1e-9)-Math.floor((BUILD.treeHp-hpBefore)/BUILD.treeHp*BUILD.woodPerTree+1e-9);
      const before=this.wood.get(id)!;const after=Math.min(BUILD.woodCap,before+gained);
      this.wood.set(id,after);if(after>before)this.onHarvest?.(id,after-before);
    }
    this.touch(); return true;
  }
  hitPiece(id: number, damage: number): boolean {
    const p = this.pieces.get(id); if (!p || !(damage > 0)) return false;
    p.hp = Math.max(0, p.hp - damage);
    if (p.hp === 0) {
      this.pieces.delete(id);
      const supported = new Set<number>();
      let progress = true;
      while (progress) {
        progress = false;
        for (const piece of this.pieces.values()) if (!supported.has(piece.id) && (this.grounded(piece) || [...supported].some(key => this.supports(this.pieces.get(key)!, piece)))) {
          supported.add(piece.id); progress = true;
        }
      }
      for (const key of this.pieces.keys()) if (!supported.has(key)) this.pieces.delete(key);
    }
    this.touch(); return true;
  }
  private touch(): void { this.revision++; this.env.changed(); }
}
