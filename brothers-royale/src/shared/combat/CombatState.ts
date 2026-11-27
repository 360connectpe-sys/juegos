/**
 * Combate autoritativo: disparos, golpes, cadencia, cargadores, recarga,
 * salud, curación y muertes. Puro y determinista (RNG con semilla): lo
 * ejecuta el servidor (ServerWorld) y, sin conexión, OfflineSession. El
 * cliente NUNCA decide un impacto, el daño, la munición ni la cadencia: solo
 * envía botones y la dirección de apuntado.
 *
 * Protecciones:
 *  - Paredes: cada bala se corta en el primer obstáculo estático (Rapier) y
 *    sale de los OJOS del cuerpo autoritativo (nunca dentro de una pared).
 *  - Daño manipulado: el daño sale de las tablas de weapons.ts; el cliente no
 *    lo envía. Ningún disparo supera HEALTH.maxShotDamage (< 100).
 *  - Munición infinita: el cargador vive en el inventario del servidor y la
 *    recarga gasta la bolsa.
 *  - Ataques acelerados: la cadencia se mide con el tiempo de las entradas
 *    procesadas (1 por tick de media, ver ServerWorld) y cambiar de arma
 *    tarda EQUIP_SECONDS.
 */
import { consumeOne, magOf, reloadWeapon, withMag, type Inventory } from '../inventory';
import { isWeapon, ITEMS, type ItemKind, type Rarity, type WeaponKind } from '../items';
import type { MatchState } from '../match/MatchState';
import { createRng, type Rng } from '../random';
import { Buttons, hasButton, type PlayerInput, type Vec3 } from '../types';
import { packGear, type GearAction } from './gear';
import { applySpread, hitboxAxisPoint, rayHitbox } from './hitscan';
import {
  DEATH,
  directionFromAim,
  EQUIP_SECONDS,
  EYE_HEIGHT,
  HEAL,
  HEALTH,
  HITBOX,
  MELEE,
  MOVE_SPREAD,
  pelletDamage,
  rarityOf,
  reloadSeconds,
  roundDamage,
  spreadOf,
  WEAPON_STATS,
} from './weapons';

/** Con qué se hizo el daño. */
export type AttackKind = WeaponKind | 'axe';

/** Lo que el propio jugador necesita saber de sí mismo (HUD). */
export interface Vitals {
  hp: number;
  dead: boolean;
  /** Segundos para volver (muerte provisional de la fase 6). */
  respawnIn: number;
  /** Recarga en curso: segundos restantes y totales (0 = ninguna). */
  reload: number;
  reloadTotal: number;
  /** Curación en curso: segundos restantes y totales (0 = ninguna). */
  heal: number;
  healTotal: number;
}

export type CombatEvent =
  | { type: 'shot'; by: string; weapon: WeaponKind; rarity: Rarity; origin: Vec3; ends: Vec3[]; hits: boolean[] }
  | { type: 'melee'; by: string; origin: Vec3; end: Vec3; hit: boolean }
  | { type: 'damage'; victim: string; by: string; weapon: AttackKind; amount: number; hp: number; at: Vec3 }
  | { type: 'death'; victim: string; killer: string; weapon: AttackKind; tick: number; at: Vec3 }
  | { type: 'respawn'; id: string }
  | { type: 'healed'; id: string; amount: number }
  | { type: 'vitals'; id: string; vitals: Vitals }
  | { type: 'empty'; id: string };

/** Pose de un objetivo en el tick que vio el atacante. */
export interface TargetPose {
  id: string;
  feet: Vec3;
}

/** Lo que el combate necesita del mundo para resolver un ataque. */
export interface AttackContext {
  damageObstacle?: (by: string, origin: Vec3, direction: Vec3, range: number, damage: number, axe: boolean) => boolean;
  /** Pies del atacante (posición autoritativa tras su paso de movimiento). */
  feet: Vec3;
  grounded: boolean;
  /** Velocidad horizontal (m/s), para la dispersión al moverse. */
  speed: number;
  dt: number;
  tick: number;
  /** Objetivos en el tick visto (ya rebobinados y limitados por el llamador). */
  targets: (viewTick: number | undefined) => Iterable<TargetPose>;
  /** Distancia al primer obstáculo estático (mundo, estructuras) o null. */
  castStatic: (origin: Vec3, dir: Vec3, maxDistance: number) => number | null;
}

