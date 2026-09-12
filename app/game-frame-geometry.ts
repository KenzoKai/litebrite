import { COLS, ROWS } from './board-geometry';
export type Frame = { width:number; height:number; left:number; top:number; right:number; bottom:number };
// A shared ring of cells surrounds a protected game rectangle on every display.
export function inFrame(x:number,y:number) { return x>=0&&x<COLS&&y>=0&&y<ROWS&&(x<8||x>=48||y<8||y>=28); }
function segment(value:number, a:number,b:number,lo:number,hi:number) { return lo+(value-a)/(b-a)*(hi-lo); }
export function frameCell(px:number,py:number,f:Frame) {
  if(px<0||py<0||px>=f.width||py>=f.height)return null;
  const y=py<f.top?segment(py,0,f.top,0,8):py>=f.bottom?segment(py,f.bottom,f.height,28,36):segment(py,f.top,f.bottom,8,28);
  const x=y<8||y>=28?px/f.width*56:px<f.left?segment(px,0,f.left,0,8):px>=f.right?segment(px,f.right,f.width,48,56):28;
  return inFrame(Math.floor(x),Math.floor(y))?{x:Math.floor(x),y:Math.floor(y)}:null;
}
export function framePeg(x:number,y:number,f:Frame) {
  const top=y<8,bottom=y>=28;
  const sy=top?f.top/8:bottom?(f.height-f.bottom)/8:(f.bottom-f.top)/20;
  const sx=top||bottom?f.width/56:x<8?f.left/8:(f.width-f.right)/8;
  return {x:top||bottom?(x+.5)*sx:x<8?(x+.5)*sx:f.right+(x-48+.5)*sx,
    y:top?(y+.5)*sy:bottom?f.bottom+(y-28+.5)*sy:f.top+(y-8+.5)*sy,r:Math.max(1,Math.min(sx,sy)*.24)};
}
