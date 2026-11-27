import { Vector3, type Camera } from 'three';
import type { Vec3 } from '@shared/types';
/** Ocho etiquetas reutilizadas, sin texturas ni llamadas de dibujo. */
export class NameTags {
  readonly root=document.createElement('div');
  private readonly labels=new Map<string,HTMLSpanElement>();
  private readonly visible=new Map<string,boolean>();
  private readonly point=new Vector3();
  private readonly from=new Vector3();
  private timer=0;
  constructor(){this.root.className='name-tags';this.root.setAttribute('aria-label','Nombres de jugadores');}
  frame(players:Iterable<{id:string;name:string;position:Vec3;shown:boolean}>,camera:Camera,width:number,height:number,dt:number,los:(a:Vec3,b:Vec3)=>boolean):void{
    this.timer+=dt;const check=this.timer>=.1;if(check)this.timer=0;
    const seen=new Set<string>();
    for(const p of players){
      seen.add(p.id);let label=this.labels.get(p.id);
      if(!label){if(this.labels.size>=8)continue;label=document.createElement('span');this.labels.set(p.id,label);this.root.append(label);}
      if(label.textContent!==p.name)label.textContent=p.name;
      this.point.set(p.position.x,p.position.y+2.1,p.position.z).project(camera);
      const inside=p.shown&&this.point.z>=-1&&this.point.z<=1&&Math.abs(this.point.x)<1&&Math.abs(this.point.y)<1;
      if(check&&inside){
        this.from.copy(this.point).setZ(-1).unproject(camera);
        this.visible.set(p.id,los(this.from,{x:p.position.x,y:p.position.y+2.1,z:p.position.z}));
      }
      label.hidden=!inside||!this.visible.get(p.id);
      if(!label.hidden)label.style.transform=`translate(${(this.point.x*.5+.5)*width}px,${(-this.point.y*.5+.5)*height}px) translate(-50%,-100%)`;
    }
    for(const[id,label]of this.labels)if(!seen.has(id)){label.remove();this.labels.delete(id);this.visible.delete(id);}
  }
  dispose():void{this.root.remove();this.labels.clear();this.visible.clear();}
}