/** Estadísticas acumuladas por jugador (para futuras estadísticas de partida). */
export interface FighterStats {
  shots: number;
  hits: number;
  damageDealt: number;
  damageTaken: number;
  kills: number;
  deaths: number;
  healed: number;
}

/** Registro de daño y bajas (acotado) + estadísticas. Preparado para la fase 8. */
export interface CombatLogEntry {
  tick: number;
  kind: 'damage' | 'death';
  attacker: string;
  victim: string;
  weapon: AttackKind;
  amount: number;
  distance: number;
}

export class CombatLog {
  readonly entries: CombatLogEntry[] = [];
  readonly stats = new Map<string, FighterStats>();

  constructor(readonly capacity = 2000) {}

  of(id: string): FighterStats {
    let s = this.stats.get(id);
    if (!s) {
      s = { shots: 0, hits: 0, damageDealt: 0, damageTaken: 0, kills: 0, deaths: 0, healed: 0 };
      this.stats.set(id, s);
    }
    return s;
  }

  push(e: CombatLogEntry): void {
    this.entries.push(e);
    if (this.entries.length > this.capacity) this.entries.splice(0, this.entries.length - this.capacity);
  }

  /** Eliminaciones en orden (la fase 8 las usará para vidas y clasificación). */
  deaths(): CombatLogEntry[] {
    return this.entries.filter((e) => e.kind === 'death');
  }
}

interface Fighter {
  id: string;
  hp: number;
  dead: boolean;
  respawnIn: number;
  cooldown: number;
  equip: number;
  slot: number;
  reload: { slot: number; left: number; total: number } | null;
  heal: { slot: number; left: number; total: number } | null;
  bloom: number;
  bloomMax: number;
  bloomRecovery: number;
  reloadHeld: boolean;
  fireHeld: boolean;
  aiming: boolean;
  action: GearAction;
  actionTimer: number;
  /** Objetivo sin inventario (muñeco de práctica): no ataca. */
  dummy: boolean;
}

const eye = (feet: Vec3): Vec3 => ({ x: feet.x, y: feet.y + EYE_HEIGHT, z: feet.z });
const along = (o: Vec3, d: Vec3, t: number): Vec3 => ({ x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t });
const round2 = (v: Vec3): Vec3 => ({ x: Math.round(v.x * 100) / 100, y: Math.round(v.y * 100) / 100, z: Math.round(v.z * 100) / 100 });

export class CombatState {
  private readonly fighters = new Map<string, Fighter>();
  private events: CombatEvent[] = [];
  private readonly rng: Rng;
  readonly log = new CombatLog();
  /** Gancho para la fase 8 (vidas, eliminación definitiva, botín al morir). */
  onDeath: ((e: Extract<CombatEvent, { type: 'death' }>) => void) | null = null;
  /** La autoridad recoloca al jugador al volver (vuelta provisional de la fase 6). */
  onRespawn: ((id: string) => void) | null = null;

  constructor(
    private readonly match: MatchState,
    seed: number,
  ) {
    this.rng = createRng((seed ^ 0x5eed_c0de) >>> 0);
  }

  drain(): CombatEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  addFighter(id: string, dummy = false): void {
    if (this.fighters.has(id)) return;
    this.fighters.set(id, {
      id, hp: HEALTH.max, dead: false, respawnIn: 0, cooldown: 0, equip: 0, slot: this.match.inventory(id)?.selected ?? 0,
      reload: null, heal: null, bloom: 0, bloomMax: 0, bloomRecovery: 1, reloadHeld: false, fireHeld: false, aiming: false,
      action: 'none', actionTimer: 0, dummy,
    });
  }

  removeFighter(id: string): void {
    this.fighters.delete(id);
    this.log.stats.delete(id);
  }

  has(id: string): boolean {
    return this.fighters.has(id);
  }

  isDead(id: string): boolean {
    return this.fighters.get(id)?.dead ?? false;
  }

  hp(id: string): number {
    return this.fighters.get(id)?.hp ?? 0;
  }

  vitals(id: string): Vitals | null {
    const f = this.fighters.get(id);
    if (!f) return null;
    return {
      hp: f.hp,
      dead: f.dead,
      respawnIn: Math.max(0, f.respawnIn),
      reload: f.reload ? Math.max(0, f.reload.left) : 0,
      reloadTotal: f.reload?.total ?? 0,
      heal: f.heal ? Math.max(0, f.heal.left) : 0,
      healTotal: f.heal?.total ?? 0,
    };
  }

