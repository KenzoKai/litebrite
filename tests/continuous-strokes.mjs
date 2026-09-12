import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../app/connection.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {LightRoom}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const events={state(){},invite(){},stroke(){},clear(){},away(){}};
const room=new LightRoom(events);
const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
Object.assign(room,{key,identity:'sender',partner:'receiver',session:'test-session',joined:true,lastPresence:performance.now()});
const received=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function flush(){
 for(const raw of await room.makePackets()){
  const [iv,data]=raw.split('.');
  const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64url'),additionalData:Buffer.from('test-session:sender:receiver')},key,Buffer.from(data,'base64url'));
  received.push(JSON.parse(new TextDecoder().decode(bytes)));
 }
}
try{
 for(let second=0;second<8;second++){
  const first=received.length;
  for(let frame=0;frame<60;frame++){
   for(let sample=0;sample<4;sample++)room.draw({points:[frame*4+sample],color:3,ttl:1000});
   if(frame%6===5)await flush();
   await sleep(1000/60);
  }
  await flush();
  const strokes=received.slice(first).filter(m=>m.type==='stroke');
  assert.equal(new Set(strokes.flatMap(m=>m.points)).size,240,`second ${second+1}: every fresh cell must arrive`);
  assert.ok(strokes.length<=12);assert.ok(strokes.every(m=>m.points.length<=120&&m.ttl===1000));
 }
 console.log('PASS: all 1,920 high-frequency samples batched for HTTPS relay over eight seconds');
 room.draw({points:[1000],color:0,ttl:1000});room.blackout();await flush();
 assert.equal(received.at(-1).type,'clear');assert.ok(!received.some(m=>m.points?.includes(1000)));
 room.draw({points:[1001],color:0,ttl:1000});room.presence(true);await flush();
 assert.ok(!received.some(m=>m.points?.includes(1001)));
 room.presence(false);room.draw({points:[1002],color:0,ttl:1000});await sleep(350);await flush();
 assert.ok(!received.some(m=>m.points?.includes(1002)),'stalled input is discarded rather than replayed');
 room.draw({points:[1003],color:0,ttl:1000});room.destroy();assert.deepEqual(await room.makePackets(),[]);
 console.log('PASS: blackout, hiding, stale batches, and disconnect discard pending strokes');
}finally{room.destroy();}
