import { ROUND_SECONDS } from '@shared/battle/zone';
import { describe, expect, it } from 'vitest';
import { ServerWorld } from '../server/ServerWorld';
import { OfflineSession } from '@/net/OfflineSession';
import { PredictionController } from '@/net/Prediction';
import { CharacterBody } from '@/physics/CharacterBody';
import { PhysicsWorld, loadRapier } from '@/physics/PhysicsWorld';
import { contains } from '@shared/battle/zone';
import { Buttons, emptyInput } from '@shared/types';
import { addItem } from '@shared/inventory';

const step = (w: ServerWorld, ticks: number) => { for (let t = 0; t < ticks; t++) w.step(); };
describe('integración física del ciclo', () => {
  it('reaparece desde el cielo, dirige descenso dentro del círculo y protege al aterrizar', async () => {
    const w = await ServerWorld.create(undefined, 1);
    try {
      const a = w.addPlayer('a','A'), b = w.addPlayer('b','B'); w.round.start();
      w.combat.environmentalDamage('a',100,a.body.state.position,0); step(w,149);
      expect(w.combat.isDead('a')).toBe(true); step(w,1);
      expect(w.combat.isDead('a')).toBe(false); expect(a.body.state.position.y).toBeGreaterThan(20);
      const x = a.body.state.position.x;
      let seq = 0;
      for (let t = 0; t < 400 && w.combat.vitals('a')?.descending; t++) {
        w.queueInput('a',{...emptyInput(++seq),moveX:1});w.step();
        expect(contains(w.round.zone.current,a.body.state.position)).toBe(true);
      }
      expect(a.body.state.position.x).toBeGreaterThan(x+1);
      expect(a.body.state.grounded).toBe(true); expect(w.combat.vitals('a')?.protection).toBe(3);
      w.combat.environmentalDamage('a',50,a.body.state.position,1); expect(w.combat.hp('a')).toBe(100);
      w.queueInput('a',{...emptyInput(++seq),buttons:Buttons.FIRE});w.step();
      expect(w.combat.vitals('a')?.protection).toBe(0);
      expect(w.combat.lives(b.id)).toBe(3);
    } finally { w.dispose(); }
  });
  it('un burst de entradas no acelera los cinco segundos de espera', async () => {
    const w = await ServerWorld.create();
    try {
      const a = w.addPlayer('a','A');w.addPlayer('b','B');w.round.start();
      w.combat.environmentalDamage('a',100,a.body.state.position,0);
      for (let t = 0; t < 120; t++) {
        for (let n = 0; n < 3; n++) w.queueInput('a',emptyInput(t*3+n+1));w.step();
      }
      expect(w.combat.isDead('a')).toBe(true);
      expect(w.combat.vitals('a')?.respawnIn).toBeCloseTo(1,5);
    } finally { w.dispose(); }
  });
  it('reinicia todo el mundo y conserva secuencias sin duplicar el inventario entre vidas', async () => {
    const w = await ServerWorld.create(undefined,1);
    try {
      const a = w.addPlayer('a','A');w.addPlayer('b','B');w.round.start();
      const inv = addItem(w.match.inventory('a')!,{kind:'rifle',qty:1,rarity:'rare'}).inventory;
      w.match.setInventory('a',inv);
      w.queueInput('a',emptyInput(10));w.step();
      w.building.state.hitTree('a',0,90,true);
      w.building.state.place('a',{kind:'wall',x:0,y:0,z:12,rotation:0},{x:0,y:0,z:17});
      const chest = w.layout.chests[0]!;
      w.match.interact('a',{x:chest.x,y:chest.y,z:chest.z},()=>true);
      expect(w.match.opened.some(Boolean)).toBe(true);
      w.combat.environmentalDamage('a',100,a.body.state.position,0);step(w,150);
      expect(w.match.inventory('a')).toBe(inv);
      w.combat.log.of('a').kills=4;
      w.round.elapsed=ROUND_SECONDS;w.step();expect(w.round.phase).toBe('finished');
      const revision=w.building.state.revision;step(w,300);
      expect(w.round.phase).toBe('waiting');
      expect(w.match.opened.every(v=>!v)).toBe(true);expect(w.match.pickups.size).toBe(0);
      expect(w.match.inventory('a')!.slots.filter(Boolean)).toHaveLength(1);
      expect(w.building.state.trees.every(h=>h===90)).toBe(true);expect(w.building.state.pieces.size).toBe(0);
      expect(w.building.state.wood.get('a')).toBe(0);expect(w.building.state.revision).toBeGreaterThan(revision);
      expect(w.combat.lives('a')).toBe(3);expect(w.combat.hp('a')).toBe(100);expect(w.combat.log.stats.size).toBe(0);
      expect(w.queueInput('a',emptyInput(10))).toBe('invalid');
      expect(w.round.history[0]!.scores.find(s=>s.id==='a')?.kills).toBe(4);
    } finally { w.dispose(); }
  });
  it('predicción y reconciliación reproducen exactamente el descenso con entradas pendientes', async () => {
    const physics = new PhysicsWorld(await loadRapier());
    const a = new CharacterBody(physics,'a','A',{x:0,y:30,z:0}), b = new CharacterBody(physics,'b','B',{x:0,y:30,z:0});
    try {
      a.modifiers.descent={x:0,z:0,radius:3};b.modifiers={...a.modifiers};
      const prediction=new PredictionController(b,1/30);
      for(let seq=1;seq<=20;seq++){const input={...emptyInput(seq),moveX:1};a.step(input,1/30);prediction.predict(input);}
      const ack=a.snapshot();
      for(let seq=21;seq<=50;seq++){const input={...emptyInput(seq),moveX:1};a.step(input,1/30);prediction.predict(input);}
      prediction.reconcile(ack,20);
      expect(b.snapshot()).toEqual(a.snapshot());expect(a.state.position.x).toBeLessThan(3);
    } finally { a.dispose();b.dispose();physics.dispose(); }
  });
  it('offline ofrece el mismo ciclo y restaura vidas al empezar una ronda', async () => {
    const physics = new PhysicsWorld(await loadRapier());
    const session = new OfflineSession(physics,{x:0,y:0,z:0},'A',[],1,[{x:8,y:0,z:0}]);
    try {
      expect(session.startRound()).toBe(true);
      for(let i=0;i<3;i++){
        session.fight.environmentalDamage('local',100,session.local.state.position,0);
        if(i<2)for(let t=0;t<150;t++)session.tick(emptyInput(i*150+t+1),1/30);
      }
      session.tick(emptyInput(301),1/30);
      expect(session.combat.vitals.lives).toBe(0);expect(session.battle.result?.winners).toEqual(['dummy-1']);
    } finally { session.dispose();physics.dispose(); }
  });
});
