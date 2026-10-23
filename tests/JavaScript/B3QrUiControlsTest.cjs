'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const stateJs=fs.readFileSync(path.join(root,'public/js/cat-day/b3-state.js'),'utf8');
const uiJs=fs.readFileSync(path.join(root,'public/js/cat-day/cat-day-ui.js'),'utf8');
function harness(){
  const sandbox={window:{},console, setTimeout,clearTimeout};
  sandbox.window.window=sandbox.window;
  vm.runInNewContext(stateJs,sandbox);
  const s=sandbox.window.B3State;
  const nodes={};
  for(const id of ['open-qr','continuous-scan','b3-qr-guidance','plan-search','plan-options','search-all','login-screen','desktop-account-name','b3-result-page','b3-unused-backdrop','qr-result-value','b3-continue-scan','b3-cut-settings-dialog','plan-table-body','empty-state','pagination','result-summary','desktop-pagination','b3-save-action','b3-result-back','b3-cancel-action','app-screen']){
    nodes[id]={id,style:{},attributes:{},listeners:{},classList:{add(){},remove(){}},
      setAttribute(name,value){this.attributes[name]=String(value);},removeAttribute(name){delete this.attributes[name];},
      addEventListener(type,listener){this.listeners[type]=listener;},
      closest(selector){return selector==='#'+this.id?this:null;},
      inert:false,focus(){this.focused=true;},hidden:true,checked:false,disabled:false,value:'',textContent:'',remove(){},appendChild(){},querySelector(){return null;},querySelectorAll(){return [];}};
  }
  nodes['open-qr'].disabled=true;nodes['continuous-scan'].disabled=true;
  nodes['plan-search'].value='KH01';nodes['empty-state'].querySelector=()=>({textContent:''});
  const body={style:{overflow:'',position:'',top:'',left:'',right:'',width:''},classList:{add(){},remove(){}}};
  const html={style:{overflow:''}};
  const doc={body,documentElement:html,listeners:{},querySelector(sel){const id=sel.slice(1);return nodes[id==='qr-bottom-sheet'?'b3-result-page':id==='qr-bottom-sheet-backdrop'?'b3-unused-backdrop':id]||null;},querySelectorAll(){return [];},addEventListener(type,listener){this.listeners[type]=listener;},getElementById(id){return nodes[id]||null;},createElement(){return {innerHTML:'',classList:{add(){},remove(){}},setAttribute(){},remove(){}};}};
  const win=sandbox.window;win.listeners={};win.addEventListener=(type,fn)=>{win.listeners[type]=fn;};win.history={state:null,pushState(value){this.state=value;},back(){this.state=null;win.listeners.popstate?.({state:null});}};win.B3Api={};win.scrollY=320;win.scrollX=0;win.scrollTo=(x,y)=>{win.lastRestored=[x,y];};
  const ctx=vm.createContext({...sandbox,document:doc,window:win});
  vm.runInContext(uiJs.replace(/\}\)\(\);\s*$/,'globalThis.__b3Test={updateQrControls:typeof updateQrControls==="function"?updateQrControls:undefined,closeDecisionOverlay:typeof closeDecisionOverlay==="function"?closeDecisionOverlay:undefined,showResultPage,closeResultPage,showCutSettingsDialog,openScanner,changePlanScope,loadWorklist,saveAction,selectPlan,bindPlanSearch,resetPlanScope,showLogin,bindResultPage,handleSessionExpired,resolveScan,init,chooseContext};})();'),ctx);
  return {s,nodes,doc,win,api:ctx.__b3Test};
}
const pending=[{row_type:'FULL_TAKE',completed:true},{row_type:'FULL_TAKE',completed:false}];
function ready(h){h.s.user={username:'test'};h.s.selectedPlan={id:1,ma_ke_hoach:'KH01'};h.s.showAll=false;h.s.worklist=pending;h.s.worklistReady=true;h.s.worklistLoading=false;h.s.planInputDirty=false;}

