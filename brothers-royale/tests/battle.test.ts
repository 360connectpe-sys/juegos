import { describe, expect, it } from 'vitest';
import { BattleRound, type RoundActor } from '@shared/battle/BattleRound';
import { contains, ROUND_SECONDS, zoneAt, zonePlan, ZONE_PHASES } from '@shared/battle/zone';
import { validRound } from '@shared/battle/validation';
import { CombatState } from '@shared/combat/CombatState';
import { MatchState } from '@shared/match/MatchState';
import { Buttons, emptyInput } from '@shared/types';
import { addItem } from '@shared/inventory';

function setup(count = 2) {
  const match = new MatchState([], 1), combat = new CombatState(match, 1);
  const actors: RoundActor[] = Array.from({ length: count }, (_, i) => ({ id: 'p'+i, name: 'Jugador '+i, feet: { x: 0, y: 0, z: 0 }, grounded: true, connected: true }));
  const round = new BattleRound(combat, 120, 1, {
    actors: () => actors, reset: ids => { match.reset(ids); combat.reset(ids); },
    spawn: (id, zone) => { const a = actors.find(a => a.id === id)!; a.feet = { x: zone.x, y: 30, z: zone.z }; a.grounded = false; },
  });
  for (const a of actors) { match.addPlayer(a.id); combat.addFighter(a.id); }
  combat.onRespawn = id => round.respawn(id);
  const step = (seconds: number) => { for (let n = 0; n < Math.round(seconds * 30); n++) { round.before(1/30); round.after(1/30, n); } };
  return { match, combat, actors, round, step };
}

