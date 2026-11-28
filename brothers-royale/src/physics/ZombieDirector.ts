/**
 * Fase 12 — zombis controlados por la autoridad (servidor y, sin conexión, OfflineSession).
 * Cada zombi es un CharacterBody (mismas colisiones, peldaños y rampas que un jugador: no
 * atraviesa sólidos) movido por una entrada sintética. La IA piensa escalonada (cada
 * `ZOMBIE.thinkEvery` ticks, desfasada por zombi); el cuerpo avanza cada tick.
 * Combate: son "fighters" npc de CombatState (40 HP): los hieren armas y hacha, reciben daño
 * de la tormenta y NO cuentan en estadísticas, eliminaciones ni para decidir el ganador.
 */
import type { BattleRound } from '@shared/battle/BattleRound';
import { contains } from '@shared/battle/zone';
import type { CombatEvent, CombatState } from '@shared/combat/CombatState';
import { EYE_HEIGHT } from '@shared/combat/weapons';
import { DEFAULT_MODIFIERS } from '@shared/movement';
import { createRng, type Rng } from '@shared/random';
import { Buttons, type PlayerInput, type Vec3 } from '@shared/types';
import type { ItemStack } from '@shared/items';
import { isClearSpawn, type WorldLayout } from '@shared/world/layout';
import type { PlacedPrefab } from '@shared/world/prefab';
import { terrainHeight } from '@shared/world/terrain';
import { chooseTarget, nextWaypoint, ZOMBIE, type ZombieAnim, type ZombieCandidate } from '@shared/zombies/zombieAi';
import { CharacterBody } from './CharacterBody';
import type { PhysicsWorld } from './PhysicsWorld';

export const ZOMBIE_STRIDE = 7;
export const ZOMBIE_PREFIX = 'z:';

export interface ZombieHost {
  readonly physics: PhysicsWorld;
  readonly layout: WorldLayout;
  readonly combat: CombatState;
  readonly round: BattleRound;
  /** Jugadores conectados (pies autoritativos). */
  players(): Iterable<{ id: string; feet: Vec3 }>;
  /** Suelta un objeto en el suelo (botín de un zombi). */
  drop(item: ItemStack, at: Vec3): void;
  /** Madera para quien lo eliminó. */
  giveWood(id: string, amount: number): void;
}

interface Zombie {
  id: string;
  num: number;
  body: CharacterBody;
  target: string | null;
  anim: ZombieAnim;
  attackCd: number;
  animT: number;
  retargetT: number;
  wanderT: number;
  dirX: number;
  dirZ: number;
  jump: boolean;
  checkT: number;
  checkX: number;
  checkZ: number;
  sideT: number;
  side: number;
  lastHp: number;
  deadT: number;
  seq: number;
}

export class ZombieDirector {
  readonly zombies = new Map<string, Zombie>();
  /** Probabilidad de botín (configurable por sala). */
  dropChance: number = ZOMBIE.dropChance;
  /** Se puede desactivar (p. ej. pruebas de otros sistemas). */
  enabled = true;
  private spawnClock = 0;
  private stormClock = 0;
  private serial = 0;
  private rng: Rng;
  private readonly buildings: PlacedPrefab[];
  private readonly input: PlayerInput = { seq: 0, moveX: 0, moveZ: 0, buttons: 0, aimYaw: 0 };
  private readonly candidates: ZombieCandidate[] = [];

  constructor(private readonly host: ZombieHost, seed: number) {
    this.rng = createRng((seed ^ 0x2b1e_0d1e) >>> 0);
    this.buildings = host.layout.structures.filter((s) => s.def.nav);
    const prev = host.combat.onDeath;
    host.combat.onDeath = (e) => { prev?.(e); this.died(e); };
  }

  get alive(): number { let n = 0; for (const z of this.zombies.values()) if (z.deadT < 0) n++; return n; }

  /** Quita todos (nueva ronda, lobby). */
  reset(seed?: number): void {
    for (const z of this.zombies.values()) this.remove(z);
    this.zombies.clear();
    this.spawnClock = 0; this.stormClock = 0;
    if (seed !== undefined) this.rng = createRng((seed ^ 0x2b1e_0d1e) >>> 0);
  }

