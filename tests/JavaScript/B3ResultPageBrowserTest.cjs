'use strict';
// Optional real Chromium coverage. No HTTP server, external API, camera, or database.
// B3 geometry uses production CSS; the CDN Bootstrap reset/utilities have a small
// deterministic stand-in, so screenshots are layout QA rather than pixel baselines.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
let chromium;
try{({chromium}=require(process.env.B3_PLAYWRIGHT_MODULE||'playwright'));}
catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
const baseCss=`html{font-size:16px;line-height:1.5}h1,h2,h3,h4,p{margin-top:0}button,input,select{font:inherit}button{cursor:pointer}.d-none{display:none!important}.btn{display:inline-block;padding:.375rem .75rem;border:1px solid transparent;border-radius:.375rem;text-align:center;line-height:1.5}.btn-primary{background:#0d6efd;color:#fff}.btn-outline-secondary{background:#fff;border-color:#6c757d;color:#6c757d}.form-control,.form-select{display:block;width:100%;padding:.375rem .75rem;border:1px solid #ced4da;border-radius:.375rem;background:#fff}.form-check-input{width:1em;height:1em;margin:0}.table{width:100%;border-collapse:collapse}.table td,.table th{padding:.5rem}.text-end{text-align:right}.row{display:flex;flex-wrap:wrap;gap:1rem}.col-12{width:100%}.w-100{width:100%}@media(min-width:768px){.col-md-7{width:58%}.col-md-5{flex:1}}`;
const blade=fs.readFileSync(path.join(root,'resources/views/welcome.blade.php'),'utf8')
  .replace(/\{\{--[\s\S]*?--\}\}/g,'').replace(/^\s*@[^\r\n]*/gm,'');
const html=`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${baseCss}</style><link rel="stylesheet" href="/css/cat-day/cat-day-ui.css"></head><body>${blade}<script src="/js/cat-day/b3-state.js"></script><script src="/mock.js"></script><script src="/js/cat-day/cat-day-ui.js"></script></body></html>`;
const mock=`
window.__calls={save:[],camera:0};
window.__plan={id:7,ma_ke_hoach:'KH-2026-007'};
window.__rows=Array.from({length:24},(_,i)=>({row_type:'FULL_CUT',completed:false,ma_ke_hoach:'KH-2026-007',ten_san_pham:'Dây điện CV 2.5',tinh_trang:'Chưa thực hiện',chieu_dai_lay:100,so_luong_cuon:1,lot:'LOT-007-'+i}));
window.__context={plan:window.__plan,item:{id:11,product_name:'Dây điện CV 2.5',standard_length:400,whole_required:2,whole_done:0,quy_cach_id:8},available_actions:['CUT_FULL_REEL'],groups:[{id:19,details:Array.from({length:18},(_,i)=>({id:100+i,ChieuDaiCanCat:100+i*10,done:0,selectable:true}))}]};
window.__source={source_type:'CUON_CHAN',raw_qr:'BIN-007-QR',ma_bin:'BIN-007',chieu:400};
window.B3Api={session:async()=>({user:{username:'tester',name:'Kiểm thử'}}),worklist:async()=>({rows:window.__rows}),allWorklist:async()=>({rows:window.__rows}),resolveQr:async(raw)=>({source:{...window.__source,raw_qr:raw},source_version:'initial-revision',selected_context:window.__context,candidate_contexts:[window.__context],operation_token:'test-token'}),takeWhole:async(payload)=>{window.__calls.save.push(payload);return {plan_complete:false};}};
window.B3Api.cut=async payload=>{
  window.__calls.save.push(payload);
  const group=window.__context.groups.find(g=>g.id===payload.group_id),detail=group.details.find(d=>d.id===payload.detail_id);
  const source=window.__source,partial=source.source_type==='CUON_LE'?source.partial:null;
  const length=partial?Math.abs(partial.SoCuoi-partial.SoDau):window.__context.item.standard_length;
  const end=payload.end_value??partial.SoCuoi,direction=payload.direction??(partial.SoDau<partial.SoCuoi?1:-1);
  const start=end-direction*length,after=end-direction*detail.ChieuDaiCanCat;detail.done=1;
  const next={source_type:'CUON_LE',raw_qr:payload.raw_qr,ton_cuon_le_id:91,partial:{id:91,SoDau:start,SoCuoi:after,TrangThai:'ACTIVE'}};
  return {success:true,plan_complete:false,cut_session:{source:next,source_version:'revision-'+window.__calls.save.length,
    context:{...window.__context,groups:[{...group,ton_cuon_le_id:91}],available_actions:['CUT_PARTIAL_REEL']},
    current_start:start,current_end:after,direction,remaining_length:Math.abs(after-start),active:true,
    operation_token:'next-'+window.__calls.save.length,operation_status:'SAVED',last_operation:{operation_token:payload.operation_token,detail_id:payload.detail_id,cut_length:detail.ChieuDaiCanCat}}};
};
window.__defaultCut=window.B3Api.cut;
window.QrCameraModal=class{constructor(options){this.options=options;this.isOpen=false;}async open(){this.isOpen=true;window.__calls.camera++;}async close(){this.isOpen=false;}};
`;
async function harness(browser,viewport){
  const page=await browser.newPage({viewport,reducedMotion:'reduce'});
  page.setDefaultTimeout(1500);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!=='http://b3.test')throw new Error('Unexpected external request: '+url.href);
    let body,contentType;
    if(url.pathname==='/'){body=html;contentType='text/html; charset=utf-8';}
    else if(url.pathname==='/mock.js'){body=mock;contentType='application/javascript; charset=utf-8';}
    else if(url.pathname==='/js/cat-day/cat-day-ui.js'){
      body=fs.readFileSync(path.join(root,'public',url.pathname),'utf8')
        .replace(/\}\)\(\);\s*$/,'window.__b3={selectPlan,resolveScan,go};})();');
      contentType='application/javascript; charset=utf-8';
    }else{
      const file=path.join(root,'public',url.pathname);
      if(!fs.existsSync(file)){await route.fulfill({status:404,body:''});return;}
      body=fs.readFileSync(file);contentType=url.pathname.endsWith('.css')?'text/css; charset=utf-8':'application/javascript; charset=utf-8';
    }
    await route.fulfill({status:200,contentType,body});
  });
  await page.goto('http://b3.test/');
  await page.waitForFunction(()=>window.B3State.user!==null);
  await page.evaluate(()=>window.__b3.selectPlan(window.__plan));
  return {page,errors};
}
async function scan(page){
  await page.evaluate(async()=>{
    await window.B3State.singleQrModal?.close();
    await window.__b3.resolveScan('BIN-007-QR');
  });
  await page.locator('#b3-cut-settings-dialog').waitFor({state:'visible'});
}
async function accept(page){await page.locator('#b3-end-value-input').fill('400');await page.locator('#b3-direction-select').selectOption('1');await page.locator('#b3-cut-settings-confirm').click();await page.locator('#b3-cut-settings-dialog').waitFor({state:'hidden'});}
async function screenshot(page,name){
  const dir=path.join(root,'storage/app/verification');fs.mkdirSync(dir,{recursive:true});
  await page.screenshot({path:path.join(dir,name),fullPage:false});
}
function closeTo(actual,expected,message){assert.ok(Math.abs(actual-expected)<=1,`${message}: ${actual} vs ${expected}`);}
function cleared(s){assert.equal(s.scan,null);assert.equal(s.context,null);assert.equal(s.action,null);assert.equal(s.groupId,null);assert.equal(s.detailId,null);assert.equal(s.endValue,'');assert.equal(s.cutParametersConfirmed,false);}

