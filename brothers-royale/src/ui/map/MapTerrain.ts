import { Color } from 'three';
import type { WorldLayout } from '@shared/world/layout';
import { terrainHeight,sectorAt,WATER_LEVEL } from '@shared/world/terrain';
import { placePart } from '@shared/world/prefab';
import { Vector3,Quaternion } from 'three';

export const MAP_PIXELS=768;
const cache=new WeakMap<WorldLayout,HTMLCanvasElement>();
/** Rasteriza una vez por escenario. Agua a la misma cota que createWater. */
export function mapTerrain(layout:WorldLayout):HTMLCanvasElement {
  const cached=cache.get(layout);if(cached)return cached;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=MAP_PIXELS;
  const ctx=canvas.getContext('2d');if(!ctx)return canvas;
  const size=layout.terrain.size,half=size/2,u=(x:number)=>(x+half)/size*MAP_PIXELS;
  const tint={residential:[1.04,1.02,.94],rural:[1.08,1.04,.82],forest:[.82,.92,.8],open:[1,1.06,.92]} as const;
  const img=ctx.createImageData(MAP_PIXELS,MAP_PIXELS);
  // Una muestra cada 4 px (~.63m), interpolación visual sin otro render 3D.
  for(let z=0;z<MAP_PIXELS;z+=4)for(let x=0;x<MAP_PIXELS;x+=4){
    const wx=(x/MAP_PIXELS-.5)*size,wz=(z/MAP_PIXELS-.5)*size,h=terrainHeight(wx,wz,layout.terrain);
    const k=Math.max(0,Math.min(1,h/3)),t=tint[sectorAt(wx,wz,layout.seed)];
    const slope=h-terrainHeight(wx+.5,wz+.5,layout.terrain),shade=Math.max(.78,Math.min(1.12,1+slope*.22));
    const color=h<WATER_LEVEL?[54,137,168]:h<-.2?[232,208,138]:[(124-45*k)*t[0]*shade,(196-42*k)*t[1]*shade,(86-28*k)*t[2]*shade];
    for(let dz=0;dz<4;dz++)for(let dx=0;dx<4;dx++){const i=((z+dz)*MAP_PIXELS+x+dx)*4;img.data[i]=color[0]!;img.data[i+1]=color[1]!;img.data[i+2]=color[2]!;img.data[i+3]=255;}
  }
  ctx.putImageData(img,0,0);
  ctx.strokeStyle='#b59a6a';ctx.lineWidth=2.2/size*MAP_PIXELS;ctx.lineCap='round';
  for(const h of layout.houses){
    const d=h.def.nav?.door??{x:0,z:0},c=Math.cos(h.rotationY),s=Math.sin(h.rotationY);
    ctx.beginPath();ctx.moveTo(u(0),u(0));ctx.lineTo(u(h.x+d.x*c+d.z*s),u(h.z-d.x*s+d.z*c));ctx.stroke();
  }
  ctx.fillStyle='#285e35';for(const t of layout.trees){ctx.beginPath();ctx.arc(u(t.x),u(t.z),1.25*t.scale/size*MAP_PIXELS,0,Math.PI*2);ctx.fill();}
  ctx.fillStyle='#7c8278';for(const r of layout.rocks){ctx.beginPath();ctx.ellipse(u(r.x),u(r.z),r.scale/size*MAP_PIXELS,r.scale*.7/size*MAP_PIXELS,r.rotation,0,Math.PI*2);ctx.fill();}
  const v=new Vector3(),q=new Quaternion(),color=new Color();
  for(const building of layout.structures){
    if(building.def.id==='chest')continue;
    // Huellas reales de sus piezas, incluidos los edificios girados; no cuadrados aproximados.
    for(const p of building.def.parts){if(p.kind!=='box'||!p.visible)continue;
      const at=placePart(building,p);q.set(at.rotation.x,at.rotation.y,at.rotation.z,at.rotation.w);
      ctx.beginPath();let first=true;
      for(const [sx,sz] of [[-1,-1],[1,-1],[1,1],[-1,1]]){
        v.set(sx!*p.size.x/2,p.size.y/2,sz!*p.size.z/2).applyQuaternion(q).add(at.center);
        if(first){ctx.moveTo(u(v.x),u(v.z));first=false;}else ctx.lineTo(u(v.x),u(v.z));
      }
      color.set(p.color);ctx.fillStyle='#'+color.getHexString();ctx.closePath();ctx.fill();
    }
  }
  cache.set(layout,canvas);return canvas;
}