  /** Estado visible (snapshot público). */
  gear(id: string): number {
    const f = this.fighters.get(id);
    if (!f) return 0;
    const inv = this.match.inventory(id);
    const item = inv?.slots[inv.selected] ?? null;
    let action: GearAction = f.actionTimer > 0 ? f.action : 'none';
    if (f.reload) action = 'reload';
    else if (f.heal) action = 'heal';
    else if (action === 'none' && f.aiming) action = 'aim';
    return packGear({ held: (item?.kind as ItemKind | undefined) ?? null, rarity: rarityOf(item?.rarity), action, dead: f.dead });
  }

  /** Solo pruebas y depuración. */
  setHp(id: string, hp: number): void {
    const f = this.fighters.get(id);
    if (f) {
      f.hp = Math.max(0, Math.min(HEALTH.max, hp));
      this.pushVitals(f);
    }
  }

  /** Paso sin entrada (jugador sin datos o muñeco): solo avanzan los tiempos. */
  idle(id: string, dt: number): void {
    const f = this.fighters.get(id);
    if (!f) return;
    this.advance(f, dt);
    f.fireHeld = false;
    f.reloadHeld = false;
    f.aiming = false;
    if (f.cooldown < 0) f.cooldown = 0;
  }

  /** Procesa la entrada de un tick DESPUÉS de su paso de movimiento. */
  step(id: string, input: PlayerInput, ctx: AttackContext): void {
    const f = this.fighters.get(id);
    if (!f || f.dummy) return;
    const dt = ctx.dt;
    if (!this.advance(f, dt)) return; // muerto
    let inv = this.match.inventory(id);
    if (!inv) return;

    // Cambio de hueco: cancela recarga y curación y requiere desenfundar.
    if (inv.selected !== f.slot) {
      f.slot = inv.selected;
      f.equip = EQUIP_SECONDS;
      if (f.reload || f.heal) {
        f.reload = null;
        f.heal = null;
        this.pushVitals(f);
      }
    }
    inv = this.finishTimers(f, inv);

    const item = inv.slots[inv.selected] ?? null;
    const fire = hasButton(input.buttons, Buttons.FIRE);
    const reload = hasButton(input.buttons, Buttons.RELOAD);
    f.aiming = hasButton(input.buttons, Buttons.AIM);
    const firePressed = fire && !f.fireHeld;
    f.fireHeld = fire;
    if (reload && !f.reloadHeld && item && isWeapon(item.kind)) this.startReload(f, inv);
    f.reloadHeld = reload;

    let attacked = false;
    if (fire && item) {
      if (item.kind === 'medkit') {
        if (!f.heal && firePressed) this.startHeal(f);
      } else if (item.kind === 'axe') {
        if (f.equip <= 0 && f.cooldown <= 0) {
          this.melee(f, input, ctx);
          attacked = true;
        }
      } else if (isWeapon(item.kind) && !f.reload && f.equip <= 0 && f.cooldown <= 0) {
        if (magOf(item) > 0) {
          this.shoot(f, inv, item.kind, rarityOf(item.rarity), input, ctx);
          attacked = true;
        } else if (!this.startReload(f, inv) && firePressed) {
          this.events.push({ type: 'empty', id });
        }
      }
    }
    if (attacked && f.heal) {
      f.heal = null;
      this.pushVitals(f);
    }
    // Sin disparar no se acumulan disparos: la cadencia no se "ahorra".
    if (!attacked && f.cooldown < 0) f.cooldown = 0;
  }

  /** Avanza temporizadores. Devuelve false si está muerto. */
  private advance(f: Fighter, dt: number): boolean {
    f.cooldown -= dt;
    f.equip = Math.max(0, f.equip - dt);
    f.actionTimer = Math.max(0, f.actionTimer - dt);
    f.bloom = Math.max(0, f.bloom - f.bloomRecovery * dt);
    if (f.dead) {
      f.respawnIn -= dt;
      if (f.respawnIn <= 0) this.respawn(f);
      return false;
    }
    const current = this.match.inventory(f.id);
    if (current && current.selected !== f.slot && (f.reload || f.heal)) {
      f.reload = null;
      f.heal = null;
      this.pushVitals(f);
    }
    if (f.reload) f.reload.left -= dt;
    if (f.heal) f.heal.left -= dt;
    if (!f.dummy) {
      const inv = this.match.inventory(f.id);
      if (inv) this.finishTimers(f, inv);
    }
    return true;
  }

