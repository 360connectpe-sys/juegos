// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EventBus } from '@/core/EventBus';
import { DeathScreen } from '@/ui/components/DeathScreen';
import { renderInfoWidget } from '@/ui/hud/widgets';
import { StormView } from '@/game/world/StormView';
import { generateWorldLayout } from '@shared/world/layout';
import { zoneAt, zonePlan } from '@shared/battle/zone';
import { isValidCombatEvent, isValidDamageEvent, isValidVitals, fullVitals } from '@/net/CombatView';
import { Game, type GameEvents } from '@/game/Game';
import type { RoundSnapshot } from '@shared/battle/BattleRound';
afterEach(cleanup);
function fixture(lives=3) {
  const calls:string[]=[];
  const round:RoundSnapshot={round:1,phase:'running',elapsed:210,countdown:0,players:[{id:'a',lives,descending:false,protection:0,air:0}],zone:zoneAt(zonePlan(120,1),210),result:null,planes:[]};
  const game={currentVitals:{...fullVitals(),lives,dead:lives===0},events:new EventBus<GameEvents>(),battleUi:{round,offline:false,spectator:lives===0,target:'Ana',outside:true,protection:0,descending:false},spectateNext:(d?:number)=>calls.push(String(d??1)),startRound:()=>calls.push('start')} as unknown as Game;
  return {game,calls,round};
}
describe('HUD y vistas de la fase 8',()=>{
  it('muestra vidas reales y controles de espectador sin cambiar la perspectiva',()=>{
    const {game,calls}=fixture(0);
    render(<>{renderInfoWidget('lives',game)}<DeathScreen game={game}/></>);
    expect(screen.getByRole('img',{name:'Vidas: 0 de 3'})).toBeTruthy();
    expect(screen.getByText('Eliminación definitiva')).toBeTruthy();
    expect(screen.getByText(/Espectador · Ana/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Anterior'}));fireEvent.click(screen.getByRole('button',{name:'Siguiente'}));
    expect(calls).toEqual(['-1','1']);
    expect(screen.queryByText(/Vuelves desde el cielo/)).toBeNull();
  });
  it('los botones de espectador quedan por encima de la zona táctil de apuntado',()=>{
    const style=document.createElement('style');style.textContent=readFileSync('src/ui/styles.css','utf8');document.head.append(style);
    try {
      const {game}=fixture(0);render(<><div className="touch"><div className="touch__look"/></div><DeathScreen game={game}/></>);
      const panel=document.querySelector('.death--spectator')!,touch=document.querySelector('.touch')!;
      expect(Number(getComputedStyle(panel).zIndex)).toBeGreaterThan(Number(getComputedStyle(touch).zIndex));
      expect(getComputedStyle(screen.getByRole('button',{name:'Siguiente'})).pointerEvents).toBe('auto');
      expect(getComputedStyle(panel).pointerEvents).toBe('none');
    } finally { style.remove(); }
  });
  it('el tinte del espectador sigue al observado y no a su cuerpo eliminado',()=>{
    const {round}=fixture(0);
    const game=Object.assign(Object.create(Game.prototype),{
      session:{battle:round,localPlayerId:'a',localPlayer:()=>({position:{x:100,y:0,z:100}}),identity:()=>({name:'B'})},
      vitals:{...fullVitals(),lives:0},spectatedId:'b',remotes:new Map([['b',{position:{x:0,y:0,z:0}}]]),
    }) as Game;
    expect(game.battleUi.outside).toBe(false);
  });
  it('muestra aviso de treinta segundos, tormenta y resultado de empate',()=>{
    const {game,round}=fixture();render(<DeathScreen game={game}/>);
    expect(screen.getByText('La zona se cierra en 30 s')).toBeTruthy();
    expect(screen.getByText(/Quedan 11:30 · Fase 1\/5/)).toBeTruthy();
    expect(document.querySelector('.storm-tint')).not.toBeNull();cleanup();
    round.phase='finished';round.countdown=10;round.result={round:1,elapsed:1800,reason:'draw',winners:[],scores:[]};
    render(<DeathScreen game={game}/>);expect(screen.getByText('Empate')).toBeTruthy();expect(screen.getByText('Nueva partida en 10 s')).toBeTruthy();
  });
  it('fase 12: la tormenta es una barrera de energía en UNA malla que sigue al círculo y libera sus recursos',()=>{
    const view=new StormView(generateWorldLayout().terrain);
    view.update({x:0,z:0,radius:40},1/60);expect(view.mesh.visible).toBe(true);
    expect(view.mesh.material.transparent).toBe(true);expect(view.mesh.material.depthWrite).toBe(false);
    expect(view.mesh.scale.x).toBe(40);
    view.update({x:2,z:1,radius:30},1/60,true);expect(view.mesh.position.x).toBe(2);expect(view.mesh.scale.z).toBe(30);
    expect(view.mesh.material.uniforms.uPulse!.value).toBeGreaterThanOrEqual(0);
    view.update({x:2,z:1,radius:0});expect(view.mesh.visible).toBe(false);
    view.update(null);expect(view.mesh.visible).toBe(false);view.dispose();
  });
  it('rechaza vidas y protección malformadas y reconoce daño ambiental acotado',()=>{
    for(const v of [{...fullVitals(),lives:4},{...fullVitals(),lives:NaN},{...fullVitals(),protection:4},{...fullVitals(),descending:1}])expect(isValidVitals(v)).toBe(false);
    const at={x:0,y:0,z:0};
    expect(isValidDamageEvent({type:'damage',victim:'a',by:'storm',weapon:'storm',amount:50,hp:50,at})).toBe(true);
    expect(isValidDamageEvent({type:'damage',victim:'a',by:'fall',weapon:'fall',amount:100,hp:0,at})).toBe(true);
    expect(isValidDamageEvent({type:'damage',victim:'a',by:'storm',weapon:'storm',amount:51,hp:0,at})).toBe(false);
    expect(isValidCombatEvent({type:'death',victim:'a',killer:'storm',weapon:'storm',tick:1,at})).toBe(true);
    expect(isValidDamageEvent({type:'damage',victim:'a',by:'storm',weapon:'storm',amount:Infinity,hp:50,at})).toBe(false);
  });
});
