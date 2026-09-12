import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
try {
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5183/');
  const canvas=page.locator('canvas');
  await canvas.waitFor();
  const r=await canvas.boundingBox(),scale=Math.min((r.width-16)/56,(r.height-16)/36);
  const point=(x,y,id=1)=>({x:r.x+r.width/2+(x+.5-28)*scale,y:r.y+r.height/2+(y+.5-18)*scale,id});
  const cdp=await context.newCDPSession(page);
  const lit=async(x,y)=>canvas.evaluate((c,{x,y})=>{
    const r=c.getBoundingClientRect(),scale=Math.min((r.width-16)/56,(r.height-16)/36);
    const d=c.getContext('2d').getImageData(Math.floor((r.width/2+(x+.5-28)*scale)*c.width/r.width),Math.floor((r.height/2+(y+.5-18)*scale)*c.height/r.height),1,1).data;
    return d[0]>120 || d[1]>120 || d[2]>120;
  },{x,y});
  // A brief second contact must not silence the original finger for its whole stroke.
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(8,18)]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(8,18),point(30,18,2)]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[point(30,18,2)]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(18,18)]});
  await page.waitForTimeout(100);
  assert.equal(await lit(18,18),true,'remaining finger must resume drawing after a second contact lifts');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.getByRole('button',{name:/Blackout/}).click();
  // Some mobile gesture paths cancel Pointer Events while Touch Events still continue.
  await page.evaluate(()=>{document.querySelector('canvas').addEventListener('pointerdown',e=>{window.testPointerId=e.pointerId;},{once:true});});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(8,18)]});
  await canvas.evaluate(c=>c.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerType:'touch',pointerId:window.testPointerId})));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(24,18)]});
  await page.waitForTimeout(100);
  assert.equal(await lit(24,18),true,'live touch must continue even if the duplicate pointer stream is canceled');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForTimeout(2200);
  assert.equal(await lit(24,18),false,'released touch still fades');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(20,18)]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(20,18),point(32,18,2)]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(15,18),point(37,18,2)]});
  assert.ok(parseInt(await page.getByLabel('Board zoom').textContent(),10)>100,'native touch must preserve pinch zoom');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.getByRole('button',{name:'Fit',exact:true}).click();
  assert.equal(await page.getByLabel('Board zoom').textContent(),'100%');
  console.log('PASS: remaining-finger recovery, pointer cancellation isolation, release fading, and pinch zoom');
}finally{await browser.close();}
