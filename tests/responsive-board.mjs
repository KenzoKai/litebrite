import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
await mkdir('outputs',{recursive:true});
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,headless:true});
const base=process.env.TEST_BASE_URL||'http://localhost:5173/';
const errors=[];
try {
  for(const [width,height,dpr] of [[320,568,1],[390,844,3],[768,1024,2],[844,390,3],[1024,768,1],[1440,900,2],[2560,1440,2]]){
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr,hasTouch:true});
    const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
    await p.goto(base);await p.getByRole('button',{name:'Invite someone',exact:true}).waitFor();
    await p.waitForFunction(()=>document.querySelector('canvas')?.width>1);
    await p.waitForTimeout(150);
    const metrics=await p.evaluate(()=>{
      const canvas=document.querySelector('canvas'),r=canvas.getBoundingClientRect();
      const buttons=[...document.querySelectorAll('.controls button,.view-controls button,.session-action button')];
      return {viewport:[innerWidth,innerHeight],overflow:document.documentElement.scrollWidth>innerWidth,
        pageHeight:document.documentElement.scrollHeight,canvas:[r.width,r.height],bitmap:[canvas.width,canvas.height],
        clipped:buttons.filter(b=>{const t=b.getBoundingClientRect();return t.x<0||t.right>innerWidth+.5||t.y<0||t.bottom>innerHeight+.5}).map(b=>b.getAttribute('aria-label')||b.textContent),
      };
    });
    assert.equal(metrics.overflow,false,`${width} horizontal overflow`);
    assert.ok(metrics.pageHeight<=height+1,`${width}x${height} page taller than viewport: ${metrics.pageHeight}`);
    assert.deepEqual(metrics.clipped,[],`${width} clipped controls`);
    assert.ok(metrics.canvas[1]>=100);
    assert.ok(metrics.bitmap[0]>=metrics.canvas[0]);
    await p.screenshot({path:`outputs/responsive-${width}x${height}.png`});
    console.log(`PASS: ${width}x${height} at ${dpr}x density fits board and all controls`);
    if(width===390){
      await p.getByRole('button',{name:'Zoom in',exact:true}).click();
      assert.equal(await p.getByLabel('Board zoom').innerText(),'150%');
      await p.getByRole('button',{name:'Move',exact:true}).click();
      const r=await p.locator('canvas').boundingBox();await p.mouse.move(r.x+r.width/2,r.y+r.height/2);await p.mouse.down();await p.mouse.move(r.x+r.width*.7,r.y+r.height*.6);await p.mouse.up();
      await p.setViewportSize({width:844,height:390});await p.getByRole('button',{name:'Fit',exact:true}).click();
      assert.equal(await p.getByLabel('Board zoom').innerText(),'100%');
      assert.equal(await p.getByRole('button',{name:'Draw',exact:true}).getAttribute('aria-pressed'),'true');
      await p.getByRole('button',{name:'How it stays private'}).click();
      const modal=await p.getByRole('dialog').boundingBox();assert.ok(modal.height<=390);assert.ok(modal.y>=0);
      await p.getByRole('button',{name:'Close',exact:true}).click();
      console.log('PASS: zoom, pan, rotate, Fit, and scrollable landscape dialog');
    }
    await context.close();
  }
  const p=await browser.newPage({viewport:{width:640,height:600}});await p.goto(base);
  await p.evaluate(()=>document.documentElement.style.fontSize='200%');
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);console.log('PASS: no runtime errors or overflow with enlarged root text');
} finally {await browser.close();}
