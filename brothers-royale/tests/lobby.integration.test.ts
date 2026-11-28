import { afterAll,beforeAll,expect,it } from 'vitest';
import { Client,type Room } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import type { WebSocketClient } from '@colyseus/ws-transport';
import { createServer } from '../server/index';
import type { BrothersRoom } from '../server/BrothersRoom';
import type { LobbySnapshot } from '@shared/lobby/LobbyState';
import type { RoundSnapshot } from '@shared/battle/BattleRound';
import { PROTOCOL_VERSION,ROOM_NAME,type WelcomeMessage } from '@shared/protocol';
import { Buttons,emptyInput } from '@shared/types';
import { BattleRound } from '@shared/battle/BattleRound';
// Estas pruebas cubren sistemas ajenos al avión (fase 12): la ronda empieza en tierra como antes.
BattleRound.defaultTransport = false;
const port=36000+Math.floor(Math.random()*1000);
let server:ReturnType<typeof createServer>;
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(fn:()=>boolean){for(let i=0;i<300&&!fn();i++)await wait(10);expect(fn()).toBe(true);}
beforeAll(async()=>{server=createServer();await server.listen(port,'127.0.0.1');});
afterAll(async()=>{await server.gracefullyShutdown(false);});
const client=()=>new Client(`ws://127.0.0.1:${port}`);
async function setup(sdk:Room){
 const c={sdk,lobby:null as LobbySnapshot|null,battle:null as RoundSnapshot|null,welcomes:0,errors:[] as string[]};
 sdk.onMessage('welcome',(w:WelcomeMessage)=>{c.lobby=w.lobby!;c.battle=w.battle!;c.welcomes++;});
 sdk.onMessage('lobby',(s:LobbySnapshot)=>c.lobby=s);sdk.onMessage('battle',(s:RoundSnapshot)=>c.battle=s);
 sdk.onMessage('lobbyError',(s:{message:string})=>c.errors.push(s.message));sdk.onMessage('*',()=>undefined);
 sdk.reconnection.minUptime=0;sdk.reconnection.minDelay=300;sdk.reconnection.maxDelay=300;sdk.onReconnect(()=>sdk.send('ready'));sdk.send('ready');
 await until(()=>c.welcomes===1);return c;
}
it('ocho clientes pasan por lobby, cambio de anfitrión, reconexión, final y revancha',async()=>{
 const cs:Awaited<ReturnType<typeof setup>>[]=[];
 try{
  cs.push(await setup(await client().create(ROOM_NAME,{protocol:PROTOCOL_VERSION,code:'LOBBY9',visibility:'private',name:'Ana',skin:4})));
  for(let i=1;i<8;i++)cs.push(await setup(await client().join(ROOM_NAME,{protocol:PROTOCOL_VERSION,code:'LOBBY9',name:'Ana',skin:i+4})));
  const room=matchMaker.getLocalRoomById(cs[0]!.sdk.roomId) as BrothersRoom,w=room.world,host=cs[0]!.sdk.sessionId;
  await until(()=>cs.every(c=>c.lobby?.players.length===8));
  expect(cs.every(c=>c.lobby?.host===host)).toBe(true);expect(new Set(cs[0]!.lobby!.players.map(p=>p.name)).size).toBe(8);
  expect(w.players.get(cs[7]!.sdk.sessionId)!.color).toBe(11);
  await expect(client().joinById(room.roomId,{protocol:PROTOCOL_VERSION,code:'LOBBY9',name:'Noveno',skin:0})).rejects.toThrow(/locked|full/);
  const initial={...w.players.get(host)!.body.state.position};
  cs[0]!.sdk.send('input',{...emptyInput(1),moveX:1,buttons:Buttons.FIRE|Buttons.INTERACT});
  cs[0]!.sdk.send('build',{kind:'wall',x:0,y:0,z:12,rotation:0});
  cs[1]!.sdk.send('start',{host});cs[0]!.sdk.send('start',{});cs[1]!.sdk.send('profile',{name:'Ataque',skin:NaN,host:true});
  await wait(100);expect(w.round.phase).toBe('waiting');expect(w.players.get(host)!.body.state.position).toEqual(initial);expect(w.building.state.pieces.size).toBe(0);
  expect(cs[0]!.errors.length).toBeGreaterThan(0);expect(cs[1]!.errors.length).toBeGreaterThan(0);
  cs[1]!.sdk.send('profile',{name:'  Beto\u0000  ',skin:10,hp:999});await until(()=>w.players.get(cs[1]!.sdk.sessionId)?.name==='Beto');
  for(const c of cs.slice(1))c.sdk.send('lobbyReady',{ready:true});await until(()=>room.lobby.canStart);
  cs[0]!.sdk.send('start',{});await until(()=>w.round.phase==='countdown');
  cs[2]!.sdk.send('profile',{name:'No debe cambiar',skin:0});await wait(50);expect(w.players.get(cs[2]!.sdk.sessionId)!.name).not.toBe('No debe cambiar');
  for(let i=0;i<301;i++)w.step();await until(()=>cs.every(c=>c.battle?.phase==='running'));
  w.giveBenchLoadout(host,0);const inventory=w.match.inventory(host)!;
  w.combat.environmentalDamage(host,100,w.players.get(host)!.body.state.position,w.tick);
  const welcomes=cs[0]!.welcomes;
  (room.clients.find(c=>c.sessionId===host) as WebSocketClient).ref.terminate();
  await until(()=>room.lobby.host===cs[1]!.sdk.sessionId);
  await until(()=>cs[0]!.welcomes>welcomes);
  expect(room.lobby.host).toBe(cs[1]!.sdk.sessionId);expect(w.combat.lives(host)).toBe(2);expect(w.match.inventory(host)).toBe(inventory);
  const winner=cs[1]!.sdk.sessionId;w.players.get(winner)!.body.teleport({x:0,y:.05,z:17});
  w.building.state.hitTree(winner,0,90,true);
  expect(w.building.state.place(winner,{kind:'wall',x:0,y:0,z:12,rotation:0},w.players.get(winner)!.body.state.position)).toBe(true);
  const stats=w.combat.log.of(winner);stats.rangedShots=10;stats.accurateShots=4;stats.eliminations=7;
  cs[3]!.sdk.send('stats',{eliminations:999,woodCollected:999999,accuracy:100,host:true});
  w.round.elapsed=123.4;
  for(const p of w.players.values())if(p.id!==winner)w.combat.exclude(p.id);
  w.round.after(0,w.tick);await until(()=>cs.every(c=>c.battle?.phase==='finished'));
  const result=w.round.snapshot().result!;
  expect(result.winners).toEqual([winner]);expect(result.scores.find(p=>p.id===winner)).toMatchObject({position:1,accuracy:40,woodCollected:30,structuresBuilt:1});
  expect(result.scores.find(p=>p.id===cs[3]!.sdk.sessionId)?.eliminations).toBe(0);
  await wait(150);expect(w.round.phase).toBe('finished');
  cs[2]!.sdk.send('rematch',{});await until(()=>w.round.phase==='waiting');
  expect(w.building.state.pieces.size).toBe(0);expect(w.combat.log.stats.size).toBe(0);expect(w.match.pickups.size).toBe(0);
  cs[1]!.sdk.send('start',{});await wait(80);expect(w.round.phase).toBe('waiting');
  for(const c of cs)c.sdk.send('rematch',{});await until(()=>room.lobby.canStart);
  cs[0]!.sdk.send('start',{});await wait(80);expect(w.round.phase).toBe('waiting');
  cs[1]!.sdk.send('start',{});await until(()=>w.round.phase==='countdown');for(let i=0;i<301;i++)w.step();
  await until(()=>cs.every(c=>c.battle?.round===2&&c.battle.phase==='running'));
  expect(w.round.history).toHaveLength(1);expect(w.combat.lives(host)).toBe(3);expect(w.building.state.wood.get(winner)).toBe(0);
  expect(w.round.history[0]!.scores.find(p=>p.id===winner)?.woodCollected).toBe(30);
 }finally{await Promise.all(cs.map(c=>c.sdk.leave(true)));}
},20000);
it('privadas exigen código incluso por roomId; la búsqueda pública no entra en una privada',async()=>{
 const cs:Awaited<ReturnType<typeof setup>>[]=[];
 try{
  cs.push(await setup(await client().create(ROOM_NAME,{protocol:PROTOCOL_VERSION,code:'PRIV9',visibility:'private',name:'P',skin:0})));
  await expect(client().joinById(cs[0]!.sdk.roomId,{protocol:PROTOCOL_VERSION,code:'OTRO',name:'Intruso'})).rejects.toThrow(/Código/);
  await expect(client().create(ROOM_NAME,{protocol:PROTOCOL_VERSION,code:'PRIV9',visibility:'private',name:'Duplicada'})).rejects.toThrow(/existe/);
  await expect(client().join(ROOM_NAME,{protocol:PROTOCOL_VERSION,code:'NOEXISTE',name:'X'})).rejects.toThrow();
  cs.push(await setup(await client().joinOrCreate(ROOM_NAME,{protocol:PROTOCOL_VERSION,code:'',name:'Pública',skin:11})));
  expect(cs[0]!.sdk.roomId).not.toBe(cs[1]!.sdk.roomId);expect(cs[1]!.lobby?.code).toBe('');
  await expect(client().joinById(cs[1]!.sdk.roomId,{protocol:PROTOCOL_VERSION,code:'',name:'Skin inválida',skin:12})).rejects.toThrow();
 }finally{await Promise.all(cs.map(c=>c.sdk.leave(true)));}
},10000);
it('la caída de un participante cancela la cuenta atrás sin consumir una ronda',async()=>{
 const cs:Awaited<ReturnType<typeof setup>>[]=[];
 try{
  for(let i=0;i<2;i++)cs.push(await setup(await client().joinOrCreate(ROOM_NAME,{protocol:PROTOCOL_VERSION,code:'CANCEL9',name:'P'+i,skin:i})));
  const room=matchMaker.getLocalRoomById(cs[0]!.sdk.roomId) as BrothersRoom;
  cs[1]!.sdk.send('lobbyReady',{ready:true});await until(()=>room.lobby.canStart);cs[0]!.sdk.send('start',{});await until(()=>room.world.round.phase==='countdown');
  cs[1]!.sdk.reconnection.enabled=false;(room.clients.find(c=>c.sessionId===cs[1]!.sdk.sessionId) as WebSocketClient).ref.terminate();
  await until(()=>room.world.round.phase==='waiting');expect(room.world.round.round).toBe(0);
 }finally{await Promise.all(cs.map(c=>c.sdk.leave(true)));}
},10000);
