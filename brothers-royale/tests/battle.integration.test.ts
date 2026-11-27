import { afterAll, beforeAll, expect, it } from 'vitest';
import { Client } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import type { WebSocketClient } from '@colyseus/ws-transport';
import { createServer } from '../server/index';
import type { BrothersRoom } from '../server/BrothersRoom';
import type { RoundSnapshot } from '@shared/battle/BattleRound';
import type { Vitals } from '@shared/combat/CombatState';
import { PROTOCOL_VERSION, ROOM_NAME, type WelcomeMessage } from '@shared/protocol';
import { Buttons, emptyInput } from '@shared/types';
import { terrainHeight } from '@shared/world/terrain';

const port = 35000 + Math.floor(Math.random()*1000);
let server: ReturnType<typeof createServer>;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
beforeAll(async () => { server=createServer(); await server.listen(port,'127.0.0.1'); });
afterAll(async () => { await server.gracefullyShutdown(false); });
async function connect(code: string, index: number) {
  const sdk=await new Client(`ws://127.0.0.1:${port}`).joinOrCreate(ROOM_NAME,{protocol:PROTOCOL_VERSION,name:'Ronda'+index,code});
  const c={sdk,welcomes:0,snapshots:0,phases:new Set<number>(),battle:null as RoundSnapshot|null,vitals:null as Vitals|null,closed:false};
  sdk.reconnection.minUptime=0;
  sdk.onMessage('welcome',(w:WelcomeMessage)=>{c.welcomes++;c.battle=w.battle!;if(w.battle)c.phases.add(w.battle.zone.phase);c.vitals=w.vitals!;});
  sdk.onMessage('battle',(s:RoundSnapshot)=>{c.battle=s;c.phases.add(s.zone.phase);});
  sdk.onMessage('vitals',(v:Vitals)=>{c.vitals=v;});
  sdk.onMessage('snapshot',()=>c.snapshots++);sdk.onMessage('*',()=>undefined);
  sdk.onLeave(()=>{c.closed=true;});sdk.onReconnect(()=>sdk.send('ready'));sdk.send('ready');
  for(let i=0;i<200 && !c.welcomes;i++)await wait(10);
  expect(c.welcomes).toBe(1);return c;
}
it('ocho clientes conservan vidas al reconectar; una sesión nueva observa; todos reciben el reinicio',async()=>{
  const clients: Awaited<ReturnType<typeof connect>>[]=[];
  try{
    for(let i=0;i<8;i++)clients.push(await connect('CICLO8',i));
    const room=matchMaker.getLocalRoomById(clients[0]!.sdk.roomId) as BrothersRoom;
    const w=room.world;expect(w.round.start()).toBe(true);await wait(100);
    const c=clients[0]!,id=c.sdk.sessionId,p=w.players.get(id)!;
    w.giveBenchLoadout(id,0);const inv=w.match.inventory(id)!;
    w.combat.environmentalDamage(id,100,p.body.state.position,w.tick);
    const count=c.welcomes;let recovered=false;c.sdk.onReconnect(()=>{recovered=true;});
    (room.clients.find(s=>s.sessionId===id) as WebSocketClient).ref.terminate();
    for(let i=0;i<500 && (!recovered || c.welcomes===count);i++)await wait(10);
    expect(recovered).toBe(true);expect(c.vitals?.lives).toBe(2);expect(w.match.inventory(id)).toBe(inv);
    expect(w.players.get(id)?.connected).toBe(true);
    for(let death=0;death<2;death++){
      for(let t=0;t<151;t++)w.step();
      w.combat.environmentalDamage(id,100,p.body.state.position,w.tick);
    }
    await wait(100);expect(c.vitals?.lives).toBe(0);expect(w.combat.isDead(id)).toBe(true);
    await c.sdk.leave(true);
    for(let i=0;i<100 && w.players.has(id);i++)await wait(10);
    const fresh=await connect('CICLO8',9);clients.push(fresh);
    expect(fresh.vitals?.lives).toBe(0);expect(fresh.vitals?.dead).toBe(true);
    fresh.sdk.send('input',{...emptyInput(1),buttons:Buttons.FIRE|Buttons.INTERACT,moveX:1,lives:3,hp:100});await wait(100);
    expect(w.combat.lives(fresh.sdk.sessionId)).toBe(0);
    const beforeReset=clients.slice(1).map(c=>c.welcomes);
    w.round.elapsed=1800;w.step();await wait(400);
    expect(clients.slice(1).every(c=>c.battle?.phase==='finished')).toBe(true);
    for(let t=0;t<300;t++)w.step();await wait(150);
    expect(clients.slice(1).every((c,i)=>c.welcomes>beforeReset[i]!)).toBe(true);
    expect(clients.slice(1).every(c=>c.vitals?.lives===3)).toBe(true);
    expect(w.match.pickups.size).toBe(0);expect(w.round.history).toHaveLength(1);
  }finally{await Promise.all(clients.map(c=>c.sdk.leave(true)));}
},15000);

