/** Coordenadas normalizadas al panel; no contiene ni recibe posiciones enemigas. */
export class MapViewport {
  zoom = 1;
  x = 0;
  y = 0;
  private points = new Map<number, {x:number;y:number;startX:number;startY:number}>();
  private gesture = false;
  reset():void { this.zoom=1;this.x=this.y=0;this.cancel(); }
  private clamp():void {
    const limit=(this.zoom-1)/2;
    this.x=Math.max(-limit,Math.min(limit,this.x))+0;this.y=Math.max(-limit,Math.min(limit,this.y))+0;
  }
  zoomAt(factor:number,u=.5,v=.5):void {
    if(!Number.isFinite(factor)||factor<=0)return;
    const next=Math.max(1,Math.min(6,this.zoom*factor)),k=next/this.zoom;
    this.x=(u-.5)-(u-.5-this.x)*k;this.y=(v-.5)-(v-.5-this.y)*k;this.zoom=next;this.clamp();
  }
  hasPointer(id:number):boolean {return this.points.has(id);}
  down(id:number,x:number,y:number):void {
    if(!this.points.size)this.gesture=false;
    this.points.set(id,{x,y,startX:x,startY:y});if(this.points.size>1)this.gesture=true;
  }
  move(id:number,x:number,y:number,pan=true):void {
    const p=this.points.get(id);if(!p)return;
    const all=[...this.points.values()];
    if(all.length===2){
      const a=all[0]!,b=all[1]!,old=Math.hypot(a.x-b.x,a.y-b.y),cx=(a.x+b.x)/2,cy=(a.y+b.y)/2;
      const dx=x-p.x,dy=y-p.y;p.x=x;p.y=y;
      const dist=Math.hypot(a.x-b.x,a.y-b.y);
      if(old>1e-5)this.zoomAt(dist/old,cx,cy);
      this.x+=dx/2;this.y+=dy/2;this.clamp();return;
    }
    if(Math.hypot(x-p.startX,y-p.startY)>.015)this.gesture=true;
    if(pan&&this.gesture){this.x+=x-p.x;this.y+=y-p.y;this.clamp();}
    p.x=x;p.y=y;
  }
  up(id:number):{x:number;y:number}|null {
    const p=this.points.get(id);if(!p)return null;
    const tap=!this.gesture&&this.points.size===1?this.world(p.x,p.y):null;
    this.points.delete(id);return tap;
  }
  lost(id:number):void {if(this.points.has(id))this.cancel();}
  cancel():void {this.points.clear();this.gesture=true;}
  world(u:number,v:number):{x:number;y:number}|null {
    const x=(u-.5-this.x)/this.zoom+.5,y=(v-.5-this.y)/this.zoom+.5;
    return x>=0&&x<=1&&y>=0&&y<=1?{x,y}:null;
  }
  screen(x:number,y:number):{x:number;y:number}{return {x:(x-.5)*this.zoom+.5+this.x,y:(y-.5)*this.zoom+.5+this.y};}
}
