// @vitest-environment jsdom
import { afterEach,describe,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { Frontend,Results } from '@/ui/components/Frontend';
import { loadProfile,parseProfile,PROFILE_KEY,saveProfile } from '@/game/profile';
import { parseHudLayout } from '@/ui/hud/layout';
import { NameTags } from '@/game/entities/NameTags';
import { PerspectiveCamera } from 'three';
import type { Game } from '@/game/Game';
import type { RoundResult } from '@shared/battle/BattleRound';
import type { LobbySnapshot } from '@shared/lobby/LobbyState';
afterEach(()=>{cleanup();localStorage.clear();vi.restoreAllMocks();});
function fixture(lobby?:LobbySnapshot){
 const onConnect=vi.fn(),onProfile=vi.fn(),game={startRound:vi.fn(),lobbyReady:vi.fn()} as unknown as Game;
 const props={game,profile:{name:'Ana',skin:0},lobby,localId:'a',server:'ws://localhost:2567',busy:false,onConnect,onProfile,onPractice:vi.fn(),onSettings:vi.fn(),onLeave:vi.fn()};
 return {props,onConnect,onProfile,game};
}
describe('pantallas y persistencia',()=>{
 it('muestra identidad, doce polos y acciones sin conectar automáticamente',()=>{
  const f=fixture();render(<Frontend {...f.props}/>);
  expect(screen.getByRole('heading',{name:'Brothers Royale'})).toBeTruthy();expect(screen.getAllByRole('button',{name:/Polo /})).toHaveLength(12);
  expect(screen.getByRole('button',{name:'Practicar sin conexión'})).toBeTruthy();expect(f.onConnect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Polo Lima'}));expect(f.onProfile).toHaveBeenCalledWith({name:'Ana',skin:10});
 });
 it('permite crear privada, entrar por código o buscar pública',()=>{
  const f=fixture();render(<Frontend {...f.props}/>);fireEvent.click(screen.getByRole('button',{name:/Crear sala/}));
  fireEvent.click(screen.getByRole('button',{name:'Crear y entrar'}));expect(f.onConnect).toHaveBeenCalledWith(expect.objectContaining({mode:'create',visibility:'private',skin:0}));
  fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));fireEvent.click(screen.getByRole('button',{name:'Entrar a sala'}));
  fireEvent.change(screen.getByLabelText('Código de sala'),{target:{value:'ABC123'}});fireEvent.click(screen.getByRole('button',{name:'Entrar'}));expect(f.onConnect).toHaveBeenLastCalledWith(expect.objectContaining({mode:'join',code:'ABC123'}));
 });
 it('el anfitrión inicia y el participante confirma Listo, con contador visible',()=>{
  const lobby:LobbySnapshot={revision:1,host:'a',code:'ABC123',phase:'waiting',players:[{id:'a',name:'Ana',skin:0,connected:true,loaded:true,ready:false},{id:'b',name:'Beto',skin:1,connected:true,loaded:true,ready:true}],canStart:true};
  const f=fixture(lobby);const view=render(<Frontend {...f.props}/>);fireEvent.click(screen.getByRole('button',{name:'Iniciar partida'}));expect(f.game.startRound).toHaveBeenCalled();
  view.rerender(<Frontend {...f.props} localId="b"/>);fireEvent.click(screen.getByRole('button',{name:'Cancelar listo'}));expect(f.game.lobbyReady).toHaveBeenCalledWith(false);
  view.rerender(<Frontend {...f.props} busy/>);expect(screen.getByRole('button',{name:'Iniciar partida'}).hasAttribute('disabled')).toBe(true);
  view.rerender(<Frontend {...f.props} countdown={0} lobby={{...lobby,phase:'countdown'}}/>);expect(screen.getByText('Empieza en 10 s')).toBeTruthy();
  view.rerender(<Frontend {...f.props} countdown={7} lobby={{...lobby,phase:'countdown'}}/>);expect(screen.getByText('Empieza en 7 s')).toBeTruthy();
 });
 it('guarda nombre y polo, migra el nombre anterior y recupera preferencias corruptas',()=>{
  expect(parseHudLayout({health:{x:.2,y:.4}}).menu.visible).toBe(true);
  localStorage.setItem('br.name','Anterior');expect(loadProfile()).toEqual({name:'Anterior',skin:0});saveProfile({name:'  Ana  ',skin:11});expect(loadProfile()).toEqual({name:'Ana',skin:11});
  localStorage.setItem(PROFILE_KEY,'{');expect(loadProfile().skin).toBe(0);expect(parseProfile({name:12,skin:Infinity})).toEqual({name:'Jugador',skin:0});
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Bloqueado');});expect(()=>saveProfile({name:'B',skin:2})).not.toThrow();
 });
 it('presenta todas las estadísticas finales recibidas y las dos salidas',()=>{
  const result={round:1,elapsed:600,reason:'survivor',winners:['a'],scores:[{id:'a',name:'Ana',position:1,eliminations:3,deaths:1,damageDealt:500,accuracy:45,woodCollected:120,structuresBuilt:6,survivalSeconds:600}]} as RoundResult;
  const onLobby=vi.fn(),onRematch=vi.fn();render(<Results result={result} localId="a" onLobby={onLobby} onRematch={onRematch}/>);
  for(const label of ['Posición','Eliminaciones','Muertes','Daño causado','Precisión','Madera recolectada','Estructuras construidas','Tiempo de supervivencia'])expect(screen.getByText(label)).toBeTruthy();
  expect(screen.getByText('Ganador: Ana')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Jugar otra vez'}));fireEvent.click(screen.getByRole('button',{name:'Volver al lobby'}));expect(onRematch).toHaveBeenCalled();expect(onLobby).toHaveBeenCalled();
 });
 it('las etiquetas usan texto literal, se ocultan tras paredes y liberan al retirar jugadores',()=>{
  const tags=new NameTags(),camera=new PerspectiveCamera(45,1,.1,100);camera.position.set(0,2,8);camera.lookAt(0,1,0);camera.updateMatrixWorld();
  const players=[{id:'a',name:'<img src=x onerror=alert(1)>',position:{x:0,y:0,z:0},shown:true}];
  tags.frame(players,camera,400,400,.11,()=>true);expect(tags.root.querySelector('img')).toBeNull();expect(tags.root.textContent).toContain('<img');expect(tags.root.querySelector('span')?.hidden).toBe(false);
  tags.frame(players,camera,400,400,.11,()=>false);expect(tags.root.querySelector('span')?.hidden).toBe(true);tags.frame([],camera,400,400,.11,()=>true);expect(tags.root.children).toHaveLength(0);tags.dispose();
 });
});