it('simula treinta minutos con ocho clientes reales, cierre total y reinicio',async()=>{
  const clients: Awaited<ReturnType<typeof connect>>[]=[];
  try {
    for(let i=0;i<8;i++)clients.push(await connect('FAST8',i));
    const room=matchMaker.getLocalRoomById(clients[0]!.sdk.roomId) as BrothersRoom,w=room.world;
    w.round.start();await wait(80);
    const phases=new Set<number>();let ticks=0,previousPhase=-1;const start=performance.now();
    while(w.round.phase==='running' && ticks<54001){
      const c=w.round.zone.current,y=(w.physics.groundHeightAt(c.x,c.z)??0)+.05;
      // Fixture coloca a los ocho en la zona para ejercer el límite, no una IA de navegación.
      for(const p of w.players.values())p.body.teleport({x:c.x,y,z:c.z});
      w.step();phases.add(w.round.zone.phase);ticks++;
      if(w.round.zone.phase!==previousPhase){previousPhase=w.round.zone.phase;await wait(360);}
      if(ticks%1500===0)await wait(0); // deja transportar las fases y snapshots reales
      if(ticks%300===0){w.drainCombatEvents();w.drainMatchEvents();}
    }
    for(let i=0;i<100 && !clients.every(c=>c.battle?.phase==='finished');i++)await wait(10);
    expect(w.round.phase).toBe('finished');expect(w.round.snapshot().result?.elapsed).toBe(1800);
    expect([...phases]).toEqual([0,1,2,3,4,5,6,7]);expect(clients.every(c=>c.battle?.phase==='finished')).toBe(true);
    expect(w.round.snapshot().zone.current.radius).toBe(0);
    expect(clients.every(c=>c.battle?.result?.scores.length===8)).toBe(true);
    expect(clients.every(c=>c.phases.size===8)).toBe(true);
    for(let t=0;t<300;t++)w.step();await wait(100);
    expect(clients.every(c=>c.vitals?.lives===3)).toBe(true);
    console.log('PHASE8_ACCELERATED_NET',JSON.stringify({virtualSeconds:1800,manualTicks:ticks,realMs:performance.now()-start,phases:[...phases],clients:8}));
  }finally{await Promise.all(clients.map(c=>c.sdk.leave(true)));}
},60000);