async function continuousHarness(page,{partial=false,reverse=false}={}){
  await page.evaluate(({partial,reverse})=>{
    window.__calls.confirmations=0;window.__calls.recover=0;
    new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.id==='b3-cut-settings-dialog')window.__calls.confirmations++;}).observe(document.body,{childList:true});
    window.__context.groups=[{id:19,ton_cuon_le_id:partial?70:null,details:[100,150,50,25].map((length,i)=>({id:100+i,ChieuDaiCanCat:length,done:0,selectable:true}))}];
    window.__context.item.standard_length=500;
    const start=reverse?1000:500;let end=reverse?500:1000;let revision=0;
    window.__source=partial?{source_type:'CUON_LE',raw_qr:'BIN-007-QR',ton_cuon_le_id:70,partial:{id:70,SoDau:start,SoCuoi:end,TrangThai:'ACTIVE'}}:{source_type:'CUON_CHAN',raw_qr:'BIN-007-QR',ma_bin:'264772',chieu_dai_1cuon:500};
    window.B3Api.resolveQr=async()=>({source:window.__source,source_version:'revision-'+revision,operation_token:'cut-token-'+revision,selected_context:window.__context,candidate_contexts:[window.__context]});
    window.__snapshot=(payload=null)=>({source:{source_type:'CUON_LE',raw_qr:'BIN-007-QR',ton_cuon_le_id:70,partial:{id:70,SoDau:start,SoCuoi:end,TrangThai:'ACTIVE'}},source_version:'revision-'+revision,operation_token:'cut-token-'+revision,context:{...window.__context,available_actions:['CUT_PARTIAL_REEL'],groups:[{...window.__context.groups[0],ton_cuon_le_id:70}]},current_start:start,current_end:end,direction:reverse?-1:1,remaining_length:Math.abs(end-start),active:window.__context.groups[0].details.some(d=>!d.done&&d.ChieuDaiCanCat<=Math.abs(end-start)),operation_status:payload?'SAVED':'NOT_FOUND',last_operation:payload?{id:revision,detail_id:payload.detail_id,operation_token:payload.operation_token,cut_length:window.__context.groups[0].details.find(d=>d.id===payload.detail_id).ChieuDaiCanCat}:null});
    window.__commit=payload=>{window.__calls.save.push(payload);const d=window.__context.groups[0].details.find(d=>d.id===payload.detail_id);end+=(reverse?1:-1)*d.ChieuDaiCanCat;d.done=1;revision++;window.__lastPayload=payload;window.__fresh=window.__snapshot(payload);return {success:true,plan_complete:false,cut_session:window.__fresh};};
    window.B3Api.cut=async payload=>window.__commit(payload);
    window.B3Api.cutSession=async()=>{window.__calls.recover++;return {success:true,cut_session:window.__fresh};};
  },{partial,reverse});
}

for(const mode of [{partial:false,reverse:false},{partial:true,reverse:false},{partial:false,reverse:true},{partial:true,reverse:true}]){
  test(`continuous cuts retain one confirmation, current DB markers and tokens ${JSON.stringify(mode)}`,{skip:!chromium,timeout:20000},async()=>{
    const browser=await chromium.launch({headless:true});
    try{
      const {page,errors}=await harness(browser,{width:390,height:844});
      await continuousHarness(page,mode);await scan(page);
      if(!mode.partial){await page.locator('#b3-end-value-input').fill(mode.reverse?'500':'1000');await page.locator('#b3-direction-select').selectOption(mode.reverse?'-1':'1');}
      await page.locator('#b3-cut-settings-confirm').click();
      assert.equal(await page.locator('#b3-continue-scan-label').isVisible(),false,'continuous QR control is hidden during a cut session');
      for(const [i,detail] of [100,101,102].entries()){
        await page.locator('#b3-cut-detail-select').selectOption(String(detail));
        await page.locator('#b3-save-action').click();
        await page.waitForFunction(n=>window.__calls.save.length===n,i+1);
        await page.waitForFunction(n=>window.B3State.cutSession?.cutsSaved===n,i+1);
        assert.equal(await page.locator('#b3-result-page').isVisible(),true);
        assert.equal(await page.locator('#b3-cut-settings-dialog').count(),0);
        assert.equal(await page.locator('#b3-current-end').textContent(),String((mode.reverse?[600,750,800]:[900,750,700])[i]));
        assert.equal(await page.locator('#b3-remaining-length').textContent(),[400,250,200][i]+' m');
      }
      assert.equal(await page.evaluate(()=>window.__calls.confirmations),1);
      assert.equal(await page.evaluate(()=>window.__calls.camera),0);
      const payloads=await page.evaluate(()=>window.__calls.save);
      assert.equal(new Set(payloads.map(p=>p.operation_token)).size,3);
      assert.deepEqual(payloads.map(p=>p.source_version),['revision-0','revision-1','revision-2']);
      assert.equal(payloads[1].end_value,undefined,'continuation uses backend markers without another rebase');
      assert.match(await page.locator('#b3-save-action').textContent(),/LƯU và TIẾP/i);
      await page.locator('#b3-cancel-action').click();
      assert.equal(await page.locator('#b3-result-page').isVisible(),false);
      assert.equal(await page.evaluate(()=>window.B3State.cutSession),null);
      assert.deepEqual(errors,[]);
    }finally{await browser.close();}
  });
}