describe('tres vidas y ciclo autoritativo', () => {
  it('tiene 100 HP por vida, espera cinco segundos y elimina definitivamente tras la tercera', () => {
    const w = setup(); w.round.start();
    let inv = addItem(w.match.inventory('p0')!, { kind: 'rifle', qty: 1, rarity: 'rare' }).inventory;
    w.match.setInventory('p0', inv);
    for (let life = 2; life >= 0; life--) {
      w.combat.environmentalDamage('p0', 100, w.actors[0]!.feet, 1);
      expect(w.combat.lives('p0')).toBe(life);
      expect(w.combat.isDead('p0')).toBe(true);
      if (life > 0) {
        w.step(4.9); expect(w.combat.isDead('p0')).toBe(true);
        w.step(.1); expect(w.combat.hp('p0')).toBe(100);
        expect(w.actors[0]!.feet.y).toBe(30);
        expect(w.combat.vitals('p0')?.descending).toBe(true);
        expect(w.match.inventory('p0')).toBe(inv);
      }
    }
    w.step(10);
    expect(w.combat.lives('p0')).toBe(0);
    expect(w.round.history[0]?.winners).toEqual(['p1']);
  });
  it('al aterrizar protege tres segundos y el ataque efectivo la cancela antes de resolverlo', () => {
    const w = setup();
    w.combat.environmentalDamage('p0', 100, w.actors[0]!.feet, 0); w.step(5);
    w.combat.landed('p0'); expect(w.combat.vitals('p0')?.protection).toBe(3);
    w.combat.environmentalDamage('p0', 50, w.actors[0]!.feet, 1); expect(w.combat.hp('p0')).toBe(100);
    w.step(2.9); expect(w.combat.vitals('p0')!.protection).toBeGreaterThan(0);
    w.combat.idle('p0', .3); // termina el desenfundado tras reaparecer
    w.combat.step('p0', { ...emptyInput(1), buttons: Buttons.FIRE }, { feet: w.actors[0]!.feet, grounded: true, speed: 0, dt: 1/30, tick: 1, targets: () => [], castStatic: () => null });
    expect(w.combat.vitals('p0')?.protection).toBe(0);
    w.combat.environmentalDamage('p0', 50, w.actors[0]!.feet, 1); expect(w.combat.hp('p0')).toBe(50);
  });
  it('la protección expira sin entradas y no se renueva mientras permanece apoyado', () => {
    const w = setup(); w.round.start();
    w.combat.environmentalDamage('p0', 100, w.actors[0]!.feet, 0); w.step(5);
    w.actors[0]!.grounded = true; w.round.after(0, 1);
    w.step(3.1); expect(w.combat.vitals('p0')?.protection).toBe(0);
    w.round.after(0, 1); expect(w.combat.vitals('p0')?.protection).toBe(0);
  });
  it('espera jugadores, cuenta diez segundos y reinicia inventarios y estadísticas al comenzar', () => {
    const w = setup(1); w.step(20); expect(w.round.phase).toBe('waiting');
    w.actors.push({ ...w.actors[0]!, id: 'p1' });
    w.step(1/30); expect(w.round.phase).toBe('countdown');
    w.step(9.9); expect(w.round.phase).toBe('countdown'); w.step(.1);
    expect(w.round.phase).toBe('running'); expect(w.combat.lives('p0')).toBe(3);
  });
  it('una nueva sesión en curso es espectadora, la desconexión reservada no regala vidas', () => {
    const w = setup(); w.round.start();
    w.combat.environmentalDamage('p0', 100, w.actors[0]!.feet, 0);
    w.actors[0]!.connected = false; w.step(5); w.actors[0]!.connected = true;
    expect(w.combat.lives('p0')).toBe(2);
    w.match.addPlayer('nuevo'); w.combat.addFighter('nuevo'); w.round.joined('nuevo');
    expect(w.combat.lives('nuevo')).toBe(0); expect(w.round.canAct('nuevo')).toBe(false);
  });
  it('abandonar definitivamente causa derrota y conserva estadísticas acotadas', () => {
    const w = setup(); w.round.start(); w.combat.log.of('p0').kills = 2;
    w.round.departed('p0'); w.combat.removeFighter('p0'); w.round.after(0, 1);
    expect(w.round.history[0]?.winners).toEqual(['p1']);
    expect(w.round.history[0]?.scores.find(p => p.id === 'p0')).toMatchObject({ forfeited: true, kills: 2, lives: 0 });
  });
  it.each(['lives', 'eliminations', 'hp', 'tie'] as const)('el límite estricto desempata por %s', criterion => {
    const w = setup(); w.round.start();
    if (criterion === 'lives') w.combat.environmentalDamage('p1', 100, w.actors[1]!.feet, 1);
    if (criterion === 'eliminations') w.combat.log.of('p0').eliminations = 2;
    if (criterion === 'hp') w.combat.setHp('p1', 80);
    w.round.syncWallTime(0); // el inicio sin reloj permite simulación acelerada determinista
    w.round.elapsed = 1799 + 29/30;
    w.round.before(1/30);
    const result = w.round.snapshot().result!;
    expect(w.round.phase).toBe('finished'); expect(result.elapsed).toBe(ROUND_SECONDS);
    expect(result.winners).toEqual(criterion === 'tie' ? ['p0','p1'] : ['p0']);
    expect(result.reason).toBe(criterion === 'tie' ? 'draw' : 'limit');
    expect(w.combat.active).toBe(false);
  });
  it('el reloj monotónico impide extender la ronda tras un bloqueo del bucle', () => {
    const w = setup(); w.round.syncWallTime(100); w.round.start();
    w.round.syncWallTime(1900); w.round.before(1/30);
    expect(w.round.snapshot().result?.elapsed).toBe(1800); expect(w.round.phase).toBe('finished');
  });
  it('muertes simultáneas no declaran un ganador por orden de procesamiento', () => {
    const w = setup(); w.round.start();
    for (let n = 0; n < 3; n++) { for (const a of w.actors) w.combat.environmentalDamage(a.id, 100, a.feet, 0); if (n < 2) w.step(5); }
    w.round.after(0, 1); expect(w.round.snapshot().result?.winners).toEqual([]); expect(w.round.snapshot().result?.reason).toBe('draw');
  });
  it('el daño de tormenta no crea atacantes ficticios ni eliminaciones gratuitas', () => {
    const w = setup(); w.round.start(); w.round.elapsed = 180;
    w.actors[0]!.feet.x = 100;
    w.step(1); expect(w.combat.hp('p0')).toBe(99);
    expect(w.combat.log.stats.has('storm')).toBe(false);
    expect(w.combat.log.of('p0').kills).toBe(0);
  });
  it('archiva estadísticas separadas y no más de diez resultados', () => {
    const w = setup();
    for (let i = 0; i < 12; i++) {
      w.round.start(); w.combat.log.of('p0').kills = i;
      w.round.elapsed = 1800; w.round.before(1/30); w.step(10);
    }
    expect(w.round.history).toHaveLength(10);
    expect(w.round.history[0]!.scores[0]!.kills).toBe(2);
    expect(w.combat.log.stats.size).toBe(0);
    expect(w.combat.lives('p0')).toBe(3);
  });
});

