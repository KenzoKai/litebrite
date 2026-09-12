import assert from 'node:assert/strict';
import { COLS, ROWS, INITIAL_VIEW, fitScale, transform, cellAt, zoomAt, constrainView, lineCells } from '../app/board-geometry.ts';
for(const size of [{width:304,height:190},{width:374,height:520},{width:1420,height:680},{width:2540,height:1190}]){
  for(const zoom of [1,1.5,3,4]){
    const view=constrainView({...INITIAL_VIEW,zoom},size),t=transform(size,view);
    for(const [x,y] of [[0,0],[55,35],[28,18],[13,7]]){
      const px=t.left+(x+.5)*t.scale,py=t.top+(y+.5)*t.scale;
      assert.deepEqual(cellAt(px,py,size,view),{x,y});
    }
    assert.ok(Math.abs((COLS*t.scale)/(ROWS*t.scale)-COLS/ROWS)<1e-12);
  }
  const t=transform(size,INITIAL_VIEW);
  assert.equal(cellAt(t.left-1,t.top+1,size,INITIAL_VIEW),null);
  assert.equal(cellAt(t.left+1,t.top-1,size,INITIAL_VIEW),null);
  assert.ok(fitScale(size)>0);
}
const size={width:1000,height:700};
const v=zoomAt(2,500,350,size,INITIAL_VIEW);assert.equal(v.zoom,2);assert.equal(v.x,28);assert.equal(v.y,18);
const clamped=constrainView({zoom:100,x:-1000,y:9999},size);assert.equal(clamped.zoom,4);
assert.ok(clamped.x>=0 && clamped.y<=36);
const line=lineCells({x:0,y:0},{x:55,y:35});assert.equal(line.length,56);assert.equal(line[0],0);assert.equal(line.at(-1),2015);
console.log('PASS: proportional mapping, inverse touch mapping, bounds, zoom constraints, and interpolated strokes');