for(const lost of ['after-commit','before-commit','ack-without-state']){
  test(`continuous cut recovers ${lost} without a second transaction or new retry token`,{skip:!chromium,timeout:20000},async()=>{
    const browser=await chromium.launch({headless:true});
    try{
      const {page,errors}=await harness(browser,{width:390,height:844});
      await continuousHarness(page);await scan(page);
      await page.locator('#b3-end-value-input').fill('1000');await page.locator('#b3-direction-select').selectOption('1');await page.locator('#b3-cut-settings-confirm').click();
      await page.evaluate(lost=>{
        window.B3Api.cut=async payload=>{
          window.__failedPayload=payload;
          if(lost!=='before-commit')window.__commit(payload);
          if(lost==='ack-without-state')return {success:true};
          throw new TypeError('Failed to fetch');
        };
        if(lost==='before-commit')window.B3Api.cutSession=async()=>({success:true,cut_session:{operation_status:'NOT_FOUND'}});
      },lost);
      await page.locator('#b3-save-action').click();
      await page.locator('#b3-cut-recover').waitFor({state:'visible'});
      assert.equal(await page.locator('#b3-save-action').isDisabled(),true);
      await page.locator('#b3-cut-recover').click();
      if(lost==='before-commit'){
        await page.locator('#b3-cut-retry').waitFor({state:'visible'});
        await page.evaluate(()=>{window.B3Api.cut=async payload=>window.__commit(payload);});
        await page.locator('#b3-cut-retry').click();
      }
      await page.waitForFunction(()=>window.B3State.cutSession?.cutsSaved===1&&!window.B3State.cutSession.blocked);
      assert.equal(await page.evaluate(()=>window.__calls.save.length),1);
      assert.equal(await page.locator('#b3-current-end').textContent(),'900');
      assert.equal(await page.locator('#b3-cut-settings-dialog').count(),0);
      assert.equal(await page.evaluate(()=>window.__calls.camera),0);
      const tokens=await page.evaluate(()=>({original:window.__failedPayload.operation_token,saved:window.__calls.save[0].operation_token}));
      assert.equal(tokens.original,tokens.saved);
      assert.deepEqual(errors,[]);
    }finally{await browser.close();}
  });
}

