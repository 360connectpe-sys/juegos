// @vitest-environment jsdom
import {describe,it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {BuildRotate} from '@/ui/hud/widgets';
import {defaultHudLayout,parseHudLayout} from '@/ui/hud/layout';
import {Game} from '@/game/Game';
import {StructureHealth} from '@/game/combat/StructureHealth';
import {PerspectiveCamera} from 'three';
import {GamepadSource,PAD} from '@/game/input/sources';
import {Buttons} from '@shared/types';
afterEach(cleanup);
describe('HUD y barras ligeras 15.1',()=>{
 it('giro oculto sin selección, visible en vista previa y editable',()=>{const configureBuild=vi.fn();const g={buildingUi:{open:true},configureBuild} as unknown as Game;const r=render(<BuildRotate game={g}/>);fireEvent.pointerDown(screen.getByRole('button',{name:'Girar construcción 90 grados'}));expect(configureBuild).toHaveBeenCalledWith(undefined,true);r.unmount();render(<BuildRotate game={{buildingUi:{open:false}} as unknown as Game}/>);expect(screen.queryByRole('button')).toBeNull();const layout=defaultHudLayout();expect(parseHudLayout({...layout,buildRotate:{...layout.buildRotate,x:.25,opacity:.6}}).buildRotate).toMatchObject({x:.25,opacity:.6});});
 it('girar solo recalcula la vista previa, sin reiniciar el flanco de disparo',()=>{const plan=vi.fn(),preview=vi.fn();const game=Object.assign(Object.create(Game.prototype),{buildOpen:true,buildRotation:0,buildLevel:0,inputSuspended:false,lastBuildYaw:.7,buildFireHeld:true,buildHeld:true,updateBuildPlan:plan,buildingView:{preview},buildCandidate:null,buildValid:false}) as Game;game.configureBuild(undefined,true);expect(plan).toHaveBeenCalledWith(.7);expect(preview).toHaveBeenCalled();expect((game as unknown as {buildFireHeld:boolean}).buildFireHeld).toBe(true);});
 it('LB+Y gira una vez y no cierra la selección al soltar LB antes que Y',()=>{const buttons=Array.from({length:16},()=>({pressed:false,touched:false,value:0})),pad={mapping:'standard' as const,connected:true,axes:[0,0,0,0],buttons};const source=new GamepadSource(()=>[pad]);buttons[PAD.LB]!.pressed=buttons[PAD.Y]!.pressed=true;expect((source.read().actions??0)&Buttons.BUILD).toBe(0);expect(source.buildRotate).toBe(true);source.buildRotate=false;source.read();expect(source.buildRotate).toBe(false);buttons[PAD.LB]!.pressed=false;expect((source.read().actions??0)&Buttons.BUILD).toBe(0);});
 it('barra temporal usa HP recibido, oclusión y como máximo cuatro nodos',()=>{const parent=document.createElement('div'),health=new StructureHealth(parent),cam=new PerspectiveCamera(60,1,.1,100);cam.position.set(0,2,8);cam.lookAt(0,1.5,0);cam.updateMatrixWorld();const p={id:1,owner:'a',kind:'wall' as const,x:0,y:0,z:0,rotation:0,hp:100};health.damage(p);health.frame(cam,640,360,.1,()=>true);const bar=parent.querySelector('.structure-health') as HTMLElement;expect(bar.textContent).toBe('100/150');expect(bar.style.display).not.toBe('none');health.frame(cam,640,360,.2,()=>false);expect(bar.style.display).toBe('none');for(let id=2;id<9;id++)health.damage({...p,id});expect(parent.children).toHaveLength(4);health.frame(cam,640,360,4,()=>true);expect([...parent.children].every(e=>(e as HTMLElement).style.display==='none')).toBe(true);health.dispose();expect(parent.children).toHaveLength(0);});
});