test('QR requires authenticated, verified pending work and filters completed grouped rows',()=>{
  const h=harness();ready(h);h.api.updateQrControls();assert.equal(h.nodes['open-qr'].disabled,false);
  h.s.worklist=[{row_type:'FULL_TAKE',completed:true}];h.api.updateQrControls();assert.equal(h.nodes['open-qr'].disabled,true);
  h.s.worklist=pending;h.s.worklistReady=false;h.api.updateQrControls();assert.equal(h.nodes['open-qr'].disabled,true);
  h.s.worklistReady=true;h.s.planInputDirty=true;h.api.updateQrControls();assert.equal(h.nodes['continuous-scan'].disabled,true);
});

test('selecting a plan with pending work enables the initially disabled QR controls',async()=>{
  const h=harness();h.s.user={username:'test'};
  h.win.B3Api.worklist=async()=>({rows:pending});
  await h.api.selectPlan({id:1,ma_ke_hoach:'KH01'});
  assert.equal(h.nodes['open-qr'].disabled,false);
  assert.equal(h.nodes['open-qr'].attributes['aria-disabled'],'false');
  assert.equal(h.nodes['continuous-scan'].disabled,false);
  assert.equal(h.nodes['b3-qr-guidance'].hidden,true);
  let started=0;h.win.QrCameraModal=class{async open(){started++;}};
  await h.api.openScanner();assert.equal(started,1);
});

test('searching all plans enables QR only when unfinished work is returned',async()=>{
  const h=harness();h.s.user={username:'test'};
  h.win.B3Api.allWorklist=async()=>({rows:pending});
  await h.api.changePlanScope(null,true);
  assert.equal(h.nodes['open-qr'].disabled,false);
  h.win.B3Api.allWorklist=async()=>({rows:[{row_type:'FULL_TAKE',completed:true}]});
  await h.api.loadWorklist();
  assert.equal(h.nodes['open-qr'].disabled,true);
  assert.equal(h.nodes['b3-qr-guidance'].hidden,false);
});

for(const clickTableWhileLoading of [false,true])test(`search-all click after editing the selected plan enables QR (table click: ${clickTableWhileLoading})`,async()=>{
  const h=harness();h.s.user={username:'test'};
  h.win.B3Api.worklist=async()=>({rows:pending});
  await h.api.selectPlan({id:1,ma_ke_hoach:'KH01'});
  h.api.bindPlanSearch();
  const input=h.nodes['plan-search'];input.value='KH02';input.listeners.input();
  let respond;h.win.B3Api.allWorklist=()=>new Promise(resolve=>{respond=resolve;});
  const button=h.nodes['search-all'];const task=button.listeners.click();
  h.doc.listeners.click({target:button});
  if(clickTableWhileLoading)h.doc.listeners.click({target:h.nodes['plan-table-body']});
  respond({rows:pending});await task;
  assert.equal(h.nodes['open-qr'].disabled,false);
  assert.equal(h.s.showAll,true);
  assert.equal(input.value,'');
  assert.equal(h.s.planInputDirty,false);
});

test('pending worklist requests temporarily disable QR until refreshed data arrives',async()=>{
  const h=harness();h.s.user={username:'test'};
  h.win.B3Api.worklist=async()=>({rows:pending});
  await h.api.selectPlan({id:1,ma_ke_hoach:'KH01'});
  assert.equal(h.nodes['open-qr'].disabled,false);
  let respond;h.win.B3Api.worklist=()=>new Promise(resolve=>{respond=resolve;});
  const task=h.api.loadWorklist();
  assert.equal(h.nodes['open-qr'].disabled,true);
  respond({rows:pending});await task;
  assert.equal(h.nodes['open-qr'].disabled,false);
});

