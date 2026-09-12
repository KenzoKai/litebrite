import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir('outputs',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
const contexts=await Promise.all([browser.newContext({viewport:{width:1920,height:1000}}),browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true})]);
const [a,b]=await Promise.all(contexts.map(c=>c.newPage())),pages=[a,b],errors=[];
pages.forEach(p=>p.on('pageerror',e=>errors.push(e.message)));
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5183/';
async function cells(page,points,draw=false){return page.locator('.frame-canvas canvas').evaluate((c,{points,draw})=>{
 const r=c.getBoundingClientRect(),g=c.closest('.game-stage').querySelector('.game-stage-center').getBoundingClientRect();
 const left=g.left-r.left,top=g.top-r.top,right=g.right-r.left,bottom=g.bottom-r.top;
 return points.map(([x,y])=>{
  // Test locations expressed in the old ring's convenient fractional regions.
  const nx=Math.floor(x<8?(x+.5)*256/8:x>=48?768+(x-48+.5)*256/8:256+(x-8+.5)*512/40)+.5;
  const ny=Math.floor(y<8?(y+.5)*128/8:y>=28?896+(y-28+.5)*128/8:128+(y-8+.5)*768/20)+.5;
  const rawX=nx<256?nx*left/256:nx>=768?right+(nx-768)*(r.width-right)/256:left+(nx-256)*(right-left)/512;
  const rawY=ny<128?ny*top/128:ny>=896?bottom+(ny-896)*(r.height-bottom)/128:top+(ny-128)*(bottom-top)/768;
  // Send exact normalized positions; inspect the nearest uniformly spaced peg.
  if(draw)return {x:r.left+rawX,y:r.top+rawY};
  const cols=Math.floor(r.width/10),rows=Math.floor(r.height/10),ox=(r.width-cols*10)/2,oy=(r.height-rows*10)/2;
  const px=ox+(Math.max(0,Math.min(cols-1,Math.floor((rawX-ox)/10)))+.5)*10;
  const py=oy+(Math.max(0,Math.min(rows-1,Math.floor((rawY-oy)/10)))+.5)*10;
  if(draw)return {x:r.left+px,y:r.top+py};
  const d=c.getContext('2d').getImageData(Math.max(0,Math.floor(px*c.width/r.width)-1),Math.max(0,Math.floor(py*c.height/r.height)-1),3,3).data;
  return [...d].some((v,i)=>i%4!==3&&v>120);
 });
},{points,draw});}
try{
 await b.goto(base);await b.getByRole('button',{name:'Invite someone',exact:true}).waitFor();
 await a.goto(base);await a.getByRole('button',{name:'Invite someone',exact:true}).click();const invite=await a.locator('#invite-link').inputValue();await b.goto(invite);
 for(const p of pages)await p.getByText('Shared play',{exact:true}).waitFor({timeout:40000});
 await a.getByRole('navigation',{name:'Board mode'}).getByRole('button',{name:'Chess',exact:true}).click();
 for(const p of pages){await p.locator('.frame-canvas canvas').waitFor();await p.getByRole('radio',{name:'Fade after 3 seconds',exact:true}).check();}
 for(const [sender,receiver] of [[a,b],[b,a]]){
  for(const point of [[28,4],[3,18],[52,18],[28,32]]){
   await sender.getByRole('button',{name:'Clear drawings',exact:true}).click();
   await expect.poll(()=>cells(receiver,[point])).toEqual([false]);
   await sender.locator('.frame-canvas canvas').scrollIntoViewIfNeeded();
   const [p]=await cells(sender,[point],true);
   if(sender===b)await sender.touchscreen.tap(p.x,p.y);else await sender.mouse.click(p.x,p.y);
   await expect.poll(()=>cells(receiver,[point]),{timeout:5000}).toEqual([true]);
  }
 }
 console.log('PASS: all four drawable margins map between desktop and phone, in both directions');
 // A short phone stroke across its left margin must fill the wider desktop margin.
 await b.getByRole('button',{name:'Clear drawings',exact:true}).click();
 await b.locator('.frame-canvas canvas').scrollIntoViewIfNeeded();
 const [sideStart,sideEnd]=await cells(b,[[0,18],[7,18]],true);
 const sideCDP=await contexts[1].newCDPSession(b);
 await sideCDP.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[sideStart]});
 for(let i=1;i<=12;i++){await sideCDP.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:sideStart.x+(sideEnd.x-sideStart.x)*i/12,y:sideStart.y}]});await b.waitForTimeout(20);}
 await sideCDP.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 const sideSamples=Array.from({length:61},(_,i)=>[0.1+i*6.8/60,18]);
 await expect.poll(async()=> {return (await cells(a,sideSamples)).filter(Boolean).length;},{timeout:3000}).toBe(61);
 await a.screenshot({path:'outputs/game-surround-desktop.png',fullPage:true});
 console.log('PASS: phone side stroke fills 61 desktop samples without gaps');

 // Hold a finger across updates, then make a chess move without resetting the ink.
 await b.getByRole('button',{name:'Clear drawings',exact:true}).click();await b.locator('.frame-canvas canvas').scrollIntoViewIfNeeded();
 const [start,end]=await cells(b,[[16,3],[40,5]],true);const cdp=await contexts[1].newCDPSession(b);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});
 for(let i=1;i<=30;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(end.x-start.x)*i/30,y:start.y+(end.y-start.y)*i/30}]});await b.waitForTimeout(20);}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect.poll(()=>cells(a,[[40,5]])).toEqual([true]);
 const white=(await a.locator('.game-instructions').first().innerText()).includes('Amber / White')?a:b;
 await white.locator('[data-square=e2]').click();await white.locator('[data-square=e4]').click();
 for(const p of pages)await expect(p.locator('[data-square=e4]')).toHaveAccessibleName(/White pawn/);
 assert.deepEqual(await cells(a,[[40,5]]),[true],'moving a piece must not erase drawings');
 await b.screenshot({path:'outputs/game-surround-phone.png',fullPage:true});
 await b.getByRole('button',{name:'Clear drawings',exact:true}).click();
 for(const p of pages){await expect.poll(()=>cells(p,[[40,5]])).toEqual([false]);await expect(p.locator('[data-square=e4]')).toHaveAccessibleName(/White pawn/);}
 console.log('PASS: sustained phone strokes, game clicks, and clearing ink preserve the game position');
 await b.locator('.frame-canvas canvas').scrollIntoViewIfNeeded();const [point]=await cells(b,[[28,4]],true);await b.touchscreen.tap(point.x,point.y);
 await expect.poll(()=>cells(a,[[28,4]])).toEqual([true]);await a.waitForTimeout(3400);assert.deepEqual(await cells(a,[[28,4]]),[false]);
 for(const name of ['Tic-tac-toe','Falling lights']){
  await a.getByRole('navigation',{name:'Board mode'}).getByRole('button',{name,exact:true}).click();await expect(b.getByRole('heading',{name,exact:true})).toBeVisible();
  for(const page of pages)assert.deepEqual(await cells(page,[[28,4]]),[false],'new rounds must not inherit previous drawings');
  await a.locator('.frame-canvas canvas').scrollIntoViewIfNeeded();const [p]=await cells(a,[[28,4]],true);await a.mouse.click(p.x,p.y);await expect.poll(()=>cells(b,[[28,4]])).toEqual([true]);
 }
 await b.getByRole('button',{name:'Pause blocks',exact:true}).click();for(const p of pages)await p.getByRole('button',{name:'Resume blocks',exact:true}).waitFor();
 const score=await b.locator('.blocks-sidebar strong').first().innerText();await b.locator('.frame-canvas canvas').focus();await b.keyboard.press('Space');assert.equal(await b.locator('.blocks-sidebar strong').first().innerText(),score,'drawing keyboard input must not control falling blocks');
 await b.keyboard.press('Escape');for(const p of pages)await expect(p.getByRole('navigation',{name:'Board mode'}).getByRole('button',{name:'Free drawing',exact:true})).toHaveAttribute('aria-pressed','true');
 console.log('PASS: fading, all game modes, separate keyboard input, and global blackout');
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
