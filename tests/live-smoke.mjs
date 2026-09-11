import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base=process.env.TEST_BASE_URL || 'http://localhost:5173/';
await mkdir('outputs',{recursive:true});
const browser=await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const errors=[];
const hostContext=await browser.newContext({viewport:{width:1440,height:1100}});
const guestContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const host=await hostContext.newPage(), guest=await guestContext.newPage();
for(const page of [host,guest])page.on('pageerror',e=>errors.push(e.message));
async function pixels(page){return page.locator('canvas').evaluate(c=>{const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<data.length;i+=4)if(data[i]>100 || data[i+1]>100 || data[i+2]>100)n++;return n;});}
async function draw(page){const r=await page.locator('canvas').boundingBox();await page.mouse.move(r.x+r.width*.25,r.y+r.height*.4);await page.mouse.down();await page.mouse.move(r.x+r.width*.5,r.y+r.height*.6,{steps:10});await page.mouse.up();}
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
  assert.equal(new URL(guest.url()).hash,'');
  console.log('PASS: two isolated browsers authenticate using a single-use fragment invitation');
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
  await third.getByText(/This invitation is used, expired/).waitFor({timeout:35000});
  assert.ok(await host.getByText('CONNECTED · JUST YOU TWO',{exact:true}).isVisible());
  await third.close();console.log('PASS: used invitation rejects a third browser');
  for(const page of [host,guest]){
    const storage=await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length,cookies:document.cookie}));
    assert.equal(storage.local,0);assert.equal(storage.session,0);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    assert.equal(overflow,false);
  }
  console.log('PASS: no browser storage and no desktop/phone horizontal overflow');
  await guest.getByRole('button',{name:'End connection',exact:true}).click();
  await host.getByText(/other person (ended|disconnected)/).waitFor({timeout:6000});
  assert.equal(await pixels(host),0);assert.equal(await pixels(guest),0);
  console.log('PASS: ending the session disconnects both sides and clears the board');
  assert.deepEqual(errors,[]);console.log('PASS: no browser runtime errors');
}catch(e){await host.screenshot({path:'outputs/failure-host.png'});await guest.screenshot({path:'outputs/failure-guest.png'});console.error(e);console.log('ERRORS:',errors);console.log('HOST:',(await host.locator('body').innerText()).slice(-1800));console.log('GUEST:',(await guest.locator('body').innerText()).slice(-1800));process.exitCode=1;}
finally{await browser.close();}
