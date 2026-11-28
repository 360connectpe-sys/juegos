import {beforeAll,describe,it,expect} from 'vitest';
import {loadRapier,PhysicsWorld,type Rapier} from '@/physics/PhysicsWorld';
import {BuildingWorld} from '@/physics/BuildingWorld';
import {BUILD,buildTop,planBuild,perimeterContact,type BuildRequest} from '@shared/building/BuildingState';
import {defaultTerrainParams} from '@shared/world/terrain';
import type {WorldLayout} from '@shared/world/layout';
import type {Vec3} from '@shared/types';
let R:Rapier;beforeAll(async()=>{R=await loadRapier();});
function room(){
 const layout:WorldLayout={seed:7,terrain:{...defaultTerrainParams(7),maxHeight:0,flatRadius:100},trees:[],structures:[],houses:[],chests:[],rocks:[],bushes:[],spawn:{x:0,z:0}};
 const physics=new PhysicsWorld(R);physics.addTerrain(layout.terrain);physics.step();let me:Vec3={x:-4,y:0,z:0};
 const world=new BuildingWorld(physics,layout,()=>[me]);world.state.addPlayer('a');world.state.wood.set('a',999);
 const floor:BuildRequest={kind:'floor',x:0,y:0,z:0,rotation:0};expect(world.state.place('a',floor,me)).toBe(true);
 me={x:0,y:.18,z:0};for(let rotation=0;rotation<4;rotation++)expect(world.state.place('a',{kind:'wall',x:0,y:.18,z:0,rotation},me)).toBe(true);
 const plan=(feet:Vec3,yaw=0)=>{me=feet;return planBuild('ramp',feet,yaw,{pieces:world.state.pieces.values(),ground:()=>0,canPlace:r=>world.state.canPlace('a',r,feet)});};
 return {world,physics,plan,setMe:(p:Vec3)=>me=p,dispose(){world.dispose();physics.dispose();}};
}
describe('rampas en habitaciones cerradas 15.1',()=>{
 it('desde dentro selecciona la casilla propia libre bajo el extremo alto y conserva coste',()=>{const f=room();try{const feet={x:0,y:.18,z:1.05},p=f.plan(feet);expect(p.valid).toBe(true);expect(p.request).toMatchObject({x:0,z:0,y:.18,rotation:2});const before=f.world.state.wood.get('a')!;expect(f.world.state.place('a',p.request,feet)).toBe(true);expect(f.world.state.wood.get('a')).toBe(before-BUILD.cost);expect(f.world.state.pieces.size).toBe(6);
 const upperFeet={x:0,y:3.18,z:1};f.setMe(upperFeet);const upper=planBuild('floor',upperFeet,0,{pieces:f.world.state.pieces.values(),ground:()=>0,canPlace:r=>f.world.state.canPlace('a',r,upperFeet)});expect(upper.valid).toBe(true);expect(buildTop(upper.request)).toBeCloseTo(3.18);expect(f.world.state.place('a',upper.request,upperFeet)).toBe(true);
 }finally{f.dispose();}});
 it('rechaza la misma rampa si atraviesa la cápsula del jugador',()=>{const f=room();try{const p=f.plan({x:0,y:.18,z:0});expect(p.valid).toBe(false);expect(f.world.state.place('a',{kind:'ramp',x:0,y:.18,z:0,rotation:2},{x:0,y:.18,z:0})).toBe(false);}finally{f.dispose();}});
 it('las barras no revelan una pieza detrás de otra pared',()=>{const f=room();try{const from={x:0,y:1.5,z:4};expect(f.world.visiblePiece(2,from,{x:0,y:3.3,z:1.5})).toBe(true);expect(f.world.visiblePiece(4,from,{x:0,y:3.3,z:-1.5})).toBe(false);}finally{f.dispose();}});
 it('rechaza IDs duplicados sin sustituir los colisionadores válidos',()=>{const f=room();try{const s=f.world.state.snapshot(),pieces=s.pieces.map(p=>({...p}));pieces[1]!.id=pieces[0]!.id;expect(f.world.load({...s,revision:s.revision+1,pieces})).toBe(false);expect(f.world.state.pieces.size).toBe(5);}finally{f.dispose();}});
 it('no ignora paredes interiores ni paneles de puertas/ventanas',()=>{const ramp:BuildRequest={kind:'ramp',x:0,y:0,z:0,rotation:0};expect(perimeterContact({kind:'wall',x:0,y:0,z:0,rotation:0},ramp)).toBe(true);expect(perimeterContact({kind:'wall',x:0,y:0,z:0,rotation:0,slot:0,yaw:0,w:1,h:2.5},ramp)).toBe(false);expect(perimeterContact({kind:'wall',x:0,y:0,z:3,rotation:0},ramp)).toBe(false);});
});