test('four consecutive cuts end only the selected group, preserve remainder, and never open camera',{skip:!chromium,timeout:15000},async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const {page,errors}=await harness(browser,{width:390,height:844});await continuousHarness(page);
    await page.locator('#continuous-scan').setChecked(true);await scan(page);
    await page.locator('#b3-end-value-input').fill('1000');await page.locator('#b3-direction-select').selectOption('1');await page.locator('#b3-cut-settings-confirm').click();
    for(const [i,detail] of [100,101,102,103].entries()){
      await page.locator('#b3-cut-detail-select').selectOption(String(detail));await page.locator('#b3-save-action').click();
      if(i<3)await page.waitForFunction(n=>window.B3State.cutSession?.cutsSaved===n,i+1);
    }
    await page.locator('#b3-result-page').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>window.__calls.save.length),4);
    assert.equal(await page.evaluate(()=>window.__fresh.remaining_length),175);
    assert.equal(await page.evaluate(()=>window.__calls.camera),0);
    assert.equal(await page.evaluate(()=>window.B3State.cutSession),null);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('repeated Save clicks while pending create one request and lock selection',{skip:!chromium,timeout:15000},async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const {page,errors}=await harness(browser,{width:390,height:844});await continuousHarness(page);await scan(page);
    await page.locator('#b3-end-value-input').fill('1000');await page.locator('#b3-direction-select').selectOption('1');await page.locator('#b3-cut-settings-confirm').click();
    await page.evaluate(()=>{window.__attempts=0;window.B3Api.cut=payload=>{window.__attempts++;return new Promise(resolve=>{window.__release=()=>resolve(window.__commit(payload));});};document.querySelector('#b3-save-action').click();document.querySelector('#b3-save-action').click();});
    assert.equal(await page.evaluate(()=>window.__attempts),1);
    assert.equal(await page.locator('#b3-save-action').isDisabled(),true);assert.equal(await page.locator('#b3-cut-detail-select').isDisabled(),true);
    await page.evaluate(()=>window.__release());await page.waitForFunction(()=>window.B3State.cutSession?.cutsSaved===1);
    assert.equal(await page.evaluate(()=>window.__calls.save.length),1);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('external source changes require an explicit refresh and keep one confirmation',{skip:!chromium,timeout:15000},async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const {page,errors}=await harness(browser,{width:390,height:844});await continuousHarness(page);await scan(page);
    await page.locator('#b3-end-value-input').fill('1000');await page.locator('#b3-direction-select').selectOption('1');await page.locator('#b3-cut-settings-confirm').click();
    await page.evaluate(()=>{
      window.B3Api.cut=async()=>{const e=new Error('Thông số cuộn đã thay đổi.');e.status=409;e.code='SOURCE_STATE_CHANGED';throw e;};
      window.B3Api.cutSession=async()=>{const fresh=window.__snapshot();fresh.current_end=950;fresh.remaining_length=450;fresh.source.partial.SoCuoi=950;fresh.source_version='external-revision';fresh.operation_token='external-next-token';return {success:true,cut_session:fresh};};
    });
    await page.locator('#b3-save-action').click();await page.locator('#b3-cut-recover').waitFor({state:'visible'});
    assert.equal(await page.locator('#b3-save-action').isDisabled(),true);
    await page.locator('#b3-cut-recover').click();await page.waitForFunction(()=>!window.B3State.cutSession.blocked);
    assert.equal(await page.locator('#b3-current-end').textContent(),'950');assert.equal(await page.locator('#b3-remaining-length').textContent(),'450 m');
    assert.equal(await page.evaluate(()=>window.B3State.cutSession.cutsSaved),0);
    assert.equal(await page.evaluate(()=>window.__calls.confirmations),1);assert.equal(await page.evaluate(()=>window.__calls.save.length),0);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('an uncertain cut cannot escape to another matching plan or discard its token',{skip:!chromium,timeout:15000},async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const {page,errors}=await harness(browser,{width:390,height:844});await continuousHarness(page);
    await page.evaluate(()=>{
      window.B3Api.resolveQr=async()=>({source:window.__source,source_version:'revision-0',operation_token:'original-token',
        selected_context:window.__context,candidate_contexts:[window.__context,{...window.__context,plan:{id:8,ma_ke_hoach:'OTHER'}}]});
      window.B3Api.cut=async()=>{throw new TypeError('Failed to fetch');};
    });
    await scan(page);await page.locator('#b3-end-value-input').fill('1000');await page.locator('#b3-direction-select').selectOption('1');await page.locator('#b3-cut-settings-confirm').click();
    await page.locator('#b3-save-action').click();await page.locator('#b3-cut-recover').waitFor({state:'visible'});
    await page.locator('.b3-plan-details summary').click();
    const selector=page.locator('#b3-plan-select');
    if(await selector.count())assert.equal(await selector.isDisabled(),true,'active context must be locked even after a failed request');
    assert.equal(await page.evaluate(()=>window.B3State.cutSession.pending.payload.operation_token),'original-token');
    assert.equal(await page.evaluate(()=>window.B3State.cutSession.planId),7);
    await page.locator('#b3-cancel-action').click();
    assert.equal(await page.locator('#b3-result-page').isVisible(),true,'uncertain transaction cannot be silently discarded');
    assert.equal(await page.evaluate(()=>window.__calls.confirmations),1);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

for(const scenario of [{count:2,selected:false},{count:2,selected:true},{count:1,selected:false}]){
  test(`plan scope stays expanded whenever a plan selector is needed ${JSON.stringify(scenario)}`,{skip:!chromium,timeout:15000},async()=>{
    const browser=await chromium.launch({headless:true});
    try{
      const {page,errors}=await harness(browser,{width:390,height:844});
      await page.evaluate(async({count,selected})=>{
        window.__context.available_actions=['TAKE_WHOLE_REEL'];
        window.__scopeContexts=Array.from({length:count},(_,i)=>({...window.__context,plan:{id:7+i,ma_ke_hoach:'KH-CHOICE-'+i}}));
        window.B3Api.resolveQr=async()=>({source:window.__source,operation_token:'choice-token',selected_context:selected?window.__scopeContexts[0]:null,candidate_contexts:window.__scopeContexts});
        await window.__b3.resolveScan('BIN-007-QR');
      },scenario);
      const details=page.locator('.b3-plan-details'),summary=details.locator('summary');
      assert.equal(await details.evaluate(n=>n.open),true,'required plan choice is immediately expanded');
      assert.equal(await page.locator('#b3-plan-select').isVisible(),true);
      if(!scenario.selected){
        const warning=page.locator('#b3-tab-content .alert.alert-danger');
        assert.equal(await warning.textContent(),'Vui lòng chọn phạm vi kế hoạch để tiếp tục.');
        assert.equal(await warning.getAttribute('role'),'alert');
        assert.equal(await page.locator('#b3-save-action').isDisabled(),true);
      }
      await summary.click();assert.equal(await details.evaluate(n=>n.open),true,'mouse cannot conceal a required selector');
      await summary.focus();await page.keyboard.press('Enter');assert.equal(await details.evaluate(n=>n.open),true,'keyboard cannot conceal a required selector');
      const choice=String(scenario.count-1);await page.locator('#b3-plan-select').selectOption(choice);
      assert.equal(await page.evaluate(()=>window.B3State.context.plan.id),7+Number(choice));
      assert.equal(await page.locator('#b3-save-action').isDisabled(),false);
      assert.equal(await page.locator('#b3-tab-content .alert-danger').count(),0,'warning disappears after selection');
      assert.equal(await details.evaluate(n=>n.open),scenario.count>1,'multiple matching plans remain expanded; a resolved single choice may collapse');
      await page.locator('#b3-cancel-action').click();await page.waitForFunction(()=>!window.history.state?.b3ResultPage);
      await page.evaluate(async()=>{
        window.B3Api.resolveQr=async()=>({source:window.__source,selected_context:window.__context,candidate_contexts:[window.__context],operation_token:'single-token'});
        await window.__b3.resolveScan('BIN-007-QR');
      });
      assert.equal(await details.evaluate(n=>n.open),false,'a later scan without a choice starts collapsed');
      await summary.click();assert.equal(await details.evaluate(n=>n.open),true,'single-plan information can still be opened manually');
      await summary.click();assert.equal(await details.evaluate(n=>n.open),false,'single-plan information can still be collapsed manually');
      assert.deepEqual(errors,[]);
    }finally{await browser.close();}
  });
}

test('mixed whole and cut actions require a choice before opening cut confirmation',{skip:!chromium,timeout:15000},async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const {page,errors}=await harness(browser,{width:390,height:844});await continuousHarness(page);
    await page.evaluate(async()=>{window.__context.available_actions=['TAKE_WHOLE_REEL','CUT_FULL_REEL'];await window.__b3.resolveScan('BIN-007-QR');});
    assert.equal(await page.locator('#b3-tab-whole').isVisible(),true);assert.equal(await page.locator('#b3-tab-cut').isVisible(),true);
    assert.equal(await page.locator('#b3-cut-settings-dialog').count(),0);assert.equal(await page.locator('#b3-save-action').isDisabled(),true);
    const warning=page.locator('#b3-tab-content .alert.alert-warning');
    assert.equal(await warning.textContent(),'Cần chọn LẤY NGUYÊN CUỘN hoặc CHỌN CẮT LẺ trước');
    assert.equal(await warning.getAttribute('role'),'alert');
    await page.locator('#b3-tab-whole').click();assert.equal(await page.locator('#b3-save-action').isDisabled(),false);
    assert.equal(await page.locator('#b3-tab-content .alert-warning').count(),0,'operation warning disappears after choosing');
    assert.equal(await page.evaluate(()=>window.B3State.cutSession),null);
    await page.locator('#b3-tab-cut').click();await page.locator('#b3-cut-settings-dialog').waitFor({state:'visible'});
    await page.locator('#b3-end-value-input').fill('1000');await page.locator('#b3-direction-select').selectOption('1');await page.locator('#b3-cut-settings-confirm').click();
    assert.equal(await page.locator('#b3-tab-whole').isVisible(),false);
    assert.equal(await page.evaluate(()=>window.__calls.confirmations),1);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

for(const stage of ['scan','save']){
  test(`ambiguous QR shows a blocking messagebox during ${stage}`,{skip:!chromium,timeout:20000},async()=>{
    const browser=await chromium.launch({headless:true});
    try{
      const {page,errors}=await harness(browser,{width:390,height:844});
      if(stage==='save'){await scan(page);await accept(page);}
      await page.evaluate(stage=>{
        const fail=async()=>{const error=new Error('Mã “264772” đang khớp với nhiều sản phẩm khác nhau. Vui lòng kiểm tra lại mã QR hoặc dữ liệu MaBin.');error.code='QR_PRODUCT_AMBIGUOUS';throw error;};
        if(stage==='scan')window.B3Api.resolveQr=fail;else window.B3Api.cut=fail;
      },stage);
      if(stage==='scan')await page.evaluate(()=>window.__b3.resolveScan('cuontp;264772;200;TEM;extra'));
      else await page.locator('#b3-save-action').click();
      const dialog=page.locator('#b3-qr-error-dialog');
      await dialog.waitFor({state:'visible'});
      assert.equal(await dialog.getAttribute('role'),'alertdialog');
      assert.equal(await dialog.getAttribute('aria-modal'),'true');
      assert.equal(await dialog.locator('h2').textContent(),'Không xác định được duy nhất sản phẩm');
      assert.match(await dialog.textContent(),/Mã “264772” đang khớp với nhiều sản phẩm khác nhau/);
      assert.equal(await dialog.locator('button').textContent(),'Đóng');
      assert.equal(await page.locator('#app-screen').evaluate(n=>n.inert),true);
      if(stage==='save')assert.equal(await page.locator('#b3-result-page').evaluate(n=>n.inert),true);
      assert.equal(await dialog.locator('button').evaluate(n=>n===document.activeElement),true);
      const geometry=await dialog.locator('section').boundingBox();
      assert.ok(geometry.x>=0&&geometry.x+geometry.width<=390,'message fits phone width');
      assert.ok(geometry.y>=0&&geometry.y+geometry.height<=844,'message fits phone height');
      if(stage==='scan')await screenshot(page,'b3-qr-ambiguous-product.png');
      await page.keyboard.press('Tab');
      assert.equal(await dialog.locator('button').evaluate(n=>n===document.activeElement),true);
      assert.equal(await page.evaluate(()=>window.__calls.save.length),0);
      if(stage==='scan')await dialog.locator('button').click();else await page.keyboard.press('Escape');
      await dialog.waitFor({state:'hidden'});
      const background=stage==='scan'?'#app-screen':'#b3-result-page';
      assert.equal(await page.locator(background).evaluate(n=>n.inert),false);
      assert.deepEqual(errors,[]);
    }finally{await browser.close();}
  });
}

for(const viewport of [{width:390,height:844},{width:1366,height:900}]){
  test(`result page geometry, decision, focus and navigation in Chromium ${viewport.width}x${viewport.height}`,{skip:!chromium,timeout:20000},async()=>{
    const browser=await chromium.launch({headless:true});
    try{
      const {page,errors}=await harness(browser,viewport);
      await page.evaluate(()=>{window.__b3.go(2);document.querySelector('#table-scroll').scrollLeft=120;window.scrollTo(0,200);});
      const list=await page.evaluate(()=>({y:window.scrollY,x:document.querySelector('#table-scroll').scrollLeft,rows:document.querySelector('#plan-table-body').textContent}));
      await scan(page);
      const decision=page.locator('#b3-cut-settings-dialog');
      assert.equal(await decision.getAttribute('role'),'dialog');
      assert.equal(await page.locator('#b3-first-cut-decision-overlay').count(),0,'old decision box is replaced');
      assert.equal(await decision.getAttribute('aria-modal'),'true');
      const modal=await page.evaluate(()=>{
        const overlay=document.querySelector('#b3-cut-settings-dialog'),box=overlay.getBoundingClientRect();
        return {inert:document.querySelector('#b3-result-page').inert,appInert:document.querySelector('#app-screen').inert,background:getComputedStyle(overlay).backgroundColor,opacity:getComputedStyle(overlay).opacity,x:box.x,y:box.y,w:box.width,h:box.height,focus:document.activeElement.id};
      });
      assert.equal(modal.inert,true);assert.equal(modal.appInert,true);assert.notEqual(modal.background,'rgba(0, 0, 0, 0)');assert.equal(modal.opacity,'1');
      closeTo(modal.x,0,'overlay left');closeTo(modal.y,0,'overlay top');closeTo(modal.w,viewport.width,'overlay width');closeTo(modal.h,viewport.height,'overlay height');
      const focusable=await decision.locator('button,input,select').evaluateAll(nodes=>nodes.filter(n=>!n.disabled).map(n=>n.id));
      assert.ok(focusable.includes(modal.focus),'dialog receives initial focus');
      await page.locator('#'+focusable[0]).focus();
      await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),focusable.at(-1));
      await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),focusable[0]);
      await page.evaluate(()=>document.querySelector('#b3-save-action').focus());
      assert.equal(await page.evaluate(()=>!!document.activeElement.closest('#b3-cut-settings-dialog')),true);
      const input=page.locator('#b3-end-value-input');
      await input.focus();await page.evaluate(()=>{window.__input=document.querySelector('#b3-end-value-input');});
      await input.pressSequentially('400');
      assert.equal(await input.inputValue(),'400');
      assert.equal(await page.evaluate(()=>document.activeElement===window.__input&&window.__input===document.querySelector('#b3-end-value-input')),true);
      await page.locator('#b3-direction-select').selectOption('1');
      if(viewport.width===390)await screenshot(page,'b3-result-mobile-confirmation.png');
      await page.locator('#b3-cut-settings-confirm').click();await decision.waitFor({state:'hidden'});
      assert.equal(await page.locator('.b3-result-scroll #b3-end-value-input,.b3-result-scroll #b3-direction-select').count(),0,'parameters are editable only inside dialog');
      assert.equal(await page.locator('#b3-after-cut-value').textContent(),'300');
      const valueSize=await page.locator('#b3-after-cut-value').evaluate(n=>parseFloat(getComputedStyle(n).fontSize));
      assert.ok(valueSize>=48,'preview is prominent');
      assert.equal(await page.evaluate(()=>window.__calls.save.length),0,'confirm has no API write');
      const planDetails=page.locator('.b3-plan-details');
      assert.equal(await page.locator('#b3-plan-scope').isVisible(),false,'plan information starts collapsed');
      await planDetails.locator('summary').click();
      assert.equal(await page.locator('#b3-plan-scope').isVisible(),true,'click reveals plan information');
      assert.equal(await page.locator('#b3-reel-code').textContent(),'BIN-007');
      // Leave it open: the next scan must independently start collapsed.
      const box=await page.locator('#b3-result-page').boundingBox();
      closeTo(box.x,0,'page left');closeTo(box.y,0,'page top');closeTo(box.width,viewport.width,'page width');closeTo(box.height,viewport.height,'page height');
      const footerBefore=await page.locator('.b3-result-footer').boundingBox();
      closeTo(footerBefore.y+footerBefore.height,viewport.height,'footer bottom');
      assert.ok(footerBefore.y>0);
      const scroll=await page.evaluate(()=>{const s=document.querySelector('.b3-result-scroll');s.scrollTop=s.scrollHeight;return {top:s.scrollTop,height:s.clientHeight,total:s.scrollHeight};});
      if(scroll.total>scroll.height)assert.ok(scroll.top>0,'overflowing content must scroll');
      else assert.equal(scroll.top,0,'compact content fits without extra scrolling');
      const footerAfter=await page.locator('.b3-result-footer').boundingBox();
      closeTo(footerAfter.y,footerBefore.y,'footer stays fixed while content scrolls');
      for(const id of ['b3-cancel-action','b3-save-action']){const action=await page.locator('#'+id).boundingBox();assert.ok(action.y>=footerAfter.y&&action.y+action.height<=viewport.height+1,id+' stays visible');}
      if(viewport.width===390){
        await planDetails.locator('summary').click();
        await page.evaluate(()=>{document.querySelector('.b3-result-scroll').scrollTop=0;});
        await screenshot(page,'b3-result-mobile.png');
        await planDetails.locator('summary').click();
      }
      await page.locator('#b3-cancel-action').click();
      await page.waitForFunction(()=>!window.history.state?.b3ResultPage);
      cleared(await page.evaluate(()=>window.B3State));
      const restored=await page.evaluate(()=>({y:window.scrollY,x:document.querySelector('#table-scroll').scrollLeft,rows:document.querySelector('#plan-table-body').textContent,page:window.B3State.page,plan:window.B3State.selectedPlan.id}));
      closeTo(restored.y,list.y,'list vertical scroll restored');closeTo(restored.x,list.x,'table horizontal scroll restored');assert.equal(restored.rows,list.rows);assert.equal(restored.page,2);assert.equal(restored.plan,7);
      await scan(page);await accept(page);
      assert.equal(await page.locator('#b3-plan-scope').isVisible(),false,'each new scan resets the collapsed state');
      await page.goBack();await page.locator('#b3-result-page').waitFor({state:'hidden'});
      cleared(await page.evaluate(()=>window.B3State));assert.equal(await page.locator('#plan-search').inputValue(),'KH-2026-007');
      await page.goForward();assert.equal(await page.locator('#b3-result-page').isVisible(),false);cleared(await page.evaluate(()=>window.B3State));
      // Forward cannot revive a discarded draft or leave a marker that swallows
      // Back after the next scan.
      await scan(page);await accept(page);await page.goBack();
      assert.equal(await page.locator('#b3-result-page').isVisible(),false,'Back after Forward + rescan must discard the fresh draft');
      cleared(await page.evaluate(()=>window.B3State));
      await scan(page);await page.keyboard.press('Escape');
      await page.waitForFunction(()=>window.__calls.camera===1&&!window.B3State.scan);
      assert.equal(await decision.count(),0);assert.equal(await page.locator('#b3-result-page').isVisible(),false);
      await scan(page);await accept(page);
      await page.evaluate(()=>window.dispatchEvent(new CustomEvent('b3:session-expired',{detail:{message:'Phiên đã hết'}})));
      await page.locator('#login-screen').waitFor({state:'visible'});
      const expired=await page.evaluate(()=>window.B3State);cleared(expired);assert.equal(expired.user,null);assert.equal(expired.selectedPlan,null);assert.deepEqual(expired.worklist,[]);
      await page.reload();await page.waitForFunction(()=>window.B3State.user!==null);
      await page.evaluate(()=>window.__b3.selectPlan(window.__plan));
      await scan(page);await accept(page);
      assert.equal(await page.evaluate(()=>!!history.state?.b3ResultPage),true);
      await page.reload();await page.waitForFunction(()=>window.B3State.user!==null);
      assert.equal(await page.locator('#b3-result-page').isVisible(),false);cleared(await page.evaluate(()=>window.B3State));assert.equal(await page.evaluate(()=>!!history.state?.b3ResultPage),false);
      assert.equal(await page.evaluate(()=>window.B3State.selectedPlan),null);
      assert.deepEqual(errors,[]);
    }finally{await browser.close();}
  });
}

