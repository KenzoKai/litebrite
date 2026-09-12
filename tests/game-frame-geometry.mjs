import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../app/game-frame-geometry.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {frameCell,framePoint,framePeg,frameGrid,frameIndex,frameLine,inFrame,visiblePeg}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
for(const [width,height,left,top,right,bottom] of [[1700,640,610,80,1090,560],[350,434,30,72,320,362],[280,364,24,72,256,292],[3840,640,1680,80,2160,560]]){
 const f={width,height,left,top,right,bottom},g=frameGrid(f);
 let sideColumns=new Set();
 for(let y=0;y<g.rows;y++)for(let x=0;x<g.cols;x++)if(visiblePeg(x,y,f)){
  const p=framePeg(x,y,f);assert.equal(p.r,2.4,'same radius everywhere');
  assert.equal(framePeg(x+1,y,f).x-p.x,10,'same horizontal spacing');
  assert.equal(framePeg(x,y+1,f).y-p.y,10,'same vertical spacing');
  const cell=frameCell(p.x,p.y,f);assert.ok(cell);assert.equal(frameIndex(cell.x,cell.y,f),y*g.cols+x,'touch maps to the visible peg');
  if(p.x<left&&p.y>top&&p.y<bottom)sideColumns.add(x);
 }
 if(width>=1700)assert.ok(sideColumns.size>=60,'wide sides have usable drawing resolution');
 // Fine coordinates retain positions on any display, and projected lines have no holes.
 for(let y=0;y<1024;y+=19)for(let x=0;x<1024;x+=17)if(inFrame(x,y)){
  const p=framePoint(x,y,f);assert.deepEqual(frameCell(p.x,p.y,f),{x,y});
 }
 const line=frameLine({x:0,y:512},{x:255,y:512});
 const columns=new Set(line.map(p=>frameIndex(p%1024,Math.floor(p/1024),f)).filter(p=>p!==null).map(p=>p%g.cols));
 assert.ok(columns.size>=Math.floor(left/10)-1,'shared side stroke fills the dense grid');
 assert.equal(frameCell((left+right)/2,(top+bottom)/2,f),null);
 assert.equal(frameCell(-1,10,f),null);assert.equal(frameCell(width,10,f),null);
}
console.log('PASS: uniform ten-pixel grid, real side resolution, continuous strokes, coordinate round trips, protected games from phone to 4K');