  /** Un tick (después de mover a los jugadores y antes de `physics.step`). */
  step(dt: number, tick: number): void {
    const round = this.host.round;
    if (round.phase !== 'running') { if (round.phase !== 'finished' && this.zombies.size) this.reset(); return; }
    if (this.enabled) {
      this.spawnClock += dt;
      if (this.spawnClock >= ZOMBIE.spawnEvery - 1e-9) {
        this.spawnClock -= ZOMBIE.spawnEvery;
        if (this.alive < ZOMBIE.maxActive) this.spawn();
      }
    }
    this.candidates.length = 0;
    for (const p of this.host.players()) {
      const v = this.host.combat.vitals(p.id);
      // Ni en el avión, ni cayendo, ni con el descenso protegido.
      this.candidates.push({ id: p.id, feet: p.feet, targetable: !!v && !v.dead && !v.descending && round.airMode(p.id) === 0 });
    }
    const zone = round.zone;
    this.stormClock += dt;
    const storm = this.stormClock >= 1 - 1e-9;
    if (storm) this.stormClock -= 1;
    for (const z of [...this.zombies.values()]) {
      if (z.deadT >= 0) {
        z.deadT -= dt;
        if (z.deadT <= 0) { this.remove(z); this.zombies.delete(z.id); }
        continue;
      }
      const feet = z.body.state.position;
      const hp = this.host.combat.hp(z.id);
      if (hp < z.lastHp) { z.anim = 4; z.animT = ZOMBIE.hitSeconds; }
      z.lastHp = hp;
      if ((tick + z.num) % ZOMBIE.thinkEvery === 0) this.think(z, ZOMBIE.thinkEvery * dt);
      // Ataque cuerpo a cuerpo con cadencia fija.
      z.attackCd = Math.max(0, z.attackCd - dt);
      const t = z.target ? this.candidates.find((c) => c.id === z.target) : undefined;
      let attacking = false;
      if (t && t.targetable) {
        const d = Math.hypot(t.feet.x - feet.x, t.feet.z - feet.z);
        if (d <= ZOMBIE.attackRange && Math.abs(t.feet.y - feet.y) < 1.6) {
          attacking = true;
          if (z.attackCd <= 0 && this.host.physics.lineOfSight({ x: feet.x, y: feet.y + EYE_HEIGHT, z: feet.z }, { x: t.feet.x, y: t.feet.y + EYE_HEIGHT, z: t.feet.z })) {
            this.host.combat.zombieHit(t.id, z.id, ZOMBIE.damage, t.feet, tick);
            z.attackCd = ZOMBIE.attackInterval;
            z.anim = 3; z.animT = 0.35;
          }
        }
      }
      z.animT = Math.max(0, z.animT - dt);
      const stunned = z.anim === 4 && z.animT > 0;
      const inp = this.input;
      inp.seq = ++z.seq;
      inp.moveX = attacking || stunned ? 0 : z.dirX;
      inp.moveZ = attacking || stunned ? 0 : z.dirZ;
      inp.buttons = z.jump ? Buttons.JUMP : 0;
      inp.aimYaw = t ? Math.atan2(t.feet.x - feet.x, t.feet.z - feet.z) : z.body.state.yaw;
      if (attacking) inp.buttons |= Buttons.AIM; // se gira hacia el objetivo
      z.jump = false;
      z.body.step(inp, dt);
      if (z.animT <= 0) z.anim = attacking ? 2 : Math.hypot(z.dirX, z.dirZ) > 0.05 ? (z.target ? 2 : 1) : 0;
      if (storm && zone.damage > 0 && !contains(zone.current, feet)) this.host.combat.environmentalDamage(z.id, zone.damage, feet, tick);
      if (feet.y < -20) this.host.combat.environmentalDamage(z.id, 1000, feet, tick, 'fall');
    }
  }

