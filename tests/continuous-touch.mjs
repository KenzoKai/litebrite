import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const lit = page => page.locator('canvas').evaluate(c => {
  const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
  for(let i=0;i<data.length;i+=4) if(data[i]>120 || data[i+1]>120 || data[i+2]>120) return true;
  return false;
});
try {
  const desktopContext=await browser.newContext({viewport:{width:1280,height:900},hasTouch:true});
  const phoneContext=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  const desktop=await desktopContext.newPage(), phone=await phoneContext.newPage();
  const errors=[]; for(const p of [desktop,phone]) p.on('pageerror',e=>errors.push(e.message));
  await desktop.goto(process.env.TEST_BASE_URL || 'http://localhost:5173/');
  await desktop.getByRole('button',{name:'Invite someone',exact:true}).click();
  await desktop.locator('#invite-link').waitFor();
  const invite=await desktop.locator('#invite-link').inputValue();
  await phone.goto(invite);
  for(const p of [desktop,phone]) await p.getByText('CONNECTED · JUST YOU TWO',{exact:true}).waitFor({timeout:40000});
  for(const [sender,receiver,context] of [[phone,desktop,phoneContext],[desktop,phone,desktopContext]]) {
    await sender.getByRole('radio',{name:'Fade after 1 second',exact:true}).check();
    const canvas=sender.locator('canvas'),r=await canvas.boundingBox(),cdp=await context.newCDPSession(sender);
    assert.equal(await canvas.evaluate(c=>{
      const event=new Event('touchmove',{bubbles:true,cancelable:true});c.dispatchEvent(event);return event.defaultPrevented;
    }),true,'canvas must reserve native touch movement');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+r.width*.25,y:r.y+r.height*.5}]});
    // Hold the same touch down for eight seconds, across several fade and heartbeat cycles.
    for(let second=0;second<8;second++) {
      for(let frame=0;frame<20;frame++) {
        const n=second*20+frame;
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:r.x+r.width*(.5+.25*Math.sin(n/10)),y:r.y+r.height*(.5+.15*Math.cos(n/10))}]});
        await sender.waitForTimeout(50);
      }
      assert.equal(await lit(receiver),true,`receiver must show fresh light at second ${second+1}`);
      assert.equal(await receiver.getByText('CONNECTED · JUST YOU TWO',{exact:true}).isVisible(),true);
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await sender.waitForTimeout(1300);
    assert.equal(await lit(sender),false);assert.equal(await lit(receiver),false);
    console.log(`PASS: eight-second uninterrupted ${sender===phone?'phone → desktop':'desktop → phone'} touch, then complete fade`);
    await cdp.detach();
  }
  assert.deepEqual(errors,[]);
}finally{await browser.close();}
