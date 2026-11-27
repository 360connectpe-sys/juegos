import { isSkin, type Profile } from '@shared/lobby/profile';
import { sanitizeName } from '@shared/session';
import { loadSavedName, saveName } from '@/net/config';
export const PROFILE_KEY='br.profile.v1';
export function parseProfile(raw:unknown):Profile{
  const p=raw&&typeof raw==='object'?raw as Partial<Profile>:{};
  return{name:sanitizeName(p.name)||'Jugador',skin:isSkin(p.skin)?p.skin:0};
}
export function loadProfile():Profile{
  try{return parseProfile(JSON.parse(localStorage.getItem(PROFILE_KEY)??JSON.stringify({name:loadSavedName()})));}
  catch{return parseProfile({name:loadSavedName()});}
}
export function saveProfile(p:Profile):void{
  const clean=parseProfile(p);saveName(clean.name);
  try{localStorage.setItem(PROFILE_KEY,JSON.stringify(clean));}catch{/* Preferencias utilizables aunque el almacenamiento esté bloqueado. */}
}
export function newRoomCode():string{
  const bytes=crypto.getRandomValues(new Uint8Array(8));const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...bytes].map(n=>alphabet[n%alphabet.length]).join('');
}
