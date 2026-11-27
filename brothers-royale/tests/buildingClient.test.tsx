// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Matrix4 } from 'three';
import { BuildingView } from '@/game/world/BuildingView';
import { createTrees } from '@/game/world/Trees';
import { generateWorldLayout } from '@shared/world/layout';
import { BUILD, buildDef } from '@shared/building/BuildingState';
import { defaultHudLayout, parseHudLayout } from '@/ui/hud/layout';
import { ConstructionWidget } from '@/ui/hud/widgets';
import type { Game } from '@/game/Game';
afterEach(cleanup);
describe('vista y HUD de construcción', () => {
  it('conserva dos lotes de árboles y un lote de madera, con vista previa válida/inválida', () => {
    const layout=generateWorldLayout();
    const trees=createTrees(layout.trees,layout.seed,false);
    const view=new BuildingView(layout.trees,trees);
    expect(trees.children).toHaveLength(2);
    expect(view.root.children).toHaveLength(2);
    view.preview({ kind:'ramp',x:3,y:0,z:3,rotation:1 },true);
    expect(view.ghost.visible).toBe(true);
    expect(view.ghost.rotation.y).toBeCloseTo(Math.PI/2);
    expect(view.ghost.material).toMatchObject({ opacity:0.45 });
    const color=(view.ghost.material as import('three').MeshBasicMaterial).color.getHex();
    view.preview({ kind:'ramp',x:3,y:0,z:3,rotation:1 },false);
    expect((view.ghost.material as import('three').MeshBasicMaterial).color.getHex()).not.toBe(color);
    const hp=layout.trees.map(()=>BUILD.treeHp as number);
    hp[0]=0;
    view.update({revision:1,trees:hp,pieces:[],wood:{}},.016);
    const mesh=trees.children[layout.trees[0]!.variant] as import('three').InstancedMesh;
    const matrix=new Matrix4();mesh.getMatrixAt(0,matrix);
    expect(matrix.elements[0]).toBe(0);
    hp[0]=90;
    view.update({revision:1,trees:[...hp],pieces:[],wood:{}},.016); // otra sala con igual revisión
    mesh.getMatrixAt(0,matrix);
    expect(matrix.elements[0]).not.toBe(0);
    expect(buildDef('roof').parts).toHaveLength(2);
    view.dispose();
  });
  // Adaptada en la corrección móvil: la ventana central (elegir/rotar/nivel/colocar) se
  // sustituye por tres botones directos; rotación y altura son automáticas.
  it('migra HUD guardados y construye con botones directos: mantener = vista previa, soltar = colocar', () => {
    const layout=parseHudLayout({jump:defaultHudLayout().jump});
    expect(layout.wood.visible && layout.construction.visible).toBe(true);
    const calls: unknown[][]=[];
    const game={buildingUi:{open:false,kind:'wall',rotation:0,level:0,wood:30,valid:true,holding:null},pressBuild:(k:unknown)=>calls.push(['press',k]),releaseBuild:(c:unknown)=>calls.push(['release',c])} as unknown as Game;
    render(<ConstructionWidget game={game}/>);
    for(const [i,label] of ['Pared','Rampa','Suelo'].entries()){
      const b=screen.getByRole('button',{name:new RegExp(`^${label}`)});
      fireEvent.pointerDown(b,{pointerId:10+i});
      fireEvent.pointerUp(b,{pointerId:10+i});
    }
    expect(calls).toEqual([['press','wall'],['release',true],['press','ramp'],['release',true],['press','floor'],['release',true]]);
    // Cancelar el toque no construye.
    const wallBtn=screen.getByRole('button',{name:/^Pared/});
    fireEvent.pointerDown(wallBtn,{pointerId:20});fireEvent.pointerCancel(wallBtn,{pointerId:20});
    expect(calls.at(-1)).toEqual(['release',false]);
    expect(screen.queryByText(/Editar estructura/)).toBeNull();
    expect(screen.queryByRole('button',{name:/Rotar|Nivel|Colocar/})).toBeNull();
  });
});
