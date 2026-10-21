'use strict';
// Real Laravel HTTP + SQLite workflow. Only the physical camera and external CDN are replaced.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const root=path.resolve(__dirname,'../..');
let chromium;
try{({chromium}=require(process.env.B3_PLAYWRIGHT_MODULE||'playwright'));}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('real HTTP: scan once, cut 100/150/50, recover a lost committed response, finish and resume',{skip:!chromium,timeout:45000},async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'catday-cut-e2e-'));
  const database=path.join(temp,'workflow.sqlite');fs.writeFileSync(database,'');
  const compiled=path.join(temp,'compiled');fs.mkdirSync(compiled);
  const env={...process.env,APP_ENV:'local',APP_DEBUG:'false',APP_KEY:'base64:'+randomBytes(32).toString('base64'),
    DB_CONNECTION:'sqlite',DB_DATABASE:database,DB_URL:'',B3_E2E_DB:database,
    SESSION_DRIVER:'cookie',SESSION_COOKIE:'b3_e2e_session',SESSION_SECURE_COOKIE:'false',
    CACHE_STORE:'array',LOG_CHANNEL:'stderr',VIEW_COMPILED_PATH:compiled};
  const fixture=path.join(root,'tests/Support/continuous-cut-e2e.php');
  const php=mode=>{const r=spawnSync('php',[fixture,mode],{cwd:root,env,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr||r.stdout);return r.stdout;};
  let server,browser,serverOutput='';
  try{
    php('seed');
    const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
    const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
    env.APP_URL='http://127.0.0.1:'+port;
    server=spawn('php',['-S','127.0.0.1:'+port,path.join(root,'vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php')],
      {cwd:path.join(root,'public'),env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    server.stdout.on('data',chunk=>{serverOutput+=chunk;});server.stderr.on('data',chunk=>{serverOutput+=chunk;});
    let ready=false;
    for(let i=0;i<60;i++){try{const r=await fetch(env.APP_URL);if(r.ok){ready=true;break;}}catch{}await sleep(100);}
    assert.equal(ready,true,serverOutput);
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
    page.setDefaultTimeout(6000);
    const errors=[],posts=[];page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(request.method()==='POST'&&request.url().includes('/api/b3/'))posts.push({path:new URL(request.url()).pathname,payload:request.postDataJSON()});});
    await page.route('https://**/*',route=>route.fulfill({status:200,contentType:'text/css',body:'.d-none{display:none!important}.btn{padding:.5rem;border-radius:6px}.form-control,.form-select{width:100%;padding:.5rem}.form-check-input{width:1em;height:1em}.text-end{text-align:right}'}));
    await page.route(env.APP_URL+'/',async route=>{
      const response=await route.fetch();
      await route.fulfill({response,body:(await response.text()).replace(/\s+integrity="[^"]*"/g,'')});
    });
    await page.addInitScript(()=>{
      window.__e2eCameraOpens=0;window.__e2eConfirmations=0;
      document.addEventListener('DOMContentLoaded',()=>{
        new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.id==='b3-cut-settings-dialog')window.__e2eConfirmations++;}).observe(document.body,{childList:true});
        window.QrCameraModal=class{constructor(options){this.options=options;window.__e2eCamera=this;}async open(){this.isOpen=true;window.__e2eCameraOpens++;}async close(){this.isOpen=false;}};
      });
    });
    await page.goto(env.APP_URL);
    await page.locator('#login-username').fill('worker-e2e');await page.locator('#login-password').fill('E2e-only-Password');
    await page.locator('#login-form button[type=submit]').click();
    await page.locator('#app-screen').waitFor({state:'visible'});
    await page.locator('#plan-search').fill('KH-E2E');await page.locator('#plan-options .plan-option').click();
    await page.locator('#open-qr').click();
    const qr='cuontp;264772;500;E2E-REEL;extra';
    await page.evaluate(async raw=>{await window.__e2eCamera.close();await window.__e2eCamera.options.onResult(raw);},qr);
    await page.locator('#b3-end-value-input').fill('1000');await page.locator('#b3-direction-select').selectOption('1');await page.locator('#b3-cut-settings-confirm').click();
    for(const [i,detail] of [60,61,62].entries()){
      await page.locator('#b3-cut-detail-select').selectOption(String(detail));
      if(i===1){
        const loseResponse=async route=>{
          const response=await route.fetch();assert.equal(response.status(),200);
          await route.abort('failed');await page.unroute('**/api/b3/execute/cut',loseResponse);
        };
        await page.route('**/api/b3/execute/cut',loseResponse);
      }
      await page.locator('#b3-save-action').click();
      if(i===1){
        await page.locator('#b3-cut-recover').waitFor({state:'visible'});
        assert.equal(await page.locator('#b3-save-action').isDisabled(),true);
        await page.locator('#b3-cut-recover').click();
      }
      await page.waitForFunction(n=>window.B3State.cutSession?.cutsSaved===n&&!document.querySelector('#b3-save-action').disabled,i+1);
      assert.equal(await page.locator('#b3-current-start').textContent(),'500');
      assert.equal(await page.locator('#b3-current-end').textContent(),String([900,750,700][i]));
      assert.equal(await page.locator('#b3-remaining-length').textContent(),[400,250,200][i]+' m');
      assert.equal(await page.locator('#b3-cut-settings-dialog').count(),0);
    }
    const saved=JSON.parse(php('inspect'));
    assert.equal(saved.partials.length,1);assert.equal(saved.partials[0].SoDau,500);assert.equal(saved.partials[0].SoCuoi,700);
    assert.equal(saved.history.length,3);assert.deepEqual(saved.history.map(h=>h.LoaiNguon),['CUON_CHAN','CUON_LE','CUON_LE']);
    assert.deepEqual(saved.history.map(h=>h.SoCuoiSau),[900,750,700]);
    assert.equal(posts.filter(p=>p.path==='/api/b3/scan/resolve').length,1);
    const cuts=posts.filter(p=>p.path==='/api/b3/execute/cut');assert.equal(cuts.length,3);
    assert.equal(new Set(cuts.map(p=>p.payload.operation_token)).size,3);
    assert.equal(await page.evaluate(()=>window.__e2eCameraOpens),1);assert.equal(await page.evaluate(()=>window.__e2eConfirmations),1);
    const artifacts=path.join(root,'storage/app/verification');fs.mkdirSync(artifacts,{recursive:true});
    while(await page.locator('#app-alert-host .btn-close').count())await page.locator('#app-alert-host .btn-close').first().click();
    await page.locator('#app-alert-host .app-popup-alert').first().waitFor({state:'hidden',timeout:6500});
    await page.screenshot({path:path.join(artifacts,'b3-continuous-cut-real.png')});
    await page.locator('#b3-cancel-action').click();await page.locator('#b3-result-page').waitFor({state:'hidden'});
    await page.locator('#open-qr').click();
    await page.evaluate(async raw=>{await window.__e2eCamera.close();await window.__e2eCamera.options.onResult(raw);},qr);
    assert.equal(await page.locator('#b3-end-value-input').inputValue(),'700');
    await page.locator('#b3-cut-settings-confirm').click();await page.locator('#b3-save-action').click();
    await page.locator('#b3-result-page').waitFor({state:'hidden'});
    const final=JSON.parse(php('inspect'));
    assert.equal(final.history.length,4);assert.equal(final.partials.length,1);
    assert.equal(final.partials[0].SoCuoi,675);assert.equal(final.partials[0].TrangThai,'ACTIVE');
    assert.equal(await page.evaluate(()=>window.__e2eCameraOpens),2,'no auto camera even after final group cut');
    assert.deepEqual(errors,[]);
  }finally{
    if(browser)await browser.close();
    if(server&&!server.killed){server.kill();await new Promise(resolve=>{if(server.exitCode!==null)return resolve();server.once('exit',resolve);});}
    assert.equal(path.resolve(path.dirname(temp)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith('catday-cut-e2e-'));
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
