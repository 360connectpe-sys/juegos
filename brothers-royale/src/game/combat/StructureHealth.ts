import {Vector3,type Camera} from 'three';
import {anchorOf,buildTop,BUILD,type BuildPiece} from '@shared/building/BuildingState';
import type {Vec3} from '@shared/types';
/** Cuatro nodos DOM reutilizados; 0 draw calls, solo mientras reciben daño. */
export class StructureHealth {
  private readonly entries:{id:number;left:number;at:Vector3;el:HTMLDivElement;fill:HTMLDivElement;text:HTMLSpanElement;visible:boolean}[]=[];
  private next=0;private check=0;private readonly point=new Vector3();private readonly origin=new Vector3();
  constructor(parent:HTMLElement){for(let i=0;i<4;i++){const el=parent.ownerDocument.createElement('div'),fill=parent.ownerDocument.createElement('div'),text=parent.ownerDocument.createElement('span');el.className='structure-health';fill.className='structure-health__fill';el.style.display='none';el.append(fill,text);parent.append(el);this.entries.push({id:-1,left:0,at:new Vector3(),el,fill,text,visible:false});}}
  damage(piece:BuildPiece):void{
    let e=this.entries.find(e=>e.id===piece.id&&e.left>0);if(!e)e=this.entries[this.next++%this.entries.length]!;
    const a=anchorOf(piece);e.id=piece.id;e.left=3;e.visible=false;e.at.set(a.x,buildTop(piece)+.12,a.z);
    e.text.textContent=`${Math.ceil(piece.hp)}/${BUILD.hp}`;e.fill.style.transform=`scaleX(${piece.hp/BUILD.hp})`;e.el.style.display='none';
    this.check=0;
  }
  remove(id:number):void{for(const e of this.entries)if(e.id===id){e.left=0;e.el.style.display='none';}}
  frame(camera:Camera,width:number,height:number,dt:number,visible:(id:number,from:Vec3,to:Vec3)=>boolean):void{
    this.check-=dt;const check=this.check<=0;if(check)this.check=.1;camera.getWorldPosition(this.origin);
    for(const e of this.entries){if(e.left<=0)continue;e.left-=dt;this.point.copy(e.at).project(camera);
      const inView=this.point.z>=-1&&this.point.z<=1&&Math.abs(this.point.x)<1&&Math.abs(this.point.y)<1;
      if(check&&inView)e.visible=visible(e.id,this.origin,e.at);
      const show=e.left>0&&inView&&e.visible;e.el.style.display=show?'':'none';
      if(show)e.el.style.transform=`translate(${(this.point.x+1)*width/2}px,${(1-this.point.y)*height/2}px) translate(-50%,-100%)`;
    }
  }
  dispose():void{for(const e of this.entries)e.el.remove();this.entries.length=0;}
}
