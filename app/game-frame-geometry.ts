export type Frame = { width:number; height:number; left:number; top:number; right:number; bottom:number };
// Fine shared coordinates are independent of the display's ten-CSS-pixel peg grid.
// Piecewise mapping on BOTH axes keeps strokes continuous at all four corners.
export const FRAME_COLS = 1024;
export const FRAME_ROWS = 1024;
export const PEG_SPACING = 10;
type Point = {x:number;y:number};
export function inFrame(x:number,y:number) {
  return x>=0&&x<1024&&y>=0&&y<1024&&(x<256||x>=768||y<128||y>=896);
}
function map(value:number, a:number,b:number,c:number,d:number) {
  return c+(value-a)/(b-a)*(d-c);
}
function encode(v:number,lo:number,hi:number,end:number,a:number,b:number) {
  return v<lo?map(v,0,lo,0,a):v>=hi?map(v,hi,end,b,1024):map(v,lo,hi,a,b);
}
function decode(v:number,lo:number,hi:number,end:number,a:number,b:number) {
  return v<a?map(v,0,a,0,lo):v>=b?map(v,b,1024,hi,end):map(v,a,b,lo,hi);
}
export function frameCell(px:number,py:number,f:Frame) {
  if(px<0||py<0||px>=f.width||py>=f.height)return null;
  const x=Math.floor(encode(px,f.left,f.right,f.width,256,768));
  const y=Math.floor(encode(py,f.top,f.bottom,f.height,128,896));
  return inFrame(x,y)?{x,y}:null;
}
export function framePoint(x:number,y:number,f:Frame) {
  return {x:decode(x+.5,f.left,f.right,f.width,256,768),y:decode(y+.5,f.top,f.bottom,f.height,128,896)};
}
export function frameGrid(f:Frame) {
  const cols=Math.max(1,Math.floor(f.width/PEG_SPACING)),rows=Math.max(1,Math.floor(f.height/PEG_SPACING));
  return {cols,rows,left:(f.width-cols*PEG_SPACING)/2,top:(f.height-rows*PEG_SPACING)/2};
}
export function framePeg(x:number,y:number,f:Frame) {
  const g=frameGrid(f);
  return {x:g.left+(x+.5)*PEG_SPACING,y:g.top+(y+.5)*PEG_SPACING,r:2.4};
}
export function visiblePeg(x:number,y:number,f:Frame) {
  const p=framePeg(x,y,f);
  return p.x+p.r<f.left||p.x-p.r>f.right||p.y+p.r<f.top||p.y-p.r>f.bottom;
}
export function frameIndex(x:number,y:number,f:Frame) {
  const p=framePoint(x,y,f),g=frameGrid(f);
  const cx=Math.max(0,Math.min(g.cols-1,Math.floor((p.x-g.left)/PEG_SPACING)));
  const cy=Math.max(0,Math.min(g.rows-1,Math.floor((p.y-g.top)/PEG_SPACING)));
  return visiblePeg(cx,cy,f)?cy*g.cols+cx:null;
}
export function frameLine(a:Point,b:Point) {
  const steps=Math.max(Math.abs(b.x-a.x),Math.abs(b.y-a.y),1),points=new Set<number>();
  for(let i=0;i<=steps;i++){
    const x=Math.round(a.x+(b.x-a.x)*i/steps),y=Math.round(a.y+(b.y-a.y)*i/steps);
    if(inFrame(x,y))points.add(y*FRAME_COLS+x);
  }
  return [...points];
}
