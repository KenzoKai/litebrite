import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
const endpoint=process.env.RELAY_TEST_URL || 'http://127.0.0.1:5184/relay.php';
const room=randomBytes(32).toString('hex');
const member=()=>({room,token:randomBytes(32).toString('hex'),id:randomBytes(16).toString('hex'),action:'poll'});
const a=member(),b=member(),c=member();
async function post(body,status=200){const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,status);return r.json();}
const packet=randomBytes(12).toString('base64url')+'.'+randomBytes(64).toString('base64url');
try{
 assert.equal((await (await fetch(endpoint)).json()).ready,true);
 await post({...a,room:[]},400);
 const denied=await fetch(endpoint,{method:'OPTIONS',headers:{Origin:'https://untrusted.example'}});assert.equal(denied.status,403);
 assert.equal((await post(a)).state,'waiting');
 const pair=await post(b);assert.equal(pair.state,'connected');assert.equal(pair.partner,a.id);
 assert.equal((await post(c)).state,'full');
 const joined=await post(a);assert.equal(joined.session,pair.session);
 await post({...a,session:pair.session,packets:[packet]});
 const delivery=await post({...b,session:pair.session});assert.deepEqual(delivery.packets,[packet]);
 assert.deepEqual((await post({...b,session:pair.session})).packets,[]);
 assert.ok(!JSON.stringify(delivery).includes(a.token),'never expose the other participant credential');
 await post({...a,id:c.id},403);
 await post({...a,session:pair.session,packets:[packet]});
 await new Promise(r=>setTimeout(r,850));
 assert.deepEqual((await post({...b,session:pair.session})).packets,[],'expired ciphertext is never delivered');
 await post({...a,action:'leave'});assert.equal((await post(a)).state,'left','late poll cannot reoccupy a departed seat');
 const replacement=await post(c);assert.equal(replacement.state,'connected');assert.notEqual(replacement.session,pair.session);
 assert.deepEqual((await post({...b,session:pair.session,packets:[packet]})).packets,[]);
 assert.deepEqual((await post({...c,session:replacement.session})).packets,[],'old session packets cannot reach a replacement');
 console.log('PASS: shared RAM, two-person limit, one-time delivery, ciphertext expiry, identity binding, and leave/rejoin isolation');
}finally{for(const client of [a,b,c])await post({...client,action:'leave'});}