test('whole-reel result checkbox still determines continuous scanning after save in real DOM',{skip:!chromium,timeout:20000},async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const {page,errors}=await harness(browser,{width:390,height:844});
    await page.evaluate(()=>{window.__context.available_actions=['TAKE_WHOLE_REEL'];});
    for(const continueScanning of [false,true]){
      await page.locator('#continuous-scan').setChecked(!continueScanning);
      await page.evaluate(()=>window.__b3.resolveScan('BIN-007-QR'));
      await page.locator('#b3-result-page').waitFor({state:'visible'});
      await page.locator('#b3-continue-scan').setChecked(continueScanning);
      await page.locator('#b3-save-action').click();
      await page.locator('#b3-result-page').waitFor({state:'hidden'});
      await page.waitForFunction(()=>window.B3State.worklistReady);
      if(continueScanning)await page.waitForFunction(()=>window.__calls.camera===1);
      else{assert.equal(await page.evaluate(()=>window.__calls.camera),0);}
      assert.equal(await page.locator('#continuous-scan').isChecked(),continueScanning);
      cleared(await page.evaluate(()=>window.B3State));
    }
    const calls=await page.evaluate(()=>window.__calls);
    assert.equal(calls.save.length,2);assert.equal(calls.save[0].end_value,undefined);assert.equal(calls.save[1].end_value,undefined);assert.equal(calls.camera,1);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('full reel settings require both values and update label follows differences',{skip:!chromium,timeout:10000},async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const {page,errors}=await harness(browser,{width:390,height:844});await scan(page);
    const end=page.locator('#b3-end-value-input'),direction=page.locator('#b3-direction-select'),confirm=page.locator('#b3-cut-settings-confirm');
    assert.equal(await end.inputValue(),'');assert.equal(await direction.inputValue(),'');assert.equal(await confirm.textContent(),'Xác nhận');
    await page.evaluate(()=>{
      Object.defineProperty(window.visualViewport,'height',{value:420,configurable:true});
      window.visualViewport.dispatchEvent(new Event('resize'));
    });
    const visibleDialog=await page.locator('#b3-cut-settings-dialog').boundingBox();
    assert.ok(visibleDialog.y+visibleDialog.height<=421,'messagebox fits the visible area above the phone keyboard');
    await page.evaluate(()=>{delete window.visualViewport.height;window.visualViewport.dispatchEvent(new Event('resize'));});
    await confirm.click();assert.equal(await page.locator('#b3-cut-settings-dialog').isVisible(),true);
    assert.equal(await page.locator('#b3-cut-settings-form').evaluate(n=>n.checkValidity()),false);
    await end.fill('400');assert.equal(await confirm.textContent(),'Cập nhật');
    await confirm.click();assert.equal(await page.locator('#b3-cut-settings-dialog').isVisible(),true,'direction is also required');
    await direction.selectOption('1');assert.equal(await confirm.textContent(),'Cập nhật');
    await end.fill('');await direction.selectOption('');assert.equal(await confirm.textContent(),'Xác nhận','reverting both initial values restores label');
    await accept(page);assert.equal(await page.locator('#b3-after-cut-value').textContent(),'300');
    assert.notEqual(await page.evaluate(()=>document.activeElement.id),'b3-cut-detail-select',
      'confirmation must not automatically focus the cut-length dropdown');
    assert.equal(await page.evaluate(()=>window.__calls.save.length),0);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('partial reel settings use DB orientation, preview chosen length, and defer writes until Save',{skip:!chromium,timeout:15000},async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const {page,errors}=await harness(browser,{width:390,height:844});
    for(const [start,end,direction,preview] of [[0,411,1,311],[411,0,-1,100]]){
      await page.evaluate(([start,end])=>{window.__source={source_type:'CUON_LE',raw_qr:'PARTIAL-007',partial:{id:91,SoDau:start,SoCuoi:end}};window.__context.available_actions=['CUT_PARTIAL_REEL'];},[start,end]);
      await scan(page);
      assert.equal(await page.locator('#b3-end-value-input').inputValue(),String(end));assert.equal(await page.locator('#b3-direction-select').inputValue(),String(direction));
      const confirm=page.locator('#b3-cut-settings-confirm');assert.equal(await confirm.textContent(),'Xác nhận');
      await page.locator('#b3-direction-select').selectOption(String(-direction));assert.equal(await confirm.textContent(),'Cập nhật');
      await page.locator('#b3-direction-select').selectOption(String(direction));assert.equal(await confirm.textContent(),'Xác nhận');
      await page.locator('#b3-end-value-input').fill('500');assert.equal(await confirm.textContent(),'Cập nhật');
      await page.locator('#b3-end-value-input').fill(String(end));assert.equal(await confirm.textContent(),'Xác nhận');
      await confirm.click();await page.locator('#b3-cut-settings-dialog').waitFor({state:'hidden'});
      assert.notEqual(await page.evaluate(()=>document.activeElement.id),'b3-cut-detail-select',
        'partial confirmation leaves the dropdown for the user to open');
      assert.equal(await page.locator('#b3-after-cut-value').textContent(),String(preview));
      await page.locator('#b3-cut-detail-select').selectOption('101');
      assert.equal(await page.locator('#b3-after-cut-value').textContent(),String(end-direction*110));
      assert.equal(await page.locator('.b3-result-scroll #b3-end-value-input,.b3-result-scroll #b3-direction-select').count(),0);
      assert.equal(await page.evaluate(()=>window.__calls.save.length),0);
      await page.locator('#b3-cancel-action').click();await page.waitForFunction(()=>!history.state?.b3ResultPage);
    }
    await page.evaluate(()=>{window.__source.partial={id:91,SoDau:0,SoCuoi:411};});
    await scan(page);await page.locator('#b3-end-value-input').fill('500');await page.locator('#b3-direction-select').selectOption('1');
    await page.locator('#b3-cut-settings-confirm').click();await page.locator('#b3-cut-settings-dialog').waitFor({state:'hidden'});
    assert.equal(await page.locator('#b3-after-cut-value').textContent(),'400');assert.equal(await page.evaluate(()=>window.__calls.save.length),0);
    await page.locator('#b3-save-action').click();await page.waitForFunction(()=>window.B3State.cutSession?.cutsSaved===1);
    assert.equal(await page.locator('#b3-current-end').textContent(),'400');
    assert.equal(await page.locator('#b3-cut-settings-dialog').count(),0);
    const calls=await page.evaluate(()=>window.__calls.save);assert.equal(calls.length,1);assert.equal(calls[0].end_value,500);assert.equal(calls[0].direction,1);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('worklist badges and order refresh only after Save succeeds',{skip:!chromium,timeout:15000},async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const {page,errors}=await harness(browser,{width:1366,height:900});
    await page.evaluate(async()=>{
      const row=(id,product,plan,status,completed=false)=>({work_id:id,row_type:completed?'CUT_DONE':'FULL_CUT',
        ten_san_pham:product,ma_ke_hoach:plan,tinh_trang:status,completed,chieu_dai_lay:100});
      window.__rows=[row('done','C','1','Đã thực hiện',true),row('waiting','A','2','Chưa thực hiện'),
        row('other','B','2','Đang thực hiện'),row('running','A','10','Đang thực hiện (1/2)')];
      await window.__b3.selectPlan(window.__plan);
      window.B3Api.cut=async payload=>{
        window.__rows=window.__rows.map(row=>row.work_id==='running'
          ?{...row,completed:true,tinh_trang:'Hoàn thành (2/2)'}:row);
        return window.__defaultCut(payload);
      };
    });
    const ids=()=>page.evaluate(()=>window.B3State.worklist.map(row=>row.work_id));
    assert.deepEqual(await ids(),['running','other','waiting','done']);
    const colors=await page.locator('#plan-table-body .b3-status-badge').evaluateAll(nodes=>nodes.map(node=>({
      background:getComputedStyle(node).backgroundColor,text:node.textContent,
    })));
    assert.equal(colors[0].background,'rgb(255, 243, 205)');assert.equal(colors[0].text,'Đang thực hiện (1/2)');
    assert.equal(colors[2].background,'rgb(255, 255, 255)');
    assert.equal(colors[3].background,'rgb(209, 231, 221)');
    await scan(page);await accept(page);
    assert.deepEqual(await ids(),['running','other','waiting','done'],'parameter confirmation cannot complete a worklist item');
    assert.equal(await page.evaluate(()=>window.__calls.save.length),0);
    await page.locator('#b3-save-action').click();
    await page.waitForFunction(()=>window.B3State.worklistReady&&window.B3State.cutSession?.cutsSaved===1);
    assert.equal(await page.locator('#b3-result-page').isVisible(),true);
    assert.deepEqual(await ids(),['other','waiting','running','done']);
    assert.equal(await page.locator('#plan-table-body .b3-status-done').first().textContent(),'Đã thực hiện (2/2)');
    assert.equal(await page.locator('#plan-table-body tr').first().locator('td').count(),9);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});


test('QR result disclosure headers, warning and live reel markers match the selected direction',{skip:!chromium,timeout:20000},async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const {page,errors}=await harness(browser,{width:390,height:844});
    await page.evaluate(()=>{window.__context.available_actions=['TAKE_WHOLE_REEL','CUT_FULL_REEL'];window.__source.chieu_dai_1cuon=300;});
    await page.evaluate(()=>window.__b3.resolveScan('BIN-007-QR'));
    const warning=page.locator('#b3-tab-content .alert-warning');
    assert.equal(await warning.textContent(),'Cần chọn LẤY NGUYÊN CUỘN hoặc CHỌN CẮT LẺ trước');
    for(const selector of ['.b3-plan-details','.b3-result-scroll > .b3-raw-qr:last-child']){
      const disclosure=page.locator(selector),icon=disclosure.locator('summary .b3-disclosure-icon');
      assert.equal(await icon.count(),1);
      assert.equal(await disclosure.evaluate(n=>n.open),false);
      const closed=await icon.evaluate(n=>getComputedStyle(n).transform);
      await disclosure.locator('summary').click();
      await page.waitForTimeout(250);
      assert.notEqual(await icon.evaluate(n=>getComputedStyle(n).transform),closed);
      await disclosure.locator('summary').click();
    }
    await page.locator('#b3-tab-cut').click();
    await page.locator('#b3-end-value-input').fill('500');
    await page.locator('#b3-direction-select').selectOption('1');
    const preview=page.locator('#b3-cut-settings-preview');
    assert.equal(await preview.textContent(),'Số đầu - Số cuối: 200 - 500');
    await screenshot(page,'b3-reel-direction-preview.png');
    await page.locator('#b3-direction-select').selectOption('-1');
    assert.equal(await preview.textContent(),'Số đầu - Số cuối: 800 - 500');
    await page.locator('#b3-direction-select').selectOption('1');
    await page.locator('#b3-end-value-input').fill('200');
    const error=page.locator('#b3-cut-settings-error');
    assert.equal(await error.isVisible(),true);
    assert.match(await error.textContent(),/Số đầu.*0/);
    await page.locator('#b3-cut-settings-confirm').click();
    assert.equal(await page.locator('#b3-cut-settings-dialog').isVisible(),true);
    await page.locator('#b3-end-value-input').fill('500');
    assert.equal(await error.isVisible(),false);
    await page.locator('#b3-cut-settings-confirm').click();
    const reel=page.locator('.b3-reel-details');
    assert.equal(await reel.locator('summary').textContent(),'Thông tin cuộn/lô lẻ');
    assert.equal(await reel.evaluate(n=>n.open),false,'reel information is collapsed after confirming end and direction');
    await reel.locator('summary').click();assert.equal(await page.locator('#b3-current-end').isVisible(),true);
    await reel.locator('summary').click();assert.equal(await page.locator('#b3-current-end').isVisible(),false);
    await page.locator('#b3-cut-detail-select').selectOption('101');
    assert.equal(await reel.evaluate(n=>n.open),false,'changing cut length preserves collapsed reel information');
    await reel.locator('summary').click();assert.equal(await page.locator('#b3-current-end').textContent(),'500');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('partial reel information has an expandable header and group guidance uses danger styling',{skip:!chromium,timeout:15000},async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const {page,errors}=await harness(browser,{width:1366,height:900});
    await page.evaluate(()=>{
      window.__source={source_type:'CUON_LE',raw_qr:'PARTIAL-007',partial:{id:91,SoDau:0,SoCuoi:411}};
      window.__context.available_actions=['CUT_PARTIAL_REEL'];
      window.__context.groups.push({id:20,details:[{id:200,ChieuDaiCanCat:200,done:0,selectable:true}]});
    });
    await scan(page);await page.locator('#b3-cut-settings-confirm').click();
    assert.equal(await page.locator('.b3-reel-details summary').textContent(),'Thông tin cuộn/lô lẻ');
    assert.equal(await page.locator('#b3-current-start').textContent(),'0');
    assert.equal(await page.locator('#b3-current-end').textContent(),'411');
    const note=page.locator('#b3-tab-content .b3-inline-note');
    assert.equal(await note.textContent(),'Chọn chiều dài cần cắt trong nhóm.');
    assert.equal(await note.evaluate(n=>n.classList.contains('text-danger')),true);
    await page.locator('#b3-group-select').selectOption('19');
    assert.equal(await page.locator('.b3-reel-details').evaluate(n=>n.open),false,'partial reel information defaults to collapsed');
    await page.locator('.b3-reel-details summary').click();
    assert.equal(await page.locator('#b3-current-end').isVisible(),true);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});


for(const viewport of [{width:390,height:667},{width:844,height:390},{width:1366,height:900}]){
  test(`cut footer fits buttons and chosen cut preview is above footer ${viewport.width}x${viewport.height}`,{skip:!chromium,timeout:15000},async()=>{
    const browser=await chromium.launch({headless:true});
    try{
      const {page,errors}=await harness(browser,viewport);
      await scan(page);await accept(page);
      const footer=await page.locator('.b3-result-footer').boundingBox();
      const button=await page.locator('#b3-save-action').boundingBox();
      assert.ok(footer.height<=button.height+17,'cut footer has at most 8px padding on each side plus border');
      const scroll=await page.locator('.b3-result-scroll').boundingBox();
      assert.ok(scroll.y+scroll.height<=footer.y+1,'main content ends above footer');
      await page.evaluate(()=>{document.querySelector('.b3-result-scroll').scrollTop=0;});
      await page.locator('#b3-cut-detail-select').selectOption('101');
      const panel=await page.locator('#b3-tab-content .b3-operation-panel').boundingBox();
      const preview=await page.locator('.b3-after-cut-card').boundingBox();
      assert.ok(preview.y>=scroll.y-1&&preview.y+preview.height<=footer.y+1,'entire after-cut preview is visible above the buttons');
      if(viewport.height>=667)closeTo(panel.y,scroll.y+10,'cut panel aligns immediately below screen header');
      assert.equal(await page.locator('#b3-after-cut-value').textContent(),'290');
      await screenshot(page,`b3-cut-layout-${viewport.width}x${viewport.height}.png`);
      assert.deepEqual(errors,[]);
    }finally{await browser.close();}
  });
}


test('action buttons stay at the screen bottom after keyboard viewport height becomes stale',{skip:!chromium,timeout:15000},async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const {page,errors}=await harness(browser,{width:390,height:844});
    await scan(page);await accept(page);
    // Mobile browsers can briefly keep the old keyboard viewport height after
    // closing the number input. The result screen must follow CSS dynamic vh.
    await page.evaluate(()=>{
      Object.defineProperty(window.visualViewport,'height',{configurable:true,value:window.innerHeight-110});
      window.visualViewport.dispatchEvent(new Event('resize'));
    });
    const footer=await page.locator('.b3-result-footer').boundingBox();
    const button=await page.locator('#b3-save-action').boundingBox();
    closeTo(footer.y+footer.height,844,'footer reaches the visible screen bottom');
    assert.ok(844-(button.y+button.height)<=8,'no empty region beneath the action buttons');
    await page.evaluate(()=>{
      delete window.visualViewport.height;
      window.visualViewport.dispatchEvent(new Event('resize'));
    });
    await page.setViewportSize({width:390,height:667});
    const resized=await page.locator('.b3-result-footer').boundingBox();
    closeTo(resized.y+resized.height,667,'footer follows screen resizing');
    await screenshot(page,'b3-footer-bottom-mobile.png');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