describe('zona determinista y contrato', () => {
  it('respeta cronograma, radios objetivos y aviso con exactamente treinta segundos', () => {
    const plan = zonePlan(120, 17), initial = plan[0]!.radius;
    for (let phase = 0; phase < 8; phase++) {
      const [start, fraction, damage] = ZONE_PHASES[phase]!;
      const z = zoneAt(plan, phase ? start + 60 : 0);
      expect(z.current.radius).toBeCloseTo(initial * fraction, 8); expect(z.damage).toBe(damage);
    }
    expect(zoneAt(plan,149.99).warning).toBe(false); expect(zoneAt(plan,150).warning).toBe(true);
    expect(zoneAt(plan,179.99).warning).toBe(true); expect(zoneAt(plan,180).closing).toBe(true);
    expect(zoneAt(plan,1800).current.radius).toBe(0); expect(contains(zoneAt(plan,1800).current, {x:0,z:0})).toBe(false);
  });
  it('los círculos se desplazan, quedan anidados y usan semilla reproducible', () => {
    const plan = zonePlan(120, 17); expect(plan).toEqual(zonePlan(120, 17)); expect(plan).not.toEqual(zonePlan(120, 18));
    expect(plan.some(c => c.x !== 0 || c.z !== 0)).toBe(true);
    for (let i = 1; i < plan.length; i++) expect(Math.hypot(plan[i]!.x-plan[i-1]!.x,plan[i]!.z-plan[i-1]!.z)+plan[i]!.radius).toBeLessThanOrEqual(plan[i-1]!.radius+1e-8);
  });
  it('valida antes de dibujar y rechaza vidas, centros, resultados y colecciones malformados', () => {
    const s = setup().round.snapshot(); expect(validRound(s)).toBe(true);
    for (const bad of [null, {}, {...s, elapsed:Infinity}, {...s,zone:{...s.zone,current:{x:NaN,z:0,radius:1}}}, {...s, players:Array(9).fill(s.players[0])}, {...s, players:[{...s.players[0],lives:4}]}, {...s, result:{winners:['extraño'],scores:[]}}, {...s,result:{round:0,elapsed:0,reason:'draw',winners:['p0'],scores:[null]}}]) expect(validRound(bad)).toBe(false);
  });
});

it('ciclo acelerado completo de treinta minutos con ocho competidores y reinicio', () => {
  const w=setup(8);w.round.start();
  const phases=new Set<number>();const start=performance.now();let ticks=0;
  while(w.round.phase==='running' && ticks<54001){
    const zone=w.round.zone.current;
    // Fixture mantiene los competidores en zona para alcanzar el límite sin un ganador anterior.
    for(const a of w.actors){a.feet.x=zone.x;a.feet.z=zone.z;}
    w.round.before(1/30);w.round.after(1/30,ticks++);phases.add(w.round.zone.phase);
  }
  const result=w.round.snapshot().result!;
  expect(ticks).toBe(54000);expect(result.elapsed).toBe(1800);expect(result.reason).toBe('draw');
  expect(result.winners).toHaveLength(8);expect([...phases]).toEqual([0,1,2,3,4,5,6,7]);
  expect(result.scores.every(p=>p.lives===3)).toBe(true);
  w.step(10);expect(w.round.phase).toBe('waiting');expect(w.round.history).toHaveLength(1);
  expect(w.round.start()).toBe(true);expect(w.round.round).toBe(2);expect(w.round.elapsed).toBe(0);
  console.log('PHASE8_ACCELERATED',JSON.stringify({ticks,virtualSeconds:1800,realMs:performance.now()-start,phases:[...phases],players:8}));
});

it('las bajas de vida y las eliminaciones definitivas se registran por separado', () => {
  const w=setup();w.round.start();
  for(let i=0;i<2;i++){w.combat.environmentalDamage('p1',100,w.actors[1]!.feet,0);w.step(5);}
  w.actors[1]!.feet={x:0,y:0,z:5};w.combat.setHp('p1',1);
  const inv=addItem(w.match.inventory('p0')!,{kind:'rifle',qty:1,rarity:'rare'}).inventory;
  w.match.setInventory('p0',inv);w.match.selectSlot('p0',1);
  const ctx={feet:{x:0,y:0,z:0},grounded:true,speed:0,dt:1/30,tick:1,targets:()=>[{id:'p1',feet:w.actors[1]!.feet}],castStatic:()=>null};
  for(let seq=1;seq<=12;seq++)w.combat.step('p0',emptyInput(seq),ctx);
  w.combat.step('p0',{...emptyInput(13),buttons:Buttons.FIRE|Buttons.AIM},ctx);
  expect(w.combat.lives('p1')).toBe(0);
  expect(w.combat.log.of('p0')).toMatchObject({kills:1,eliminations:1});
  expect(w.combat.log.stats.has('storm')).toBe(false);
});
