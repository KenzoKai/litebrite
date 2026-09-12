import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=(await readFile(new URL('../app/game-frame-geometry.ts',import.meta.url),'utf8')).replace("import { COLS, ROWS } from './board-geometry';",'const COLS=56, ROWS=36;');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {frameCell,framePeg,inFrame}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
for(const [width,height,left,top,right,bottom] of [[678,660,90,80,588,580],[350,434,30,72,320,362],[280,364,24,72,256,292],[500,660,100,80,400,580]]){
 const f={width,height,left,top,right,bottom};
 for(let y=0;y<36;y++)for(let x=0;x<56;x++)if(inFrame(x,y)){
  const p=framePeg(x,y,f);assert.deepEqual(frameCell(p.x,p.y,f),{x,y},`cell ${x},${y} must round-trip at width ${width}`);assert.ok(Number.isFinite(p.r)&&p.r>0);
 }
 assert.equal(frameCell((left+right)/2,(top+bottom)/2,f),null,'game controls occupy a protected cutout');
 assert.equal(frameCell(-1,10,f),null);assert.equal(frameCell(width,10,f),null);
}
console.log('PASS: every drawable cell maps across phone/desktop rings; game cutouts and outside bounds reject drawing');
