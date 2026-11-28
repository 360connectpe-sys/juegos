import {describe,it,expect} from 'vitest';
import {MapViewport} from '@/ui/map/MapViewport';
import {Game} from '@/game/Game';
describe('mapa personal 15.1',()=>{
 it('zoom conserva el punto bajo los dedos y limita el desplazamiento',()=>{const m=new MapViewport();const before=m.world(.65,.4)!;m.zoomAt(2,.65,.4);expect(m.world(.65,.4)!.x).toBeCloseTo(before.x);expect(m.world(.65,.4)!.y).toBeCloseTo(before.y);m.zoomAt(100);expect(m.zoom).toBe(6);m.zoomAt(.001);expect(m.zoom).toBe(1);expect(m.x).toBe(0);});
 it('pellizcar, arrastrar o cancelar nunca coloca destinos',()=>{const m=new MapViewport();m.down(1,.3,.3);m.down(2,.6,.6);m.move(2,.8,.8);expect(m.zoom).toBeGreaterThan(1);expect(m.up(1)).toBeNull();expect(m.up(2)).toBeNull();m.down(3,.4,.4);m.move(3,.8,.8);expect(m.up(3)).toBeNull();m.down(4,.2,.2);m.cancel();expect(m.up(4)).toBeNull();});
 it('un toque aislado convierte pantalla a posición del escenario ampliado',()=>{const m=new MapViewport();m.zoomAt(2);m.down(1,.6,.5);expect(m.up(1)).toEqual({x:.55,y:.5});});
 it('el contrato del mapa no entrega enemigos ni muñecos',()=>{const game=Object.assign(Object.create(Game.prototype),{layout:{terrain:{size:120}},session:{localPlayer:()=>({position:{x:1,z:2},yaw:0}),match:{chests:[],opened:[]}},mapMarkers:[],remotes:new Map([['enemy',{position:{x:3,z:4}}]])}) as Game;expect(game.minimapState()).not.toHaveProperty('others');expect(game.minimapState().local).toEqual({x:1,z:2,yaw:0});});
});
