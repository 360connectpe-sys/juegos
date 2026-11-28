import {describe,it,expect,vi,afterEach} from 'vitest';
import {SoundFx} from '@/game/combat/SoundFx';
afterEach(()=>vi.unstubAllGlobals());
describe('recursos de audio 15.1',()=>{
 it('desconecta el grafo al terminar ambas fuentes y al salir',()=>{
  const nodes:{disconnect:ReturnType<typeof vi.fn>;onended:(()=>void)|null}[]=[];
  const node=()=>{const n={connect:(v:unknown)=>v,disconnect:vi.fn(),onended:null as (()=>void)|null,gain:{value:0,setValueAtTime(){},exponentialRampToValueAtTime(){}},frequency:{value:0,setValueAtTime(){},exponentialRampToValueAtTime(){},linearRampToValueAtTime(){}},start(){},stop(){},buffer:null as unknown};nodes.push(n);return n;};
  class Context{state='running';currentTime=0;sampleRate=8000;destination={};createGain=node;createBufferSource=node;createOscillator=node;createBiquadFilter=node;createBuffer(_c:number,n:number){return {getChannelData:()=>new Float32Array(n)};}close(){return Promise.resolve();}}
  vi.stubGlobal('AudioContext',Context);
  const listeners=new Map<string,()=>void>(),target={addEventListener:(k:string,fn:()=>void)=>listeners.set(k,fn),removeEventListener:(k:string)=>listeners.delete(k)};
  const fx=new SoundFx(target as unknown as Window);listeners.get('click')!();const start=nodes.length;fx.play('sniper');const sound=nodes.slice(start),sources=sound.filter(n=>n.onended);expect(sources).toHaveLength(2);sources[0]!.onended!();expect(sound.every(n=>n.disconnect.mock.calls.length===0)).toBe(true);sources[1]!.onended!();expect(sound.every(n=>n.disconnect.mock.calls.length===1)).toBe(true);fx.play('rifle');fx.dispose();expect(listeners.size).toBe(0);expect(nodes[0]!.disconnect).toHaveBeenCalled();
 });
});