test('editing the selected plan blocks QR and Escape restores the verified selection',async()=>{
  const h=harness();h.s.user={username:'test'};
  h.win.B3Api.worklist=async()=>({rows:pending});
  await h.api.selectPlan({id:1,ma_ke_hoach:'KH01'});
  h.api.bindPlanSearch();
  const input=h.nodes['plan-search'];input.value='KH02';input.listeners.input();
  assert.equal(h.nodes['open-qr'].disabled,true);
  input.listeners.keydown({key:'Escape',preventDefault(){}});
  assert.equal(input.value,'KH01');
  assert.equal(h.nodes['open-qr'].disabled,false);
});

test('resetting the selection and signing out disable QR controls again',async()=>{
  const h=harness();h.s.user={username:'test'};
  h.win.B3Api.worklist=async()=>({rows:pending});
  await h.api.selectPlan({id:1,ma_ke_hoach:'KH01'});
  h.api.resetPlanScope();
  assert.equal(h.nodes['open-qr'].disabled,true);
  assert.equal(h.s.worklistReady,false);
  await h.api.selectPlan({id:1,ma_ke_hoach:'KH01'});
  assert.equal(h.nodes['open-qr'].disabled,false);
  h.api.showLogin();
  assert.equal(h.nodes['open-qr'].disabled,true);
});

test('loading and failed refreshed worklist cannot use stale results',async()=>{
  const h=harness();ready(h);
  h.win.B3Api.worklist=()=>Promise.reject(new Error('offline'));
  h.api.updateQrControls();assert.equal(h.nodes['open-qr'].disabled,false);
  await h.api.loadWorklist();assert.equal(h.nodes['open-qr'].disabled,true);
  assert.equal(h.s.worklistReady,false);
});

test('result page locks document scrolling and restores position on close',()=>{
  const h=harness();h.api.showResultPage('QR1');
  assert.equal(h.doc.body.style.position,'','body is not fixed at the old list offset');
  assert.equal(h.doc.body.style.overflow,'hidden');
  assert.equal(h.doc.documentElement.style.overflow,'hidden');
  assert.deepEqual(h.win.lastRestored,[0,0],'the result screen starts at the document origin');
  h.api.closeResultPage();assert.equal(h.doc.body.style.position,'');assert.deepEqual(h.win.lastRestored,[0,320]);
  assert.equal(h.doc.documentElement.style.overflow,'');
});

test('scanner cannot open without pending work even if called programmatically',async()=>{
  const h=harness();ready(h);h.s.worklistReady=false;
  let started=0;h.win.QrCameraModal=class{async open(){started++;}};
  await h.api.openScanner();assert.equal(started,0);
});


test('typing a different plan during pending scope load must not be overwritten',async()=>{
 const h=harness();ready(h);h.api.bindPlanSearch();let respond;
 h.win.B3Api.worklist=()=>new Promise(resolve=>{respond=resolve;});
 const task=h.api.changePlanScope({id:2,ma_ke_hoach:'KH02'},false);
 h.nodes['plan-search'].value='KH03';h.nodes['plan-search'].listeners.input();
 respond({rows:[{row_type:'FULL_TAKE'}]});await task;
 assert.equal(h.nodes['plan-search'].value,'KH03');
 assert.equal(h.s.planInputDirty,true);
 assert.equal(h.nodes['open-qr'].disabled,true);
 h.api.resetPlanScope();
});

test('result page scan choice overrides the main screen choice after successful save',async()=>{
 const h=harness();ready(h);
 h.s.scan={source:{raw_qr:'abc'}};h.s.context={plan:{id:1},item:{id:20}};h.s.action='TAKE_WHOLE_REEL';
 h.win.B3Api.takeWhole=async()=>({plan_complete:false});
 h.win.B3Api.worklist=async()=>({rows:[{row_type:'FULL_TAKE'}]});
 h.nodes['continuous-scan'].checked=true;h.nodes['b3-continue-scan'].checked=false;
 let cameraOpens=0;h.win.QrCameraModal=class{async open(){cameraOpens++;}};
 await h.api.saveAction();await new Promise(resolve=>setTimeout(resolve,240));
 assert.equal(cameraOpens,0);
});