  /** Empaqueta para el snapshot: [num, x, y, z (cm), yaw (mrad), anim, hp] por zombi. */
  pack(out: number[]): void {
    for (const z of this.zombies.values()) {
      const s = z.body.state;
      out.push(z.num, Math.round(s.position.x * 100), Math.round(s.position.y * 100), Math.round(s.position.z * 100),
        Math.round(s.yaw * 1000), z.deadT >= 0 ? 5 : z.anim, Math.max(0, Math.round(this.host.combat.hp(z.id))));
    }
  }

  /** Poses vivas (compensación de latencia y objetivos de disparo). */
  *poses(): Generator<{ id: string; feet: Vec3 }> {
    for (const z of this.zombies.values()) if (z.deadT < 0) yield { id: z.id, feet: z.body.state.position };
  }

  private think(z: Zombie, dt: number): void {
    const feet = z.body.state.position;
    z.retargetT -= dt;
    if (z.retargetT <= 0 || (z.target && !this.candidates.some((c) => c.id === z.target && c.targetable))) {
      z.target = chooseTarget(feet, this.candidates, z.target);
      z.retargetT = ZOMBIE.retargetEvery;
    }
    const t = z.target ? this.candidates.find((c) => c.id === z.target) : undefined;
    let wx: number, wz: number;
    if (t && Math.hypot(t.feet.x - feet.x, t.feet.z - feet.z) <= ZOMBIE.attackRange && Math.abs(t.feet.y - feet.y) < 1.6) {
      // Ya está al alcance: quieto y atacando (sin falsos atascos ni saltos).
      z.dirX = 0; z.dirZ = 0; z.sideT = 0; z.checkT = 1; z.checkX = feet.x; z.checkZ = feet.z;
      return;
    } else if (t) {
      const wp = nextWaypoint(this.buildings, feet, t.feet);
      wx = wp.x - feet.x; wz = wp.z - feet.z;
    } else {
      // Sin objetivo: vagan despacio y vuelven a la zona segura si la tormenta los alcanza.
      const zone = this.host.round.zone.current;
      z.wanderT -= dt;
      if (!contains(zone, feet, 2)) { wx = zone.x - feet.x; wz = zone.z - feet.z; }
      else {
        if (z.wanderT <= 0) { const a = this.rng() * Math.PI * 2; z.wanderT = 2 + this.rng() * 3; z.dirX = Math.cos(a) * 0.4; z.dirZ = Math.sin(a) * 0.4; }
        wx = z.dirX; wz = z.dirZ;
      }
    }
    const len = Math.hypot(wx, wz);
    let dx = len > 1e-3 ? wx / len : 0, dz = len > 1e-3 ? wz / len : 0;
    if (!t) { dx *= 0.45; dz *= 0.45; }
    // Atasco: si apenas avanzó en ~1 s, salta y rodea el obstáculo por un lado.
    z.checkT -= dt;
    if (z.checkT <= 0) {
      const moved = Math.hypot(feet.x - z.checkX, feet.z - z.checkZ);
      if (Math.hypot(dx, dz) > 0.3 && moved < 0.5) { z.jump = true; z.sideT = 0.9; z.side = this.rng() < 0.5 ? -1 : 1; }
      z.checkT = 1; z.checkX = feet.x; z.checkZ = feet.z;
    }
    if (z.sideT > 0) {
      z.sideT -= dt;
      const c = Math.cos(z.side * 1.2), s = Math.sin(z.side * 1.2);
      [dx, dz] = [dx * c - dz * s, dx * s + dz * c];
    }
    z.dirX = dx; z.dirZ = dz;
  }

  /** Aparición forzada en (x, z) (pruebas y depuración); respeta el máximo. */
  spawnAt(x: number, z: number): string | null {
    if (this.alive >= ZOMBIE.maxActive) return null;
    const ground = this.host.physics.groundHeightAt(x, z, 120) ?? terrainHeight(x, z, this.host.layout.terrain);
    return this.create(x, ground, z);
  }

