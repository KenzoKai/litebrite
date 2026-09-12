import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const code=ts.transpileModule(await readFile(new URL('../app/connection.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {LightRoom}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const events={state(){},invite(){},stroke(){},clear(){},away(){}};
const delivered=[];
const sender=new LightRoom(events), receiver=new LightRoom({...events,stroke:s=>delivered.push(s)});
const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
Object.assign(sender,{key,identity:'sender',partner:'receiver',session:'test',joined:true,lastPresence:performance.now()});
Object.assign(receiver,{key,identity:'receiver',partner:'sender',session:'test',joined:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function flush(){
 const packets=await sender.makePackets();
 assert.ok(packets.length<=8,'request must fit the relay packet budget');
 for(const packet of packets){assert.ok(packet.length<=5000);await receiver.receive(packet);}
 return packets;
}
try{
 const cells=Array.from({length:600},(_,i)=>i);
 sender.draw({points:cells,color:2,ttl:2000});
 await flush();
 assert.deepEqual(delivered.flatMap(s=>s.points),cells,'a fast gesture exceeding 120 cells must arrive in full');
 delivered.length=0;
 sender.draw({points:[700],color:1,ttl:1000});
 await sleep(380);
 sender.draw({points:[701],color:4,ttl:3000});
 await flush();
 assert.equal(delivered.find(s=>s.points.includes(700))?.color,1,'color changes must not erase unsent points');
 const old=delivered.find(s=>s.points.includes(700));
 assert.ok(old.ttl>0 && old.ttl<=650,'network batching must preserve remaining fade lifetime');
 assert.equal(delivered.find(s=>s.points.includes(701))?.color,4);
 delivered.length=0;
 const board=Array.from({length:2016},(_,i)=>i);
 sender.draw({points:board,color:3,ttl:3000});
 for(let i=0;i<4;i++)await flush();
 assert.equal(new Set(delivered.flatMap(s=>s.points)).size,2016,'overflow must drain on later requests without losing cells');
 delivered.length=0;
 sender.draw({points:[800],color:0,ttl:1000});await sleep(1050);await flush();
 assert.equal(delivered.length,0,'expired cells must not be replayed');
 sender.draw({points:board,color:0,ttl:3000});await flush();sender.blackout();delivered.length=0;
 await flush();assert.equal(delivered.length,0,'blackout must remove queued overflow');
 console.log('PASS: fast curves, delayed samples, color changes, bounded overflow, original fade deadlines, and blackout');
}finally{sender.destroy();receiver.destroy();}
