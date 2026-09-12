import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const code=ts.transpileModule(await readFile(new URL('../app/connection.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {LightRoom}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const delivered=[];let resets=0;
const events={state(){},invite(){},stroke(){},clear(){},away(){},game:m=>delivered.push(m),gameReset:()=>resets++};
const a=new LightRoom(events),b=new LightRoom(events);
const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
Object.assign(a,{key,identity:'a',partner:'b',session:'s',joined:true,gamesSupported:true,lastPresence:performance.now()});
Object.assign(b,{key,identity:'b',partner:'a',session:'s',joined:true,gamesSupported:true,lastPresence:performance.now()});
try{
 a.sendGame({type:'snapshot',state:{mode:'chess'}});const packets=await a.makePackets();assert.equal(packets.length,1);
 assert.ok(!packets[0].includes('chess'));await b.receive(packets[0]);assert.equal(delivered.length,1);
 await b.receive(packets[0]);assert.equal(delivered.length,1,'encrypted replay rejected');
 b.blackout();
 a.sendGame({type:'snapshot',state:{mode:'chess'}});await b.receive((await a.makePackets())[0]);assert.equal(delivered.length,1,'late snapshot cannot restore a cleared game');
 // Even if the clear packet expires in transit, the next hello propagates its generation.
 await a.receive(await b.pack({type:'hello',games:1,generation:b.gameGeneration}));
 assert.equal(a.gameGeneration,b.gameGeneration);assert.ok(resets>=2);
 a.sendGame({type:'snapshot',state:{mode:'draw'}});await b.receive((await a.makePackets())[0]);assert.equal(delivered.at(-1).state.mode,'draw');
 const n=delivered.length;b.presence(true);
 await b.receive(await a.pack({type:'game',generation:b.gameGeneration,payload:{type:'snapshot',state:{mode:'chess'}}}));assert.equal(delivered.length,n,'hidden page discards game state');
 console.log('PASS: game encryption, replay rejection, blackout generation barrier, lost-clear recovery, and hidden-page discard');
}finally{a.destroy();b.destroy();}