  private create(x: number, ground: number, z: number): string {
    const num = ++this.serial;
    const id = `${ZOMBIE_PREFIX}${num}`;
    const body = new CharacterBody(this.host.physics, id, 'Zombi', { x, y: ground + 0.05, z });
    body.modifiers = { ...DEFAULT_MODIFIERS, speedMultiplier: ZOMBIE.speedMultiplier, canSprint: false };
    this.host.combat.addFighter(id, true, { hp: ZOMBIE.hp });
    this.zombies.set(id, { id, num, body, target: null, anim: 0, attackCd: 0, animT: 0, retargetT: 0, wanderT: 0, dirX: 0, dirZ: 0, jump: false,
      checkT: 1, checkX: x, checkZ: z, sideT: 0, side: 1, lastHp: ZOMBIE.hp, deadT: -1, seq: 0 });
    return id;
  }

  private spawn(): boolean {
    const zone = this.host.round.zone.current;
    const layout = this.host.layout;
    const players = [...this.host.players()];
    for (let attempt = 0; attempt < 40; attempt++) {
      const a = this.rng() * Math.PI * 2, r = Math.sqrt(this.rng()) * Math.max(0, zone.radius - 4);
      const x = zone.x + Math.cos(a) * r, z = zone.z + Math.sin(a) * r;
      const half = layout.terrain.size / 2 - 6;
      if (Math.abs(x) > half || Math.abs(z) > half) continue;
      const terrain = terrainHeight(x, z, layout.terrain);
      if (terrain < 0.2 || !isClearSpawn(layout, x, z)) continue;
      // Nunca encima de nadie: lejos de todos los jugadores (vivos o en el aire).
      if (players.some((p) => Math.hypot(p.feet.x - x, p.feet.z - z) < ZOMBIE.minSpawnDistance)) continue;
      const ground = this.host.physics.groundHeightAt(x, z, 120);
      if (ground === null || Math.abs(ground - terrain) > 0.4) continue; // sin construcciones debajo
      this.create(x, ground, z);
      return true;
    }
    return false;
  }

  private died(e: Extract<CombatEvent, { type: 'death' }>): void {
    const z = this.zombies.get(e.victim);
    if (!z || z.deadT >= 0) return;
    z.deadT = ZOMBIE.corpseSeconds; z.anim = 5; z.target = null;
    // Botín ocasional para quien lo eliminó (no para la tormenta).
    if (this.host.combat.has(e.killer) && !this.host.combat.isNpc(e.killer) && this.rng() < this.dropChance) {
      const at = z.body.state.position;
      if (this.rng() < 0.5) this.host.giveWood(e.killer, 15);
      else this.host.drop({ kind: this.rng() < 0.5 ? 'ammo_light' : 'ammo_medium', qty: 15 + Math.floor(this.rng() * 16) }, { x: at.x, y: at.y, z: at.z });
    }
  }

  /** Avisa al retirar un zombi (p. ej. para olvidar su historial de poses). */
  onRemoved: ((id: string) => void) | null = null;

  private remove(z: Zombie): void {
    z.body.dispose();
    this.host.combat.removeFighter(z.id);
    this.onRemoved?.(z.id);
  }
}

/** Zombi decodificado en el cliente. */
export interface PublicZombie { num: number; x: number; y: number; z: number; yaw: number; anim: ZombieAnim; hp: number }

/** Decodifica y valida (máx. 16 entradas: 8 vivos + cadáveres). */
export function unpackZombies(z: unknown): PublicZombie[] {
  if (!Array.isArray(z) || z.length % ZOMBIE_STRIDE !== 0 || z.length > 16 * ZOMBIE_STRIDE) return [];
  const out: PublicZombie[] = [];
  for (let i = 0; i < z.length; i += ZOMBIE_STRIDE) {
    const v = z.slice(i, i + ZOMBIE_STRIDE) as unknown[];
    if (!v.every((n) => typeof n === 'number' && Number.isFinite(n))) return [];
    const n = v as number[];
    if (!Number.isSafeInteger(n[0]) || n[0]! < 0 || !(n[5]! >= 0 && n[5]! <= 5) || !(n[6]! >= 0 && n[6]! <= ZOMBIE.hp)) return [];
    out.push({ num: n[0]!, x: n[1]! / 100, y: n[2]! / 100, z: n[3]! / 100, yaw: n[4]! / 1000, anim: n[5]! as ZombieAnim, hp: n[6]! });
  }
  return out;
}