  private finishTimers(f: Fighter, inv: Inventory): Inventory {
    if (f.reload && f.reload.left <= 1e-9) {
      const next = reloadWeapon(inv, f.reload.slot);
      f.reload = null;
      if (next) {
        this.match.setInventory(f.id, next);
        inv = next;
      }
      this.pushVitals(f);
    }
    if (f.heal && f.heal.left <= 1e-9) {
      const slot = f.heal.slot;
      f.heal = null;
      const s = inv.slots[slot];
      if (s?.kind === 'medkit') {
        const before = f.hp;
        f.hp = Math.min(HEALTH.max, f.hp + HEAL.amount);
        const next = consumeOne(inv, slot);
        this.match.setInventory(f.id, next);
        inv = next;
        this.log.of(f.id).healed += f.hp - before;
        this.events.push({ type: 'healed', id: f.id, amount: roundDamage(f.hp - before) });
      }
      this.pushVitals(f);
    }
    return inv;
  }

  private startReload(f: Fighter, inv: Inventory): boolean {
    if (f.reload) return true;
    const item = inv.slots[inv.selected];
    if (!item || !isWeapon(item.kind)) return false;
    if (magOf(item) >= WEAPON_STATS[item.kind].magazine) return false;
    if (inv.ammo[ITEMS[item.kind].ammo!] <= 0) return false;
    const total = reloadSeconds(item.kind, rarityOf(item.rarity));
    f.reload = { slot: inv.selected, left: total, total };
    if (f.heal) f.heal = null;
    this.pushVitals(f);
    return true;
  }

  private startHeal(f: Fighter): void {
    const inv = this.match.inventory(f.id);
    if (!inv || f.hp >= HEALTH.max || f.dead) return;
    f.reload = null;
    f.heal = { slot: inv.selected, left: HEAL.seconds, total: HEAL.seconds };
    this.pushVitals(f);
  }

  private shoot(f: Fighter, inv: Inventory, kind: WeaponKind, rarity: Rarity, input: PlayerInput, ctx: AttackContext): void {
    const s = WEAPON_STATS[kind];
    const origin = eye(ctx.feet);
    const dir = directionFromAim(input.aimYaw, input.aimPitch ?? 0);
    let spread = spreadOf(kind, rarity, f.aiming) + f.bloom;
    if (!ctx.grounded) spread *= MOVE_SPREAD.airborne;
    else if (ctx.speed > MOVE_SPREAD.movingSpeed) spread *= MOVE_SPREAD.moving;
    const targets = [...ctx.targets(input.viewTick)].filter((t) => t.id !== f.id && !this.isDead(t.id));
    const damage = new Map<string, { amount: number; at: Vec3; distance: number }>();
    const ends: Vec3[] = [];
    const hits: boolean[] = [];
    for (let i = 0; i < s.pellets; i++) {
      const d = applySpread(dir, spread, this.rng);
      const wall = ctx.castStatic(origin, d, s.range) ?? s.range;
      let best: { id: string; t: number } | null = null;
      for (const t of targets) {
        const hit = rayHitbox(origin, d, t.feet, wall);
        if (hit !== null && (!best || hit < best.t)) best = { id: t.id, t: hit };
      }
      if (!best && wall < s.range) ctx.damageObstacle?.(f.id, origin, d, wall, pelletDamage(kind, rarity, wall), false);
      const end = along(origin, d, best ? best.t : wall);
      ends.push(round2(end));
      hits.push(best !== null);
      if (best) {
        const acc = damage.get(best.id) ?? { amount: 0, at: end, distance: best.t };
        acc.amount += pelletDamage(kind, rarity, best.t);
        damage.set(best.id, acc);
      }
    }
    this.match.setInventory(f.id, withMag(inv, inv.selected, magOf(inv.slots[inv.selected]!) - 1));
    f.cooldown += 1 / s.fireRate;
    f.bloom = Math.min(s.bloomMax, f.bloom + s.bloomPerShot);
    f.bloomMax = s.bloomMax;
    f.bloomRecovery = s.bloomRecovery;
    f.action = 'fire';
    f.actionTimer = 0.15;
    const stats = this.log.of(f.id);
    stats.shots++;
    this.events.push({ type: 'shot', by: f.id, weapon: kind, rarity, origin: round2(origin), ends, hits });
    for (const [victim, d] of damage) {
      stats.hits++;
      this.applyDamage(victim, f.id, kind, Math.min(HEALTH.maxShotDamage, roundDamage(d.amount)), d.at, d.distance, ctx.tick);
    }
  }

