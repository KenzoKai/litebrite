import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const code=ts.transpileModule(await readFile(new URL('../app/connection.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {LightRoom}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const room=new LightRoom({state(){},invite(){},stroke(){},clear(){},away(){}});
const original={fetch:globalThis.fetch,performance:globalThis.performance,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
const session='a'.repeat(32),partner='b'.repeat(32);
Object.assign(room,{session,partner,joined:true});
let now=0,latency=250;
const delays=[];
try{
 globalThis.performance={now:()=>now};
 globalThis.setTimeout=(_fn,delay)=>{delays.push(delay);return 1;};
 globalThis.clearTimeout=()=>{};
 globalThis.fetch=async()=>{now+=latency;return {ok:true,json:async()=>({state:'connected',session,partner,packets:[]})};};
 await room.poll();
 assert.equal(delays.at(-1),0,'a slow response must not add another 100ms pause');
 delays.length=0;latency=20;
 await room.poll();
 assert.equal(delays.at(-1),80,'fast requests must retain the 100ms cadence and respect the server rate limit');
 console.log('PASS: immediate polling after slow responses and rate-safe pacing after fast responses');
}finally{room.destroy();Object.assign(globalThis,original);}
