import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base=process.env.TEST_BASE_URL || 'http://localhost:5173/';
await mkdir('outputs',{recursive:true});
const browser=await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const errors=[];
const hostContext=await browser.newContext({viewport:{width:1440,height:1100}});
const guestContext=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
const host=await hostContext.newPage(), guest=await guestContext.newPage();
for(const page of [host,guest])page.on('pageerror',e=>errors.push(e.message));
async function pixels(page){return page.locator('canvas').evaluate(c=>{const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<data.length;i+=4)if(data[i]>100 || data[i+1]>100 || data[i+2]>100)n++;return n;});}
async function draw(page){const r=await page.locator('canvas').boundingBox();await page.mouse.move(r.x+r.width*.25,r.y+r.height*.4);await page.mouse.down();await page.mouse.move(r.x+r.width*.5,r.y+r.height*.6,{steps:10});await page.mouse.up();}
async function center(page,x,y,zoom=1){const r=await page.locator('canvas').boundingBox();const scale=Math.min((r.width-16)/56,(r.height-16)/36)*zoom;return {x:r.x+r.width/2+(x+.5-28)*scale,y:r.y+r.height/2+(y+.5-18)*scale};}
async function litCells(page,zoom=1){return page.locator('canvas').evaluate((c,zoom)=>{const r=c.getBoundingClientRect(),scale=Math.min((r.width-16)/56,(r.height-16)/36)*zoom;const ctx=c.getContext('2d');const out=[];for(let y=0;y<36;y++)for(let x=0;x<56;x++){const px=(r.width/2+(x+.5-28)*scale)*c.width/r.width,py=(r.height/2+(y+.5-18)*scale)*c.height/r.height;if(px<0||px>=c.width||py<0||py>=c.height)continue;const d=ctx.getImageData(Math.floor(px),Math.floor(py),1,1).data;if(d[0]>120||d[1]>120||d[2]>120)out.push(y*56+x);}return out;},zoom);}
try{
  await host.goto(base);
  await host.getByRole('button',{name:'Invite someone',exact:true}).click();
  await host.locator('#invite-link').waitFor({timeout:30000});
  const invite=await host.locator('#invite-link').inputValue();
  assert.match(invite,/#room=lb-/);
  await host.screenshot({path:'outputs/invitation-desktop.png'});
  await guest.goto(invite);
  await host.getByText('CONNECTED · JUST YOU TWO',{exact:true}).waitFor({timeout:40000});
  await guest.getByText('CONNECTED · JUST YOU TWO',{exact:true}).waitFor({timeout:10000});
  assert.equal(guest.url(),invite);assert.equal(host.url(),invite);
  console.log('PASS: two isolated browsers authenticate using a reusable fragment room link');
  const a=await center(host,12,10),b=await center(host,38,25);
  await host.mouse.move(a.x,a.y);await host.mouse.down();await host.mouse.move(b.x,b.y,{steps:12});await host.mouse.up();
  await guest.waitForTimeout(100);
  assert.deepEqual(await litCells(host),await litCells(guest),'both resolutions must light identical logical cells');
  console.log('PASS: desktop and 3x-density phone preserve identical stroke geometry');
  await host.getByRole('button',{name:/Blackout/}).click();await guest.waitForTimeout(100);
  await host.getByRole('button',{name:'Zoom in',exact:true}).click();
  const z=await center(host,30,15,1.5);await host.mouse.click(z.x,z.y);await guest.waitForTimeout(100);
  assert.deepEqual(await litCells(guest),[15*56+30]);
  await host.getByRole('button',{name:'Fit',exact:true}).click();
  await host.waitForTimeout(100);
  assert.deepEqual(await litCells(host),[15*56+30]);
  await host.getByRole('button',{name:/Blackout/}).click();await guest.waitForTimeout(100);
  console.log('PASS: drawing while zoomed reaches the same cell and Fit preserves it');
  await draw(host);
  await guest.waitForTimeout(250);
  assert.ok(await pixels(guest)>10,'remote must receive host strokes');
  await host.screenshot({path:'outputs/connected-desktop.png'});
  await guest.screenshot({path:'outputs/connected-phone.png'});
  await guest.waitForTimeout(3100);
  assert.equal(await pixels(host),0);assert.equal(await pixels(guest),0);
  console.log('PASS: strokes reach the other browser and fully disappear');
  const r=await guest.locator('canvas').boundingBox();
  await guest.touchscreen.tap(r.x+r.width*.5,r.y+r.height*.5);
  await host.waitForTimeout(200);
  assert.ok(await pixels(host)>0,'touch stroke must reach host');
  await host.getByRole('button',{name:/Blackout/}).click();
  await guest.waitForTimeout(200);
  assert.equal(await pixels(host),0);assert.equal(await pixels(guest),0);
  console.log('PASS: phone touch is transmitted and Blackout clears both boards');
  await draw(host);await host.keyboard.press('Escape');await guest.waitForTimeout(150);
  assert.equal(await pixels(host),0);assert.equal(await pixels(guest),0);
  console.log('PASS: Escape immediately clears both boards');
  const third=await browser.newPage();await third.goto(invite);
  await third.getByText(/This room already has two people/).waitFor({timeout:35000});
  assert.ok(await host.getByText('CONNECTED · JUST YOU TWO',{exact:true}).isVisible());
  await third.close();console.log('PASS: full room keeps a third browser out');
  for(const page of [host,guest]){
    const storage=await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length,cookies:document.cookie}));
    assert.equal(storage.local,0);assert.equal(storage.session,0);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    assert.equal(overflow,false);
  }
  console.log('PASS: no browser storage and no desktop/phone horizontal overflow');
  await guest.getByRole('button',{name:'Leave room',exact:true}).click();
  await host.getByText(/other person (left|disconnected)/).waitFor({timeout:6000});
  assert.equal(await pixels(host),0);assert.equal(await pixels(guest),0);
  console.log('PASS: leaving clears both boards while keeping the room link');
  await guest.getByRole('button',{name:'Rejoin room',exact:true}).click();
  await host.getByText('CONNECTED · JUST YOU TWO',{exact:true}).waitFor({timeout:45000});
  await guest.getByText('CONNECTED · JUST YOU TWO',{exact:true}).waitFor({timeout:15000});
  assert.equal(host.url(),invite);assert.equal(guest.url(),invite);
  console.log('PASS: explicit rejoin uses the same link');
  await host.reload();
  await host.getByText('CONNECTED · JUST YOU TWO',{exact:true}).waitFor({timeout:45000});
  await guest.getByText('CONNECTED · JUST YOU TWO',{exact:true}).waitFor({timeout:15000});
  await draw(host);await guest.waitForTimeout(150);assert.ok(await pixels(guest)>0);
  console.log('PASS: owner reload reconnects and transmits new strokes');
  await host.goto('about:blank');await guest.goto('about:blank');
  await guest.waitForTimeout(1500);
  // The original guest returns first, after both pages and all room state are gone.
  await guest.goto(invite);
  await guest.getByText('WAITING FOR YOUR PERSON',{exact:true}).waitFor({timeout:45000});
  await host.goto(invite);
  await guest.getByText('CONNECTED · JUST YOU TWO',{exact:true}).waitFor({timeout:45000});
  await host.getByText('CONNECTED · JUST YOU TWO',{exact:true}).waitFor({timeout:15000});
  assert.equal(await pixels(host),0);assert.equal(await pixels(guest),0);
  await draw(host);await guest.waitForTimeout(200);assert.ok(await pixels(guest)>0);
  console.log('PASS: both return with the same link in reverse order; no old drawings replay');
  await guestContext.setOffline(true);await guest.waitForTimeout(500);
  await guestContext.setOffline(false);
  await guest.getByText('CONNECTED · JUST YOU TWO',{exact:true}).waitFor({timeout:45000});
  await host.getByText('CONNECTED · JUST YOU TWO',{exact:true}).waitFor({timeout:15000});
  console.log('PASS: network recovery automatically rejoins the same room');
  assert.deepEqual(errors,[]);console.log('PASS: no browser runtime errors');
}catch(e){await host.screenshot({path:'outputs/failure-host.png'});await guest.screenshot({path:'outputs/failure-guest.png'});console.error(e);console.log('ERRORS:',errors);console.log('HOST:',(await host.locator('body').innerText()).slice(-1800));console.log('GUEST:',(await guest.locator('body').innerText()).slice(-1800));process.exitCode=1;}
finally{await browser.close();}
