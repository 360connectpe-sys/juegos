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
  it('migra HUD guardados y permite elegir, rotar y colocar antes de construir', () => {
    const layout=parseHudLayout({jump:defaultHudLayout().jump});
    expect(layout.wood.visible && layout.construction.visible).toBe(true);
    const calls: unknown[][]=[];
    const game={buildingUi:{open:true,kind:'wall',rotation:0,level:0,wood:30,valid:true},configureBuild:(...args:unknown[])=>calls.push(args),placeBuild:()=>calls.push(['place']),toggleBuild:()=>undefined} as unknown as Game;
    render(<ConstructionWidget game={game}/>);
    for(const label of ['Pared','Suelo','Rampa','Techo'])fireEvent.click(screen.getByRole('button',{name:label}));
    fireEvent.click(screen.getByRole('button',{name:'Rotar 90°'}));
    fireEvent.click(screen.getByRole('button',{name:'Colocar · 10 madera'}));
    expect(calls).toContainEqual(['roof']);
    expect(calls).toContainEqual([undefined,true]);
    expect(calls).toContainEqual(['place']);
    expect(screen.queryByText(/Editar estructura/)).toBeNull();
  });
});
