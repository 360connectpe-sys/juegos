import type { RoundSnapshot } from './BattleRound';
import type { Circle } from './zone';
const number = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const circle = (c: Circle): boolean => !!c && number(c.x, -10000, 10000) && number(c.z, -10000, 10000) && number(c.radius, 0, 10000);
/** Snapshot acotado (máximo 8 competidores) antes de tocar minimapa, HUD o física. */
export function validRound(s: unknown): s is RoundSnapshot {
  if (!s || typeof s !== 'object') return false;
  const r = s as RoundSnapshot, z = r.zone;
  if (!Number.isSafeInteger(r.round) || r.round < 0 || !['waiting', 'countdown', 'running', 'finished'].includes(r.phase) ||
    !number(r.elapsed, 0, 1800) || !number(r.countdown, 0, 10) || !z || !circle(z.current) || !circle(z.next) ||
    !Number.isInteger(z.phase) || z.phase < 0 || z.phase > 7 || !number(z.damage, 0, 50) ||
    typeof z.warning !== 'boolean' || typeof z.closing !== 'boolean' || !number(z.changesIn, 0, 1800)) return false;
  if (!Array.isArray(r.players) || r.players.length > 8 || !r.players.every(p => p && typeof p.id === 'string' && p.id.length <= 64 &&
    Number.isInteger(p.lives) && p.lives >= 0 && p.lives <= 3 && typeof p.descending === 'boolean' && number(p.protection, 0, 3))) return false;
  if (new Set(r.players.map(p => p.id)).size !== r.players.length) return false;
  if (r.result !== null) {
    const result = r.result;
    if (!result || result.round !== r.round || !number(result.elapsed, 0, 1800) || !['draw', 'limit', 'survivor'].includes(result.reason) ||
      !Array.isArray(result.scores) || result.scores.length > 8 || !Array.isArray(result.winners) || result.winners.length > 8 ||
      !result.winners.every(id => typeof id === 'string' && result.scores.some(p => p && p.id === id)) ||
      !result.scores.every(p => p && typeof p.id === 'string' && p.id.length <= 64 && typeof p.name === 'string' && p.name.length <= 64 &&
        typeof p.forfeited === 'boolean' && Number.isInteger(p.lives) && number(p.lives, 0, 3) && number(p.hp, 0, 100) &&
        ['shots', 'hits', 'damageDealt', 'damageTaken', 'kills', 'eliminations', 'deaths', 'healed'].every(key => number(p[key as keyof typeof p], 0, 1e9)))) return false;
  }
  return true;
}
