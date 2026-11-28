import { ROUND_SECONDS } from '@shared/battle/zone';
import { Buttons,emptyInput } from '@shared/types';
import { describe,expect,it } from 'vitest';
import { LobbyState,validLobby } from '@shared/lobby/LobbyState';
import { isSkin,SHIRTS,validProfile } from '@shared/lobby/profile';
import { validateJoinOptions } from '@shared/session';
import { PROTOCOL_VERSION } from '@shared/protocol';
import { BattleRound,type RoundPhase } from '@shared/battle/BattleRound';
import { CombatState } from '@shared/combat/CombatState';
import { MatchState } from '@shared/match/MatchState';
import { BuildingState } from '@shared/building/BuildingState';
import { paletteColors } from '@/game/entities/PlayerAvatar';
// Estas pruebas cubren sistemas ajenos al avión (fase 12): la ronda empieza en tierra como antes.
BattleRound.defaultTransport = false;

describe('perfiles y permisos de lobby',()=>{
 it('doce polos solo cambian el color de camisa y rechazan índices malformados',()=>{
  expect(SHIRTS).toHaveLength(12);
  for(let i=0;i<12;i++){expect(isSkin(i)).toBe(true);expect(paletteColors(i)).toMatchObject({pants:paletteColors(0).pants,skin:paletteColors(0).skin,hair:paletteColors(0).hair});}
  for(const skin of [-1,12,NaN,Infinity,'1',null,1.5])expect(isSkin(skin)).toBe(false);
  expect(validProfile({name:'Ana',skin:11,host:'yo',hp:999})).toBe(true);
  for(const name of ['',123,'\u0000', 'x'.repeat(100)])expect(validProfile({name,skin:0})).toBe(false);
  expect(validateJoinOptions({protocol:PROTOCOL_VERSION,name:'Ana',skin:12})).toEqual({ok:false,reason:'options'});
 });
 it('elige anfitrión, exige cargas y Listo, y nunca toma el id de un mensaje',()=>{
  const l=new LobbyState('PRUEBA',()=> 'waiting');l.add('a','Ana',0);l.add('b','Beto',1);
  expect(l.host).toBe('a');expect(l.mayStart('a')).toBe(false);
  l.loaded('a');l.loaded('b');expect(l.ready('b','true')).toBe(false);
  expect(l.ready('b',true)).toBe(true);expect(l.mayStart('b')).toBe(false);expect(l.mayStart('a')).toBe(true);
  expect(validLobby(l.snapshot())).toBe(true);
 });
 it('transfiere anfitrión tras una caída, lo conserva al reconectar y mantiene la plaza',()=>{
  const l=new LobbyState('',()=> 'waiting');for(const id of ['a','b','c']){l.add(id,id,0);l.loaded(id);}
  l.ready('b',true);l.connected('a',false);expect(l.host).toBe('b');expect(l.players.size).toBe(3);expect(l.canStart).toBe(false);
  l.connected('a',true);l.loaded('a');expect(l.host).toBe('b');l.remove('b');expect(l.host).toBe('a');
 });
 it('rechaza perfiles y Listo durante cuenta atrás o partida y limita ocho miembros',()=>{
  let phase:RoundPhase='waiting';const l=new LobbyState('',()=>phase);
  for(let i=0;i<8;i++)l.add(String(i),'P'+i,i);
  expect(()=>l.add('9','Noveno',0)).toThrow();l.loaded('0');
  phase='countdown';expect(l.ready('0',true)).toBe(false);expect(l.profile('0','Otra',3)).toBe(false);
  phase='running';expect(l.mayStart('0')).toBe(false);phase='waiting';expect(l.profile('0','Otra',11)).toBe(true);
 });
 it('no acepta colecciones, anfitriones ni perfiles de red malformados',()=>{
  const l=new LobbyState('',()=> 'waiting');l.add('a','Ana',0);const s=l.snapshot();
  for(const bad of [null,{}, {...s,host:'extraño'},{...s,players:Array(9).fill(s.players[0])},{...s,players:[{...s.players[0],skin:NaN}]},{...s,players:[{...s.players[0],name:'\u0000Ana'}]}])expect(validLobby(bad)).toBe(false);
 });
});

it('las estadísticas cuentan solo madera y construcciones autoritativas y conservan posición y supervivencia',()=>{
 const match=new MatchState([],1),fight=new CombatState(match,1);
 const actors=['a','b'].map(id=>({id,name:id,feet:{x:0,y:0,z:0},grounded:true,connected:true}));
 const round=new BattleRound(fight,120,1,{actors:()=>actors,reset:ids=>{match.reset(ids);fight.reset(ids);},spawn:()=>undefined});
 round.start();
 const builds=new BuildingState(1,120,{ground:()=>0,clear:()=>true,changed:()=>undefined});
 builds.onHarvest=(id,n)=>round.harvest(id,n);builds.onBuild=id=>round.built(id);builds.addPlayer('a');
 for(let n=0;n<20;n++)builds.hitTree('a',0,15,true);
 const r={kind:'wall',x:0,y:0,z:0,rotation:0};expect(builds.place('a',r,{x:0,y:0,z:5})).toBe(true);expect(builds.place('a',r,{x:0,y:0,z:5})).toBe(false);
 fight.log.of('a').rangedShots=10;fight.log.of('a').accurateShots=4;fight.log.of('a').eliminations=1;
 round.elapsed=ROUND_SECONDS;round.before(1/30);
 const a=round.snapshot().result!.scores.find(p=>p.id==='a')!;
 expect(a).toMatchObject({woodCollected:30,structuresBuilt:1,accuracy:40,survivalSeconds:ROUND_SECONDS,position:1});
 expect(round.snapshot().result!.winners).toEqual(['a']);
});

it('el daño final mide HP realmente perdidos sin sumar exceso sobre una vida',()=>{
 const match=new MatchState([],1),fight=new CombatState(match,1);
 const actors=['a','b'].map((id,i)=>({id,name:id,feet:{x:0,y:0,z:i*1.5},grounded:true,connected:true}));
 const round=new BattleRound(fight,120,1,{actors:()=>actors,reset:ids=>{match.reset(ids);fight.reset(ids);},spawn:()=>undefined});round.start();fight.setHp('b',5);
 fight.step('a',{...emptyInput(1),buttons:Buttons.FIRE},{feet:actors[0]!.feet,grounded:true,speed:0,dt:1/30,tick:0,targets:()=>[{id:'b',feet:actors[1]!.feet}],castStatic:()=>null});
 expect(fight.log.of('a').damageDealt).toBe(15); // registro histórico de fase 6 intacto
 round.elapsed=ROUND_SECONDS;round.before(1/30);
 expect(round.snapshot().result!.scores.find(p=>p.id==='a')?.damageDealt).toBe(5);
});
