import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
// Run the real transport with WebCrypto and a controllable data channel, without signaling.
const compile = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText).toString('base64');
const ice = compile(await readFile(new URL('../app/ice-config.ts', import.meta.url), 'utf8'));
const source = (await readFile(new URL('../app/connection.ts', import.meta.url), 'utf8')).replace("'./ice-config'", JSON.stringify(ice));
const { LightRoom } = await import(compile(source));
const events = { state() {}, invite() {}, stroke() {}, clear() {}, away() {} };
const room = new LightRoom(events);
const received = [];
const key = await crypto.subtle.generateKey({name:'AES-GCM',length:256}, false, ['encrypt','decrypt']);
const pending = [];
const c = {open:true,peer:'receiver',close(){},dataChannel:{bufferedAmount:0,send(raw){
  const [iv,data] = raw.split('.');
  pending.push(crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64url'),additionalData:Buffer.from('sender:receiver')},key,Buffer.from(data,'base64url')).then(bytes=>received.push(JSON.parse(new TextDecoder().decode(bytes)))));
}}};
Object.assign(room,{key,peer:{destroy(){}},identity:'sender',joined:true,active:c});
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
try {
  // Coalesced high-rate input: 240 unique cells per second for eight seconds.
  for(let second=0;second<8;second++) {
    const first=received.length;
    for(let frame=0;frame<60;frame++) {
      for(let sample=0;sample<4;sample++) room.draw({points:[frame*4+sample],color:3,ttl:1000});
      await sleep(1000/60);
    }
    await sleep(40);await Promise.all(pending);
    const strokes=received.slice(first).filter(m=>m.type==='stroke');
    const cells=new Set(strokes.flatMap(m=>m.points));
    assert.equal(cells.size,240,`second ${second+1}: every fresh cell must arrive during a sustained gesture`);
    assert.ok(strokes.length<=65,'batching must bound encrypted messages at high input rates');
    assert.ok(strokes.every(m=>m.points.length<=120 && m.ttl===1000));
  }
  console.log('PASS: all 1,920 high-frequency input samples arrive over eight seconds');
  room.draw({points:[1000],color:0,ttl:1000}); room.blackout();
  await sleep(50); await Promise.all(pending);
  assert.equal(received.at(-1).type,'clear','blackout must cancel any pending drawing');
  room.draw({points:[1001],color:0,ttl:1000}); room.presence(true);
  await sleep(50); await Promise.all(pending);
  assert.ok(!received.some(m=>m.points?.includes(1001)),'hidden pages must not flush pending strokes');
  room.presence(false);room.draw({points:[1002],color:0,ttl:1000}); room.destroy();
  await sleep(50);await Promise.all(pending);
  assert.ok(!received.some(m=>m.points?.includes(1002)),'disconnect must not replay queued drawing');
  console.log('PASS: blackout, hiding, and disconnect discard pending strokes');
} finally {room.destroy();}
