import {describe,it,expect,vi} from 'vitest';
import {Group,InstancedMesh,BoxGeometry,MeshBasicMaterial} from 'three';
import {BuildingView} from '@/game/world/BuildingView';
import {damageLevel} from '@/game/world/BuildingDamage';
import {BUILD,type BuildingSnapshot,type BuildKind} from '@shared/building/BuildingState';
import {CombatFx} from '@/game/combat/CombatFx';
import {heldGeometry,MUZZLE} from '@/game/combat/WeaponModels';
function view(){const g=new Group();g.add(new InstancedMesh(new BoxGeometry(),new MeshBasicMaterial(),1),new InstancedMesh(new BoxGeometry(),new MeshBasicMaterial(),1));return new BuildingView([],g);}
const state=(hp:number,kind:BuildKind='wall',revision=1):BuildingSnapshot=>({revision,trees:[],wood:{a:10},pieces:[{id:1,owner:'a',kind,x:0,y:0,z:0,rotation:0,hp}]});
describe('deterioro y recursos 15.1',()=>{
 it('los umbrales son 76–100, 51–75, 26–50 y 1–25%',()=>{expect([150,114,112.5,76.5,75,39,37.5,1].map(damageLevel)).toEqual([0,0,1,1,2,2,3,3]);});
 it('no reconstruye geometría por madera o daño dentro del mismo nivel; sí notifica HP real',()=>{const v=view(),damage=vi.fn();v.onDamage=damage;try{v.update(state(150),0);const writes=v.geometryWrites;v.update({...state(150),wood:{a:999}},0);v.update(state(140),0);expect(v.geometryWrites).toBe(writes);expect(damage).toHaveBeenCalledWith(expect.objectContaining({hp:140}));v.update(state(100),0);expect(v.geometryWrites).toBe(writes+1);const count=v.structures.geometry.drawRange.count;v.update(state(20),0);expect(v.structures.geometry.drawRange.count).toBeGreaterThan(count);expect(v.structures.castShadow).toBe(false);}finally{v.dispose();}});
 it('las cuatro piezas comparten material y sus variantes se liberan',()=>{const v=view();try{const material=v.structures.material;for(const kind of ['wall','floor','ramp','roof'] as const){v.update(state(20,kind),0);expect(v.drawn[kind]).toBe(1);expect(v.structures.material).toBe(material);}}finally{v.dispose();}});
 it('el fogonazo usa el lote existente y los pools siguen acotados tras reciclar',()=>{const fx=new CombatFx();try{for(let i=0;i<120;i++)fx.flash({x:0,y:0,z:0});fx.update(.01);expect(fx.mesh.count).toBeLessThanOrEqual(CombatFx.MAX);expect(fx.mesh.castShadow).toBe(false);fx.update(1);expect(fx.active).toBe(0);for(let i=0;i<120;i++)fx.tracer({x:0,y:0,z:0},{x:0,y:0,z:5});fx.update(.01);expect(fx.active).toBe(CombatFx.MAX/2);}finally{fx.dispose();}});
 it('modelos pequeños, finitos y compatibles con miras; no cambia HP de estructuras',()=>{for(const kind of ['pistol','smg','shotgun','rifle','sniper','axe'] as const){const g=heldGeometry(kind,'rare',kind==='sniper'||kind==='axe'?undefined:'x2');try{g.computeBoundingBox();expect(g.boundingBox!.max.z).toBeLessThanOrEqual(MUZZLE[kind]+.02);expect(g.getAttribute('position').count).toBeLessThan(2200);}finally{g.dispose();}}expect(BUILD.hp).toBe(150);});
});
