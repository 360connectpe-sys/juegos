/** Comprobaciones cortas del contrato v10; sin red, render ni simulaciones prolongadas. */
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@shared/protocol';
import { packGear, unpackGear } from '@shared/combat/gear';
import { packPlayer, unpackPlayers } from '@shared/netcodec';
import { MatchState } from '@shared/match/MatchState';
import { addItem, isValidInventory, magOf } from '@shared/inventory';
import { CombatState, type AttackContext } from '@shared/combat/CombatState';
import { WEAPON_STATS, reloadSeconds } from '@shared/combat/weapons';
import { isValidDamageEvent } from '@/net/CombatView';
import { isValidPickup } from '@/net/MatchView';
import { Buttons, type PlayerState } from '@shared/types';
import { FLIGHT } from '@shared/battle/flight';
import { ZOMBIE, zombieLoot } from '@shared/zombies/zombieAi';
import { createRng } from '@shared/random';
import { rollChestLoot } from '@shared/match/loot';

const feet={x:0,y:0,z:0};
function inventoryFixture(){
  const match=new MatchState([],7);match.addPlayer('a');
  let inv=addItem(match.inventory('a')!,{kind:'rifle',qty:1,mag:7}).inventory;
  inv=addItem(inv,{kind:'scope2',qty:1}).inventory;inv.selected=1;match.setInventory('a',inv);
  return match;
}
function shotFixture(pitch=0,wall:number|null=null){
  const match=new MatchState([],7);match.addPlayer('a');match.addPlayer('b');
  const inv=addItem(match.inventory('a')!,{kind:'sniper',qty:1}).inventory;inv.selected=1;match.setInventory('a',inv);
  const combat=new CombatState(match,7);combat.addFighter('a');combat.addFighter('b');
  const ctx:AttackContext={feet,grounded:true,speed:0,dt:1.5,tick:1,targets:()=>[{id:'b',feet:{x:0,y:0,z:10}}],castStatic:()=>wall};
  const shoot=()=>combat.step('a',{seq:1,moveX:0,moveZ:0,aimYaw:0,aimPitch:pitch,buttons:Buttons.FIRE|Buttons.AIM},ctx);
  return {combat,shoot,match};
}
describe('fase 14 · contrato básico',()=>{
  it('declara v10 y conserva el bit de mira en snapshots',()=>{
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(10); // fase 15: v11 (construcción), conserva lo de v10;
    const gear=packGear({held:'rifle',rarity:'epic',action:'aim',dead:false,scope:'x2'});
    const state:PlayerState={id:'a',name:'A',position:feet,velocity:feet,yaw:0,grounded:true,locomotion:'idle',lastProcessedSeq:1};
    const packed:number[]=[];packPlayer(packed,1,state,gear);
    expect(unpackGear(unpackPlayers(packed)[0]!.gear).scope).toBe('x2');
    expect(unpackGear(packGear({held:'sniper',rarity:'rare',action:'reload',dead:false})).held).toBe('sniper');
  });
  it('equipar y retirar conserva objetos y cargador, incluso con inventario lleno',()=>{
    const m=inventoryFixture(), totals=m.totals();
    expect(m.equipScope('a',true,feet)).toBe(true);expect(m.equipScope('a',true,feet)).toBe(false);
    expect(m.totals()).toEqual(totals);expect(magOf(m.inventory('a')!.slots[1]!)).toBe(7);
    let inv=m.inventory('a')!;for(let i=0;i<3;i++)inv=addItem(inv,{kind:'medkit',qty:3}).inventory;
    m.setInventory('a',inv);const full=m.totals();expect(m.equipScope('a',false,feet)).toBe(true);
    expect(m.totals()).toEqual(full);expect([...m.pickups.values()].filter(p=>p.item.kind==='scope2')).toHaveLength(1);
    expect(m.equipScope('a',false,feet)).toBe(false);
  });
  it('rechaza equipamiento malformado y miras en objetos incompatibles',()=>{
    const m=inventoryFixture();expect(m.equipScope('a','true',feet)).toBe(false);
    m.selectSlot('a',0);expect(m.equipScope('a',true,feet)).toBe(false);
    const inv=m.inventory('a')!;inv.slots[0]!.scope='x2';expect(isValidInventory(inv)).toBe(false);
    expect(isValidPickup({id:1,x:0,y:0,z:0,item:{kind:'sniper',qty:1,scope:'x2'}})).toBe(false);
  });
  it('francotirador: 65 cuerpo, 100 cabeza, cinco balas, 1.5 s y recarga de 3 s',()=>{
    expect(WEAPON_STATS.sniper).toMatchObject({damage:65,magazine:5,fireRate:1/1.5,range:150});
    expect(reloadSeconds('sniper','epic')).toBe(3);
    const body=shotFixture(Math.atan2(-.5,10));body.shoot();expect(body.combat.vitals('b')!.hp).toBe(35);
    const head=shotFixture(Math.atan2(.25,10));head.shoot();expect(head.combat.vitals('b')!.hp).toBe(0);
    expect(magOf(head.match.inventory('a')!.slots[1]!)).toBe(4);
  });
  it('las paredes bloquean también la cabeza',()=>{
    const f=shotFixture(Math.atan2(.25,10),5);f.shoot();expect(f.combat.vitals('b')!.hp).toBe(100);
  });
  it('avión protegido; caída vulnerable; daño aéreo cancela protección al aterrizar',()=>{
    const f=shotFixture(Math.atan2(-.5,10));f.combat.beginDescent('b',true);f.shoot();expect(f.combat.vitals('b')!.hp).toBe(100);
    f.combat.leavePlane('b');f.shoot();expect(f.combat.vitals('b')!.hp).toBe(35);
    f.combat.landed('b');expect(f.combat.vitals('b')!.protection).toBe(0);
    f.combat.beginDescent('b');f.combat.landed('b');expect(f.combat.vitals('b')!.protection).toBe(3);
  });
  it('no permite disparar durante el descenso',()=>{
    const f=shotFixture();f.combat.beginDescent('a');f.shoot();expect(magOf(f.match.inventory('a')!.slots[1]!)).toBe(5);
  });
  it('el cliente admite 100 de daño solo en categorías autorizadas',()=>{
    const damage={type:'damage',victim:'b',by:'a',weapon:'sniper',amount:100,hp:0,at:feet};
    expect(isValidDamageEvent(damage)).toBe(true);expect(isValidDamageEvent({...damage,weapon:'rifle'})).toBe(false);
  });
  it('cofres deterministas incluyen miras y francotirador; zombis solo munición/curación',()=>{
    const loot=Array.from({length:100},(_,i)=>rollChestLoot(7,i)).flat();
    expect(loot.some(s=>s.kind==='sniper')).toBe(true);expect(loot.some(s=>s.kind==='scope2')).toBe(true);
    expect(rollChestLoot(7,1)).toEqual(rollChestLoot(7,1));
    const rng=createRng(7);for(let i=0;i<32;i++)expect(['medkit','ammo_light','ammo_medium']).toContain(zombieLoot(rng).kind);
    expect(ZOMBIE).toMatchObject({hp:40,damage:5,spawnEvery:50,attackInterval:1.3,maxActive:8});
    expect(FLIGHT).toMatchObject({speed:10.5,respawnSpeed:14,chuteSpeed:3.6,chuteFastSpeed:6.4});
  });
});
