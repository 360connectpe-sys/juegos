import { useState, type FormEvent } from 'react';
import type { Game, OnlineRequest } from '@/game/Game';
import type { LobbySnapshot } from '@shared/lobby/LobbyState';
import { SHIRTS, type Profile } from '@shared/lobby/profile';
import { sanitizeName, sanitizeRoomCode } from '@shared/session';
import { checkServerUrl } from '@/net/config';
import type { RoundResult } from '@shared/battle/BattleRound';
import { Logo } from './Logo';

interface Props {
  game:Game;profile:Profile;lobby?:LobbySnapshot;localId:string;countdown?:number;server:string;error?:string;busy:boolean;
  onProfile(p:Profile):void;onConnect(r:OnlineRequest):void;onPractice():void;onSettings():void;onLeave():void;
}
export function Frontend({game,profile,lobby,localId,countdown,server:initialServer,error,busy,onProfile,onConnect,onPractice,onSettings,onLeave}:Props){
  const [editingSkin,setEditingSkin]=useState(false);
  const [form,setForm]=useState<'create'|'join'|null>(null);
  const [visibility,setVisibility]=useState<'private'|'public'>('private');
  const [code,setCode]=useState(''),[server,setServer]=useState(initialServer),[localError,setError]=useState('');
  const me=lobby?.players.find(p=>p.id===localId),host=lobby?.host===localId;
  const waiting=!lobby||lobby.phase==='waiting';
  const submit=(e:FormEvent)=>{
    e.preventDefault();const issue=checkServerUrl(server.trim(),window.location.protocol);
    if(issue){setError(issue);return;}
    if(form==='join'&&!sanitizeRoomCode(code)){setError('Escribe el código de la sala');return;}
    setError('');onConnect({url:server.trim(),name:sanitizeName(profile.name)||'Jugador',skin:profile.skin,mode:form??'quick',visibility,code:sanitizeRoomCode(code)});
  };
  return <section className="front" aria-label={lobby?'Lobby de sala':'Pantalla principal'}>
    <header className="front__brand"><Logo/><span className="front__season">TU EQUIPO. TU ÚLTIMA VIDA.</span></header>
    <div className="front__left">
      <p className="front__eyebrow">{lobby?'PUNTO DE ENCUENTRO':'8 JUGADORES · 3 VIDAS · UNA VICTORIA'}</p>
      <h2>{lobby?'Prepara la partida.':<>Entra a la isla.<br/>Juega a tu manera.</>}</h2>
      <label className="front__name">Tu nombre<input value={profile.name} maxLength={16} autoComplete="nickname" disabled={!waiting||busy} onChange={e=>onProfile({...profile,name:e.target.value})} onBlur={()=>onProfile({...profile,name:sanitizeName(profile.name)||'Jugador'})}/></label>
      {!lobby?<div className="front__actions">
        <button className="front__primary" disabled={busy} onClick={()=>setForm('create')}>Crear sala <span>→</span></button>
        <button disabled={busy} onClick={()=>setForm('join')}>Entrar a sala</button>
        <button onClick={onPractice} disabled={busy}>Practicar sin conexión</button>
      </div>:<div className="front__actions">
        {lobby.phase==='waiting'&&(host?<button className="front__primary" onClick={()=>game.startRound()} disabled={busy||!lobby.canStart}>Iniciar partida</button>:<button className="front__primary" aria-pressed={me?.ready??false} disabled={busy} onClick={()=>game.lobbyReady(!me?.ready)}>{me?.ready?'Cancelar listo':'Listo'}</button>)}
        {lobby.phase==='countdown'&&<p role="status">Empieza en {Math.ceil(countdown||10)} s</p>}
        {host&&lobby.phase==='waiting'&&!lobby.canStart&&<p className="front__note">Mínimo 2 jugadores. Todos los participantes deben estar listos.</p>}
        <button onClick={onLeave}>Salir de la sala</button>
      </div>}
      <button className="front__settings" onClick={onSettings}>Ajustes</button>
      {(error||localError)&&<p className="front__error" role="alert">{localError||error}</p>}
      {busy&&<p role="status">Conectando a la sala…</p>}
    </div>
    <aside className="front__right">
      {lobby&&<div className="room-card">
        <div className="room-card__heading"><span>{lobby.code?'SALA PRIVADA':'SALA PÚBLICA'}</span><strong>{lobby.players.length}/8</strong></div>
        {lobby.code&&<p className="room-card__code" aria-label="Código de sala">{lobby.code}</p>}
        <ul aria-label="Jugadores de la sala">{lobby.players.map(p=><li key={p.id}>
          <i style={{background:SHIRTS[p.skin]?.[1]}} aria-hidden="true"/>
          <span>{p.name}{p.id===localId?' · tú':''}<small>{p.id===lobby.host?'Anfitrión':!p.connected?'Reconectando…':!p.loaded?'Cargando…':p.ready?'Listo':'Preparándose'}</small></span>
          {p.connected&&p.loaded&&(p.ready||p.id===lobby.host)&&<b aria-label="Listo">✓</b>}
        </li>)}</ul>
      </div>}
      {lobby&&<button className="front__custom-toggle" onClick={()=>setEditingSkin(!editingSkin)} disabled={!waiting}>{editingSkin?'Cerrar colores':'Cambiar color de polo'}</button>}
      {(!lobby||editingSkin)&&<fieldset className="front__skins" disabled={!waiting||busy}><legend>COLOR DE POLO</legend><p>{SHIRTS[profile.skin]?.[0]}</p><div>{SHIRTS.map(([name,color],skin)=><button key={name} type="button" aria-label={`Polo ${name}`} aria-pressed={profile.skin===skin} style={{background:color}} onClick={()=>onProfile({...profile,skin})}/>)}</div><small>Tu estilo. Las mismas posibilidades.</small></fieldset>}
    </aside>
    <span className="front__character-name">{me?.name||profile.name||'Jugador'}</span>
    {form&&!lobby&&<div className="front__modal" role="dialog" aria-modal="true" aria-label={form==='create'?'Crear sala':'Entrar a sala'}><form onSubmit={submit}>
      <h2>{form==='create'?'Tu próxima partida':'Reúnete con tu equipo'}</h2>
      {form==='create'?<fieldset><legend>Visibilidad</legend><label><input type="radio" name="visibility" checked={visibility==='private'} onChange={()=>setVisibility('private')}/>Privada · compartir código</label><label><input type="radio" name="visibility" checked={visibility==='public'} onChange={()=>setVisibility('public')}/>Pública · abierta a jugadores</label></fieldset>:<label>Código de sala<input autoFocus value={code} maxLength={8} autoCapitalize="characters" onChange={e=>setCode(sanitizeRoomCode(e.target.value))}/></label>}
      <details><summary>Conexión</summary><label>Servidor<input value={server} onChange={e=>setServer(e.target.value)} inputMode="url" spellCheck={false}/></label></details>
      {(localError||error)&&<p role="alert">{localError||error}</p>}
      <button className="front__primary" disabled={busy}>{busy?'Conectando…':form==='create'?'Crear y entrar':'Entrar'}</button>
      {form==='join'&&<button type="button" disabled={busy} onClick={()=>{const issue=checkServerUrl(server,window.location.protocol);if(issue)setError(issue);else onConnect({url:server,name:profile.name,skin:profile.skin,mode:'quick',code:''});}}>Buscar sala pública</button>}
      <button type="button" disabled={busy} onClick={()=>{setForm(null);setError('');}}>Cancelar</button>
    </form></div>}
    <footer className="front__footer">BROTHERS ROYALE <span>Hecho para jugar juntos.</span></footer>
  </section>;
}
export function Results({result,localId,onLobby,onRematch,busy=false}:{result:RoundResult;busy?:boolean;localId:string;onLobby():void;onRematch():void}){
  const mine=result.scores.find(p=>p.id===localId),winner=result.winners.map(id=>result.scores.find(p=>p.id===id)?.name??id).join(', ');
  const seconds=Math.floor(mine?.survivalSeconds??result.elapsed);
  const stats=[['Posición',mine?`#${mine.position??'—'}`:'Espectador'],['Eliminaciones',mine?.eliminations??0],['Muertes',mine?.deaths??0],['Daño causado',Math.round(mine?.damageDealt??0)],['Precisión',`${(mine?.accuracy??0).toFixed(1)} %`],['Madera recolectada',mine?.woodCollected??0],['Estructuras construidas',mine?.structuresBuilt??0],['Tiempo de supervivencia',`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`]];
  return <section className="results" aria-label="Resultado de la partida"><Logo/><p className="front__eyebrow">PARTIDA COMPLETADA</p><h2>{result.winners.length===1?`Ganador: ${winner}`:'Empate'}</h2>
    <p>{mine?`Bien jugado, ${mine.name}. Cada partida cuenta.`:'Has observado esta partida.'}</p>
    <dl>{stats.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {busy&&<p role="status">Reconectando… Tus resultados están conservados.</p>}<div className="results__actions"><button className="front__primary" disabled={busy} onClick={onRematch}>Jugar otra vez</button><button disabled={busy} onClick={onLobby}>Volver al lobby</button></div>
  </section>;
}
