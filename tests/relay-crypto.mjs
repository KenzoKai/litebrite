import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const code=ts.transpileModule(await readFile(new URL('../app/connection.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {LightRoom}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const strokes=[];const events={state(){},invite(){},stroke(s){strokes.push(s)},clear(){},away(){}};
const a=new LightRoom(events), b=new LightRoom(events);
const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
Object.assign(a,{key,identity:'a',partner:'b',session:'session-one'});
Object.assign(b,{key,identity:'b',partner:'a',session:'session-one'});
try{
 await b.receive(await a.pack({type:'hello'}));assert.equal(b.joined,true);
 const stroke=await a.pack({type:'stroke',points:[123],color:2,ttl:2000});
 await b.receive(stroke);assert.equal(strokes.length,1);
 await b.receive(stroke);assert.equal(strokes.length,1,'same-session replay must be ignored');
 const [iv,data]=stroke.split('.'),changed=Buffer.from(data,'base64url');changed[0]^=1;
 await assert.rejects(b.receive(iv+'.'+changed.toString('base64url')));
 await b.receive(await a.pack({type:'stroke',points:[124],color:2,ttl:2000}),true);
 assert.equal(strokes.length,1,'resuming must discard packets queued while away');
 b.resetSession('session-two','a');await assert.rejects(b.receive(stroke));
 b.resetSession('session-one','someone-else');await assert.rejects(b.receive(stroke));
 b.resetSession('session-one','a');b.key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 await assert.rejects(b.receive(stroke));
 console.log('PASS: peer authentication, ciphertext integrity, replay rejection, session/direction binding, and hidden-stroke discard');
}finally{a.destroy();b.destroy();}
