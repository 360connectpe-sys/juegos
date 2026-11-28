import { BufferGeometry,Float32BufferAttribute } from 'three';
import { BUILD,buildDef,type BuildKind } from '@shared/building/BuildingState';
import { merge,transform } from './geometry';
export function damageLevel(hp:number):0|1|2|3 {const ratio=hp/BUILD.hp;return ratio>.75?0:ratio>.5?1:ratio>.25?2:3;}
/** Tiras de dos triángulos sobre la superficie; mismas colisiones y un único material. */
export function crackGeometry(kind:BuildKind,level:0|1|2|3):BufferGeometry|null {
  if(!level)return null;
  const parts:BufferGeometry[]=[];
  for(const part of buildDef(kind).parts){
    if(part.kind!=='box')continue;
    const sizes=[part.size.x,part.size.y,part.size.z],thin=sizes.indexOf(Math.min(...sizes)),axes=[0,1,2].filter(a=>a!==thin),u=axes[0]!,v=axes[1]!;
    const P:number[]=[],N:number[]=[],C:number[]=[];
    for(const side of [-1,1])for(let branch=0;branch<level;branch++){
      const x0=(-.28+branch*.26)*sizes[u]!,y0=(-.3+branch*.21)*sizes[v]!;
      for(let segment=0;segment<3;segment++){
        const ax=x0+(segment%2)*.12*sizes[u]!,ay=y0+segment*.14*sizes[v]!;
        const bx=x0+((segment+1)%2)*.12*sizes[u]!,by=y0+(segment+1)*.14*sizes[v]!;
        const dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy),w=.008+level*.002,ox=-dy/len*w,oy=dx/len*w;
        const corners=[[ax+ox,ay+oy],[ax-ox,ay-oy],[bx-ox,by-oy],[bx+ox,by+oy]];
        for(const index of [0,1,2,0,2,3]){const xy=corners[index]!,p=[0,0,0],n=[0,0,0];p[u]=xy[0]!;p[v]=xy[1]!;p[thin]=side*(sizes[thin]!/2+.004);n[thin]=side;
          P.push(...p);N.push(...n);C.push(.09,.045,.018);
        }
      }
    }
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(P,3));g.setAttribute('normal',new Float32BufferAttribute(N,3));g.setAttribute('color',new Float32BufferAttribute(C,3));
    // Cuádruples en ambas caras con orden correcto, sin material DoubleSide.
    const pos=g.getAttribute('position'),normal=g.getAttribute('normal');
    for(let i=0;i<pos.count;i+=3){const ax=pos.getX(i+1)-pos.getX(i),ay=pos.getY(i+1)-pos.getY(i),az=pos.getZ(i+1)-pos.getZ(i),bx=pos.getX(i+2)-pos.getX(i),by=pos.getY(i+2)-pos.getY(i),bz=pos.getZ(i+2)-pos.getZ(i);
      if((ay*bz-az*by)*normal.getX(i)+(az*bx-ax*bz)*normal.getY(i)+(ax*by-ay*bx)*normal.getZ(i)<0){for(let a=0;a<3;a++){const arr=pos.array as Float32Array,t=arr[(i+1)*3+a]!;arr[(i+1)*3+a]=arr[(i+2)*3+a]!;arr[(i+2)*3+a]=t;}}
    }
    parts.push(transform(g,part.center.x,part.center.y,part.center.z,part.rot?.x??0,part.rot?.y??0,part.rot?.z??0));
  }
  return merge(parts);
}
