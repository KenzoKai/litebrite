import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir('outputs',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5183/';
const contexts=await Promise.all([browser.newContext({viewport:{width:1280,height:900}}),browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true})]);
const pages=await Promise.all(contexts.map(c=>c.newPage()));const [desktop,phone]=pages;
const errors=[];pages.forEach(p=>p.on('pageerror',e=>errors.push(e.message)));
const mode=(p,name)=>p.getByRole('navigation',{name:'Board mode'}).getByRole('button',{name,exact:true});
try{
 await phone.goto(base);await phone.getByRole('button',{name:'Invite someone',exact:true}).waitFor();
 await desktop.goto(base);await desktop.getByRole('button',{name:'Invite someone',exact:true}).click();
 const invite=await desktop.locator('#invite-link').inputValue();await phone.goto(invite);
 for(const p of pages)await p.getByText('Shared play',{exact:true}).waitFor({timeout:40000});
 await mode(phone,'Chess').click();
 for(const p of pages)await p.getByRole('group',{name:'Chess board',exact:true}).waitFor();
 const white=(await desktop.locator('.game-instructions').innerText()).includes('Amber / White')?desktop:phone;
 const black=white===desktop?phone:desktop;
 await expect(black.locator('[data-square=e7]')).toBeDisabled();
 await white.locator('[data-square=e2]').click();await expect(white.locator('[data-square=e4]')).toHaveClass(/legal/);await white.locator('[data-square=e4]').click();
 for(const p of pages)await expect(p.locator('[data-square=e4]')).toHaveAccessibleName(/White pawn/);
 // Silently discard one packet-bearing request: the command/state retry must heal it.
 let dropped=false;
 await black.context().route('**/relay.php',async route=>{
  const data=route.request().postDataJSON();
  if(!dropped&&data?.packets?.length){dropped=true;await route.continue({postData:JSON.stringify({...data,packets:[]})});}else await route.continue();
 });
 await black.locator('[data-square=e7]').click();await black.locator('[data-square=e5]').click();
 for(const p of pages)await expect(p.locator('[data-square=e5]')).toHaveAccessibleName(/Black pawn/,{timeout:8000});
 await black.context().unroute('**/relay.php');assert.ok(dropped);
 await phone.screenshot({path:'outputs/games-chess-phone.png',fullPage:true});
 console.log('PASS: phone-started shared chess, assigned sides, legal moves, and packet-loss recovery');
 await mode(desktop,'Tic-tac-toe').click();
 for(const p of pages)await p.getByRole('group',{name:'Tic-tac-toe board'}).waitFor();
 for(const [p,n] of [[white,1],[black,4],[white,2],[black,5],[white,3]]) {
  await p.getByRole('button',{name:`Cell ${n} empty`,exact:true}).click();
  for(const other of pages)await expect(other.getByRole('button',{name:new RegExp(`^Cell ${n} [XO]$`)})).toBeVisible();
 }
 for(const p of pages)await expect(p.locator('.game-status')).toContainText('wins');
 await mode(phone,'Falling lights').click();
 for(const p of pages)await p.getByRole('button',{name:'Drop block',exact:true}).waitFor();
 await phone.getByRole('button',{name:'Drop block',exact:true}).click();
 for(const p of pages)await expect.poll(async()=>Number(await p.locator('.blocks-sidebar strong').first().innerText())).toBeGreaterThan(0);
 await desktop.getByRole('button',{name:'Pause blocks',exact:true}).click();
 for(const p of pages)await p.getByRole('button',{name:'Resume blocks',exact:true}).waitFor();
 await phone.screenshot({path:'outputs/games-blocks-phone.png',fullPage:true});
 await phone.getByRole('button',{name:'Resume blocks',exact:true}).click();
 for(const p of pages)await p.getByRole('button',{name:'Pause blocks',exact:true}).waitFor();
 await desktop.getByRole('button',{name:'Drop block',exact:true}).click();
 console.log('PASS: cooperative falling blocks accept both players, update scores, pause, and resume');
 await phone.getByRole('button',{name:'Clear game',exact:true}).click();
 for(const p of pages)await expect(mode(p,'Free drawing')).toHaveAttribute('aria-pressed','true');
 await phone.waitForTimeout(1500);
 for(const p of pages){await expect(mode(p,'Free drawing')).toHaveAttribute('aria-pressed','true');assert.equal(await p.evaluate(()=>localStorage.length+sessionStorage.length),0);}
 await mode(desktop,'Chess').click();await phone.getByRole('group',{name:'Chess board',exact:true}).waitFor();
 await desktop.getByRole('button',{name:'Leave room',exact:true}).click();
 for(const p of pages)await expect(mode(p,'Free drawing')).toHaveAttribute('aria-pressed','true');
 console.log('PASS: clearing and leaving remove games on both screens, with no browser storage');
 // Practice mode remains useful without a partner, including narrow and landscape screens.
 for(const [width,height] of [[320,568],[390,844],[844,390],[768,1024],[1440,900]]){
  await desktop.setViewportSize({width,height});
  for(const name of ['Chess','Tic-tac-toe','Falling lights','Free drawing']){
   await mode(desktop,name).click();
   assert.equal(await desktop.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} overflows ${width}x${height}`);
  }
 }
 console.log('PASS: all modes fit phone, tablet, desktop, and landscape widths');
 assert.deepEqual(errors,[]);
}catch(error){ console.log('GAME TEST STATUS',await Promise.all(pages.map(p=>p.locator('.game-status,.session-status,.mode-picker').allTextContents())),errors);throw error;}finally{await browser.close();}
