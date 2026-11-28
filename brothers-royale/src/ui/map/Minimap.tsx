import { useEffect,useRef,useState,type PointerEvent } from 'react';
import type { Game } from '@/game/Game';
import { MapViewport } from './MapViewport';
import { mapTerrain,MAP_PIXELS } from './MapTerrain';

/** Sin coordenadas de otros jugadores: solo navegación personal y estado de zona. */
export function Minimap({game,expanded=false,onOpen}:{game:Game|null;expanded?:boolean;onOpen?:()=>void}){
  const pixels=expanded?MAP_PIXELS:320;
  const panel=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null);
  const view=useRef(new MapViewport());const [zoom,setZoom]=useState(1);
  const redraw=useRef<()=>void>(()=>{});
  useEffect(()=>{
    const layout=game?.worldLayout,ctx=canvas.current?.getContext('2d');if(!game||!layout||!ctx)return;
    const base=mapTerrain(layout);
    const draw=()=>{
      const st=game.minimapState(),vp=view.current,n=pixels;if(!st.size)return;
      const u=(w:number)=>(w/st.size+.5),point=(x:number,z:number)=>{const p=vp.screen(u(x),u(z));return {x:p.x*n,y:p.y*n};};
      ctx.clearRect(0,0,n,n);ctx.fillStyle='#193f4b';ctx.fillRect(0,0,n,n);
      ctx.drawImage(base,(.5+vp.x-vp.zoom/2)*n,(.5+vp.y-vp.zoom/2)*n,n*vp.zoom,n*vp.zoom);
      const px=expanded?3:n/80;
      if(st.zone){
        const a=point(st.zone.current.x,st.zone.current.z);
        ctx.beginPath();ctx.rect(0,0,n,n);ctx.arc(a.x,a.y,st.zone.current.radius/st.size*n*vp.zoom,0,Math.PI*2);ctx.fillStyle='#673daf50';ctx.fill('evenodd');
        for(const [circle,color,dash] of [[st.zone.current,'#c893ff',false],[st.zone.next,'#ffffff',true]] as const){const p=point(circle.x,circle.z);ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=px;ctx.setLineDash(dash?[10,8]:[]);ctx.arc(p.x,p.y,circle.radius/st.size*n*vp.zoom,0,Math.PI*2);ctx.stroke();}ctx.setLineDash([]);
      }
      // Solo el avión propio: los de reaparición rivales también revelarían su ubicación.
      for(const pl of st.planes??[]){if(!pl.mine)continue;const a=point(pl.ax,pl.az),b=point(pl.bx,pl.bz),p=point(pl.x,pl.z);ctx.strokeStyle='#ffe08b';ctx.lineWidth=px;ctx.setLineDash([10,9]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#ffdf67';ctx.beginPath();ctx.arc(p.x,p.y,px*2,0,Math.PI*2);ctx.fill();}
      ctx.fillStyle='#ffd34d';for(const chest of st.chests){if(chest.opened)continue;const p=point(chest.x,chest.z);ctx.fillRect(p.x-px,p.y-px,px*2,px*2);}
      for(const mark of st.markers){const p=point(mark.x,mark.z);ctx.fillStyle='#ffdf67';ctx.strokeStyle='#3c234f';ctx.lineWidth=px;ctx.beginPath();ctx.arc(p.x,p.y,px*2,0,Math.PI*2);ctx.fill();ctx.stroke();}
      if(st.local){const p=point(st.local.x,st.local.z);ctx.save();ctx.translate(p.x,p.y);ctx.rotate(-st.local.yaw);ctx.fillStyle='white';ctx.strokeStyle='#231f5c';ctx.lineWidth=px;ctx.beginPath();ctx.moveTo(0,px*4);ctx.lineTo(px*2.7,-px*2.7);ctx.lineTo(-px*2.7,-px*2.7);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();}
    };
    redraw.current=draw;draw();const timer=window.setInterval(draw,100);return()=>{clearInterval(timer);redraw.current=()=>{};};
  },[game,expanded,pixels]);
  const refresh=()=>{setZoom(view.current.zoom);redraw.current();};
  const changeZoom=(factor:number)=>{view.current.zoomAt(factor);refresh();};
  useEffect(()=>{const node=panel.current;if(!node)return;const wheel=(e:WheelEvent)=>{e.preventDefault();const r=node.getBoundingClientRect();view.current.zoomAt(Math.exp(-Math.max(-120,Math.min(120,e.deltaY))*.003),(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height);setZoom(view.current.zoom);redraw.current();};node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);},[]);
  const pos=(e:PointerEvent)=>{const r=panel.current!.getBoundingClientRect();return {x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height};};
  return <div className={`map-panel${expanded?' map-panel--full':''}`}>
    <div ref={panel} className={`w-map${expanded?' w-map--full':''}`} role="button" tabIndex={0} aria-label={expanded?'Mapa: arrastra para desplazar, pellizca para zoom, toca para marcar destino':'Abrir mapa completo'}
      onPointerDown={e=>{e.preventDefault();const p=pos(e);view.current.down(e.pointerId,p.x,p.y);e.currentTarget.setPointerCapture?.(e.pointerId);}}
      onPointerMove={e=>{if(!view.current.hasPointer(e.pointerId))return;const p=pos(e);view.current.move(e.pointerId,p.x,p.y,expanded);refresh();}}
      onPointerUp={e=>{const p=pos(e);view.current.move(e.pointerId,p.x,p.y,expanded);const tap=view.current.up(e.pointerId);if(tap){if(expanded){const size=game?.worldLayout?.terrain.size??0;game?.addMapMarker((tap.x-.5)*size,(tap.y-.5)*size);}else onOpen?.();}refresh();}}
      onPointerCancel={()=>view.current.cancel()} onLostPointerCapture={e=>view.current.lost(e.pointerId)} onBlur={()=>view.current.cancel()}
      onKeyDown={e=>{if(e.key==='+'||e.key==='='){e.preventDefault();changeZoom(1.3);}else if(e.key==='-'){e.preventDefault();changeZoom(1/1.3);}else if(!expanded&&(e.key==='Enter'||e.key===' ')){e.preventDefault();onOpen?.();}}}>
      <canvas ref={canvas} width={pixels} height={pixels}/>
    </div>
    {expanded&&<div className="map-zoom" role="group" aria-label="Zoom del mapa"><button aria-label="Alejar mapa" onClick={()=>changeZoom(1/1.3)}>−</button><output>{zoom.toFixed(1)}×</output><button aria-label="Acercar mapa" onClick={()=>changeZoom(1.3)}>+</button><button onClick={()=>{view.current.reset();refresh();}}>Restablecer</button></div>}
  </div>;
}
