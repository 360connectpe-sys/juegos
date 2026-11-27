import type { RoundPhase } from '../battle/BattleRound';
import { isSkin } from './profile';
import { sanitizeName } from '../session';
export interface LobbyPlayer { id: string; name: string; skin: number; connected: boolean; loaded: boolean; ready: boolean }
export interface LobbySnapshot { revision: number; host: string | null; code: string; phase: RoundPhase; players: LobbyPlayer[]; canStart: boolean }
/** Datos y permisos de sala, sin transporte ni confianza en ids suministrados por el cliente. */
export class LobbyState {
  readonly players=new Map<string,LobbyPlayer>();
  host: string|null=null;
  revision=0;
  constructor(readonly code: string,private readonly phase:()=>RoundPhase){}
  add(id:string,name:string,skin:number):void{
    if(this.players.size>=8||this.players.has(id)||!isSkin(skin))throw new Error('Sala llena o perfil inválido');
    this.players.set(id,{id,name,skin,connected:true,loaded:false,ready:false});this.elect();this.revision++;
  }
  remove(id:string):void{this.players.delete(id);this.elect();this.revision++;}
  connected(id:string,value:boolean):void{const p=this.players.get(id);if(p){p.connected=value;if(!value)p.loaded=false;this.elect();this.revision++;}}
  loaded(id:string):void{const p=this.players.get(id);if(p){p.loaded=true;this.revision++;}}
  private elect():void{
    if(this.host && this.players.get(this.host)?.connected)return;
    this.host=[...this.players.values()].find(p=>p.connected)?.id??null;
  }
  ready(id:string,value:unknown):boolean{
    const p=this.players.get(id);
    if(this.phase()!=='waiting'||!p?.connected||!p.loaded||typeof value!=='boolean')return false;
    p.ready=value;this.revision++;return true;
  }
  profile(id:string,name:string,skin:number):boolean{
    const p=this.players.get(id);if(!p||this.phase()!=='waiting'||!isSkin(skin))return false;
    p.name=name;p.skin=skin;p.ready=false;this.revision++;return true;
  }
  get canStart():boolean{
    return this.players.size>=2 && [...this.players.values()].every(p=>p.connected&&p.loaded&&(p.id===this.host||p.ready));
  }
  mayStart(id:string):boolean{return id===this.host&&this.phase()==='waiting'&&this.canStart;}
  resetReady():void{for(const p of this.players.values())p.ready=false;this.revision++;}
  snapshot():LobbySnapshot{return{revision:this.revision,host:this.host,code:this.code,phase:this.phase(),players:[...this.players.values()].map(p=>({...p})),canStart:this.canStart};}
}
export function validLobby(s:unknown):s is LobbySnapshot{
  if(!s||typeof s!=='object')return false;
  const l=s as LobbySnapshot;
  return Number.isSafeInteger(l.revision)&&l.revision>=0&&typeof l.code==='string'&&/^[A-Z0-9]{0,8}$/.test(l.code)&&
    ['waiting','countdown','running','finished'].includes(l.phase)&&typeof l.canStart==='boolean'&&Array.isArray(l.players)&&l.players.length<=8&&
    l.players.every(p=>p&&typeof p.id==='string'&&p.id.length>0&&p.id.length<=64&&typeof p.name==='string'&&p.name===sanitizeName(p.name)&&p.name.length>0&&isSkin(p.skin)&&typeof p.ready==='boolean'&&typeof p.connected==='boolean'&&typeof p.loaded==='boolean')&&
    new Set(l.players.map(p=>p.id)).size===l.players.length&&(l.host===null||l.players.some(p=>p.id===l.host&&p.connected));
}