test('keyboard interaction behind result page is inert and is restored on close',()=>{
 const h=harness();h.api.showResultPage('QR');assert.equal(h.nodes['app-screen'].inert,true);
 h.nodes['b3-result-page'].inert=true;h.api.closeDecisionOverlay();assert.equal(h.nodes['b3-result-page'].inert,false);
 h.api.closeResultPage();assert.equal(h.nodes['app-screen'].inert,false);
});


test('cancel discards result draft while retaining selected plan, page and list',()=>{
 const h=harness();ready(h);h.s.page=3;h.api.bindResultPage();
 const selected=h.s.selectedPlan,worklist=h.s.worklist;
 h.api.showResultPage('QR');h.s.scan={source:{raw_qr:'QR'}};h.s.endValue='400';
 assert.equal(h.nodes['app-screen'].hidden,true);
 assert.equal(h.nodes['b3-result-page'].hidden,false);
 h.api.closeResultPage();
 assert.equal(h.nodes['app-screen'].hidden,false);
 assert.equal(h.nodes['b3-result-page'].hidden,true);
 assert.equal(h.s.scan,null);assert.equal(h.s.endValue,'');
 assert.equal(h.s.page,3);assert.equal(h.s.selectedPlan,selected);assert.equal(h.s.worklist,worklist);
});

test('browser back closes result page and restores the list',()=>{
 const h=harness();ready(h);h.api.bindResultPage();h.api.showResultPage('QR');
 h.win.history.back();
 assert.equal(h.nodes['b3-result-page'].hidden,true);
 assert.equal(h.nodes['app-screen'].inert,false);
});

test('expired session clears result draft and selected plan and closes camera',()=>{
 const h=harness();ready(h);let cameraClosed=0;
 h.s.singleQrModal={close(){cameraClosed++;}};
 h.api.showResultPage('QR');h.s.scan={};h.s.endValue='400';
 h.api.handleSessionExpired({detail:{message:'Phiên đăng nhập đã hết.'}});
 assert.equal(h.s.user,null);assert.equal(h.s.selectedPlan,null);assert.equal(h.s.scan,null);
 assert.equal(h.s.endValue,'');assert.equal(h.nodes['b3-result-page'].hidden,true);
 assert.equal(cameraClosed,1);
});


test('a scan response from before logout cannot open after another login',async()=>{
 const h=harness();ready(h);let respond;
 h.win.B3Api.resolveQr=()=>new Promise(resolve=>{respond=resolve;});
 const pendingScan=h.api.resolveScan('OLD-QR');
 h.api.showLogin();h.s.user={username:'new-user'};
 respond({source:{raw_qr:'OLD-QR'},selected_context:null,candidate_contexts:[]});
 await pendingScan;
 assert.equal(h.nodes['b3-result-page'].hidden,true);
 assert.equal(h.s.scan,null);
});


test('a delayed initial session check cannot replace a newer login',async()=>{
 const h=harness();let respond;
 h.win.B3Api.session=()=>new Promise(resolve=>{respond=resolve;});
 const boot=h.api.init();
 h.api.showLogin();h.s.user={username:'new-user'};
 respond({user:{username:'old-user'}});
 await boot;
 assert.equal(h.s.user.username,'new-user');
});


for(const values of [
 {source:{source_type:'CUON_CHAN'},end:'',direction:''},
 {source:{source_type:'CUON_LE',partial:{SoDau:0,SoCuoi:411}},end:'411',direction:1},
 {source:{source_type:'CUON_LE',partial:{SoDau:411,SoCuoi:0}},end:'0',direction:-1},
])test('cut settings defaults follow source markers: '+JSON.stringify(values.source),()=>{
 const h=harness();h.s.scan={source:values.source};
 h.api.chooseContext({available_actions:['CUT_PARTIAL_REEL'],groups:[]});
 assert.equal(h.s.endValue,values.end);assert.equal(h.s.direction,values.direction);
 assert.equal(h.s.cutParametersConfirmed,false);
});