it('estabilidad de fase 8 con ocho clientes, tormenta y métricas de memoria',async()=>{
  const clients: Awaited<ReturnType<typeof connect>>[]=[];
  const seconds=Number(process.env.BR_PHASE8_SOAK_SECONDS??5);
  if(!Number.isSafeInteger(seconds)||seconds<5||seconds>1800)throw new Error('BR_PHASE8_SOAK_SECONDS: entero 5..1800');
  try{
    for(let i=0;i<8;i++)clients.push(await connect('SOAK8',i));
    expect(new Set(clients.map(c=>c.sdk.roomId)).size).toBe(1);
    const room=matchMaker.getLocalRoomById(clients[0]!.sdk.roomId) as BrothersRoom,w=room.world;
    w.round.start();
    const times:number[]=[],memory:Record<string,number>[]=[],statuses:number[]=[];
    let bytes=0,maxQueue=0,maxBuffered=0;
    // Instrumentar sin spies que retengan paquetes o listas de argumentos durante cinco minutos.
    const originalStep=w.step.bind(w);w.step=(dt)=>{const start=performance.now();originalStep(dt);times.push(performance.now()-start);};
    for(const c of room.clients){const s=(c as WebSocketClient).ref,send=s.send.bind(s);s.send=((data:unknown,...args:unknown[])=>{bytes+=(data as Uint8Array).byteLength;return (send as Function)(data,...args);}) as typeof s.send;}
    for(let i=0;i<8;i++){
      const p=w.players.get(clients[i]!.sdk.sessionId)!;
      const x=i===7?54:(i%3-1)*9,z=i===7?54:(Math.floor(i/3)-1)*9;
      p.body.teleport({x,y:terrainHeight(x,z,w.layout.terrain)+.1,z});
    }
    const start=performance.now(),tick=w.tick,initialCounts=clients.map(c=>c.snapshots);
    const sample=(second:number)=>memory.push({second,...process.memoryUsage(),colliders:w.physics.world.colliders.len(),stats:w.combat.log.stats.size,history:w.round.history.length});
    sample(0);
    for(let seq=1;seq<=seconds*30;seq++){
      const direction=Math.floor(seq/90)%2===0?1:-1;
      clients.forEach((c,i)=>c.sdk.send('input',{...emptyInput(seq),moveX:i===7?0:direction*.2,aimYaw:0,buttons:i!==7 && seq%60===1?Buttons.FIRE|Buttons.JUMP:0}));
      maxQueue=Math.max(maxQueue,...[...w.players.values()].map(p=>p.queue.length));
      maxBuffered=Math.max(maxBuffered,...room.clients.map(c=>(c as WebSocketClient).ref.bufferedAmount));
      if(seq%1800===0){sample(seq/30);statuses.push(w.round.zone.phase);console.log('PHASE8_PROGRESS',JSON.stringify({seconds:seq/30,players:w.players.size,phase:w.round.zone.phase,maxQueue,maxBuffered}));}
      if(clients.some(c=>c.closed)||w.players.size!==8)throw new Error('Cliente perdido durante soak');
      await wait(Math.max(0,start+seq*1000/30-performance.now()));
    }
    sample(seconds);
    const elapsed=(performance.now()-start)/1000,sorted=times.sort((a,b)=>a-b),hz=(w.tick-tick)/elapsed;
    const metrics={seconds:elapsed,hz,ticks:w.tick-tick,p50Ms:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:sorted.at(-1),bytesPerSecond:bytes/elapsed,maxQueue,maxBuffered,memory,players:w.players.size,phases:statuses,snapshots:clients.map((c,i)=>c.snapshots-initialCounts[i]!),round:w.round.snapshot()};
    console.log('PHASE8_SOAK',JSON.stringify(metrics));
    expect(hz).toBeGreaterThan(27);expect(hz).toBeLessThan(33);expect(metrics.p95Ms).toBeLessThan(1000/30);
    expect(w.players.size).toBe(8);expect(maxQueue).toBeLessThanOrEqual(12);expect(maxBuffered).toBeLessThan(256*1024);
    if(seconds>=300){expect(w.round.zone.phase).toBeGreaterThanOrEqual(1);expect(w.combat.hp(clients[7]!.sdk.sessionId)).toBeLessThan(100);}
    expect(clients.every((c,i)=>c.snapshots-initialCounts[i]!>=seconds*27)).toBe(true);
  }finally{await Promise.all(clients.map(c=>c.sdk.leave(true)));}
},(Number(process.env.BR_PHASE8_SOAK_SECONDS??5)+20)*1000);