  private melee(f: Fighter, input: PlayerInput, ctx: AttackContext): void {
    const origin = eye(ctx.feet);
    const dir = directionFromAim(input.aimYaw, 0);
    let best: { id: string; dist: number; at: Vec3 } | null = null;
    for (const t of ctx.targets(input.viewTick)) {
      if (t.id === f.id || this.isDead(t.id)) continue;
      const p = hitboxAxisPoint(t.feet, origin);
      const dx = p.x - origin.x;
      const dy = p.y - origin.y;
      const dz = p.z - origin.z;
      const dist = Math.hypot(dx, dy, dz) - HITBOX.radius;
      if (dist > MELEE.reach) continue;
      const flat = Math.hypot(dx, dz);
      if (flat > 1e-6 && (dx * dir.x + dz * dir.z) / (flat * Math.hypot(dir.x, dir.z)) < Math.cos(MELEE.cone)) continue;
      const len = Math.hypot(dx, dy, dz);
      // Sin golpes a través de paredes.
      if (len > 1e-6) {
        const wall = ctx.castStatic(origin, { x: dx / len, y: dy / len, z: dz / len }, len);
        if (wall !== null && wall < len - HITBOX.radius) continue;
      }
      if (!best || dist < best.dist) best = { id: t.id, dist, at: p };
    }
    f.cooldown += 1 / MELEE.rate;
    f.action = 'melee';
    f.actionTimer = 0.3;
    const stats = this.log.of(f.id);
    stats.shots++;
    const obstacleDir = directionFromAim(input.aimYaw, input.aimPitch ?? 0);
    const obstacleDistance = ctx.castStatic(origin, obstacleDir, MELEE.reach) ?? MELEE.reach;
    const obstacleHit = !best && (ctx.damageObstacle?.(f.id, origin, obstacleDir, obstacleDistance, MELEE.damage, true) ?? false);
    const end = best ? best.at : along(origin, obstacleDir, obstacleDistance);
    this.events.push({ type: 'melee', by: f.id, origin: round2(origin), end: round2(end), hit: best !== null || obstacleHit });
    if (best) {
      stats.hits++;
      this.applyDamage(best.id, f.id, 'axe', MELEE.damage, best.at, best.dist, ctx.tick);
    }
  }

  private applyDamage(victim: string, by: string, weapon: AttackKind, amount: number, at: Vec3, distance: number, tick: number): void {
    const v = this.fighters.get(victim);
    if (!v || v.dead || !(amount > 0)) return;
    v.hp = roundDamage(Math.max(0, v.hp - amount));
    if (v.heal) v.heal = null; // recibir daño cancela la curación
    this.log.of(by).damageDealt += amount;
    this.log.of(victim).damageTaken += amount;
    this.log.push({ tick, kind: 'damage', attacker: by, victim, weapon, amount, distance: Math.round(distance * 10) / 10 });
    this.events.push({ type: 'damage', victim, by, weapon, amount, hp: v.hp, at: round2(at) });
    if (v.hp <= 0) {
      v.dead = true;
      v.respawnIn = DEATH.respawnSeconds;
      v.reload = null;
      v.heal = null;
      v.fireHeld = false;
      this.log.of(by).kills++;
      this.log.of(victim).deaths++;
      this.log.push({ tick, kind: 'death', attacker: by, victim, weapon, amount, distance: Math.round(distance * 10) / 10 });
      const death = { type: 'death' as const, victim, killer: by, weapon, tick, at: round2(at) };
      this.events.push(death);
      this.onDeath?.(death);
    }
    this.pushVitals(v);
  }

  /** Muerte PROVISIONAL (fase 6): vuelve con salud completa. La fase 8 pondrá las vidas. */
  private respawn(f: Fighter): void {
    f.dead = false;
    f.hp = HEALTH.max;
    f.respawnIn = 0;
    f.cooldown = 0;
    f.bloom = 0;
    f.equip = EQUIP_SECONDS;
    this.events.push({ type: 'respawn', id: f.id });
    this.onRespawn?.(f.id);
    this.pushVitals(f);
  }

  private pushVitals(f: Fighter): void {
    if (f.dummy) return;
    this.events.push({ type: 'vitals', id: f.id, vitals: this.vitals(f.id)! });
  }
}
