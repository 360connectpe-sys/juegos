/** Dos segmentos de 0,4 m. El tobillo compensa la flexión para mantener la suela horizontal. */
export function crouchLegPose(drop:number,stride:number,lift=0,bob=0,out={hip:0,knee:0,ankle:0}):{hip:number;knee:number;ankle:number}{
  const y=Math.max(.12,.8-drop+bob-lift),distance=Math.min(.8,Math.hypot(y,stride));
  const knee=2*Math.acos(distance/.8),hip=-Math.atan2(stride,y)-knee/2;
  out.hip=hip;out.knee=knee;out.ankle=-hip-knee;return out;
}
