import { expect, it } from 'vitest';
import { benchPrefix } from '../server/bench';
import { CombatState } from '@shared/combat/CombatState';
import { MatchState } from '@shared/match/MatchState';
import { addItem } from '@shared/inventory';
import { Buttons, emptyInput } from '@shared/types';
it.each(['production', 'development', undefined])('el loadout no se activa en %s', (NODE_ENV) => {
  expect(() => benchPrefix({ NODE_ENV, BR_BENCH_LOADOUT: 'Bot' }, ['--br-bench-loadout'])).toThrow();
});
it('el loadout requiere además el argumento explícito en tests', () => {
  expect(() => benchPrefix({ NODE_ENV: 'test', BR_BENCH_LOADOUT: 'Bot' }, [])).toThrow();
  expect(benchPrefix({ NODE_ENV: 'test', BR_BENCH_LOADOUT: 'Bot' }, ['--br-bench-loadout'])).toBe('Bot');
});
it('cambiar de hueco en el tick de completar curación la cancela antes de consumir', () => {
  const match = new MatchState([], 1);
  match.addPlayer('a');
  match.setInventory('a', addItem(match.inventory('a')!, { kind: 'medkit', qty: 1 }).inventory);
  match.selectSlot('a', 1);
  const combat = new CombatState(match, 1);
  combat.addFighter('a');combat.setHp('a', 20);
  const ctx = { feet: { x: 0, y: 0, z: 0 }, grounded: true, speed: 0, dt: 1 / 30, tick: 1, targets: () => [], castStatic: () => null };
  combat.step('a', { ...emptyInput(1), buttons: Buttons.FIRE }, ctx);
  combat.idle('a', 4.99);
  match.selectSlot('a', 0);
  combat.step('a', emptyInput(2), ctx);
  expect(combat.hp('a')).toBe(20);
  expect(match.inventory('a')!.slots[1]!.qty).toBe(1);
});
it('retirar jugadores no acumula estadísticas sin límite', () => {
  const combat = new CombatState(new MatchState([], 1), 1);
  for (let i = 0; i < 300; i++) { combat.addFighter(String(i));combat.log.of(String(i));combat.removeFighter(String(i)); }
  expect(combat.log.stats.size).toBe(0);
});
it('reaparecer invalida poses de la vida anterior para compensación de latencia', async () => {
  const { ServerWorld } = await import('../server/ServerWorld');
  const world = await ServerWorld.create();
  try {
    const p = world.addPlayer('a', 'A');
    const old = { x: 40, y: 30, z: 40 };
    world.history.record(1, 'a', old);
    world.tick = 2;
    world.combat.onRespawn?.('a');
    expect(world.history.pose('a', 1)).toEqual(p.body.state.position);
    expect(world.history.pose('a', 1)).not.toEqual(old);
  } finally { world.dispose(); }
});
