import {describe,it,expect,afterEach} from 'vitest';
import {Raycaster,Vector3,Color} from 'three';
import {PlayerAvatar,DEFAULT_COLORS,disposeAvatarResources} from '@/game/entities/PlayerAvatar';
import {crouchLegPose} from '@/game/entities/crouchPose';
import {PLAYER} from '@shared/constants';
import type {PlayerState} from '@shared/types';
afterEach(disposeAvatarResources);
describe('personaje ligero 15.1',()=>{
 it('la cadera baja con rodillas flexionadas, tobillo plano y pie en el suelo',()=>{for(const drop of [0,.1,.3,PLAYER.crouchDrop]){const p=crouchLegPose(drop,0);const y=.8-drop-.4*Math.cos(p.hip)-.4*Math.cos(p.hip+p.knee);const z=-.4*Math.sin(p.hip)-.4*Math.sin(p.hip+p.knee);expect(y).toBeCloseTo(0,6);expect(z).toBeCloseTo(0,6);expect(p.hip+p.knee+p.ankle).toBeCloseTo(0);}});
 it('tiene rodillas y tobillos sin añadir mallas ni materiales por miembro',()=>{const a=new PlayerAvatar(0,false);try{expect(a.mesh.skeleton.bones).toHaveLength(10);expect(a.root.children).toHaveLength(1);const state:PlayerState={id:'a',name:'A',position:{x:0,y:0,z:0},velocity:{x:0,y:0,z:0},yaw:0,grounded:true,locomotion:'crouch',lastProcessedSeq:1};a.pushState(state,true);for(let i=0;i<70;i++)a.render(1,1/60);a.root.updateMatrixWorld(true);for(const name of ['ankle-left','ankle-right']){const b=a.mesh.skeleton.bones.find(b=>b.name===name)!;expect(b.getWorldPosition(new Vector3()).y).toBeCloseTo(0,2);}expect(a.mesh.castShadow).toBe(false);}finally{a.dispose();}});
 it('el pelo cubre la coronilla sin cabeza visible por encima',()=>{const a=new PlayerAvatar(DEFAULT_COLORS,false);try{a.root.updateMatrixWorld(true);a.mesh.skeleton.update();const ray=new Raycaster(new Vector3(0,3,0),new Vector3(0,-1,0));const hit=ray.intersectObject(a.mesh)[0]!;expect(hit).toBeTruthy();const colors=a.mesh.geometry.getAttribute('color'),hair=new Color(DEFAULT_COLORS.hair);expect(colors.getX(hit.face!.a)).toBeCloseTo(hair.r);expect(colors.getY(hit.face!.a)).toBeCloseTo(hair.g);}finally{a.dispose();}});
});
