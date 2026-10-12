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
  for(const id of ['open-qr','continuous-scan','b3-qr-guidance','plan-search','qr-bottom-sheet','qr-bottom-sheet-backdrop','qr-result-value','b3-continue-scan','b3-first-cut-decision-overlay','plan-table-body','empty-state','pagination','result-summary','desktop-pagination','b3-save-action','app-screen']){
    nodes[id]={id,style:{},classList:{add(){},remove(){}},setAttribute(){},removeAttribute(){},hidden:true,checked:false,disabled:false,value:'',textContent:'',remove(){},appendChild(){}};
  }
  nodes['plan-search'].value='KH01';nodes['empty-state'].querySelector=()=>({textContent:''});
  const body={style:{overflow:'',position:'',top:'',left:'',right:'',width:''},classList:{add(){},remove(){}}};
  const html={style:{overflow:''}};
  const doc={body,documentElement:html,querySelector(sel){return nodes[sel.slice(1)]||null;},querySelectorAll(){return [];},addEventListener(){},getElementById(id){return nodes[id]||null;},createElement(){return {innerHTML:'',classList:{add(){},remove(){}},setAttribute(){},remove(){}};}};
  const win=sandbox.window;win.B3Api={};win.scrollY=320;win.scrollX=0;win.scrollTo=(x,y)=>{win.lastRestored=[x,y];};
  const ctx=vm.createContext({...sandbox,document:doc,window:win});
  vm.runInContext(uiJs.replace(/\}\)\(\);\s*$/,'globalThis.__b3Test={updateQrControls,showSheet,closeSheet,showFirstCutDecisionOverlay,closeDecisionOverlay,openScanner,changePlanScope,loadWorklist,saveAction};})();'),ctx);
  return {s,nodes,doc,win,api:ctx.__b3Test};
}
const pending=[{row_type:'COMPLETED_SUMMARY'},{row_type:'FULL_TAKE'}];
function ready(h){h.s.user={username:'test'};h.s.selectedPlan={id:1,ma_ke_hoach:'KH01'};h.s.showAll=false;h.s.worklist=pending;h.s.worklistReady=true;h.s.worklistLoading=false;h.s.planInputDirty=false;}

test('QR requires authenticated, verified pending work and filters completed summaries',()=>{
  const h=harness();ready(h);h.api.updateQrControls();assert.equal(h.nodes['open-qr'].disabled,false);
  h.s.worklist=[{row_type:'COMPLETED_SUMMARY'}];h.api.updateQrControls();assert.equal(h.nodes['open-qr'].disabled,true);
  h.s.worklist=pending;h.s.worklistReady=false;h.api.updateQrControls();assert.equal(h.nodes['open-qr'].disabled,true);
  h.s.worklistReady=true;h.s.planInputDirty=true;h.api.updateQrControls();assert.equal(h.nodes['continuous-scan'].disabled,true);
});

test('loading and failed refreshed worklist cannot use stale results',async()=>{
  const h=harness();ready(h);
  h.win.B3Api.worklist=()=>Promise.reject(new Error('offline'));
  h.api.updateQrControls();assert.equal(h.nodes['open-qr'].disabled,false);
  await h.api.loadWorklist();assert.equal(h.nodes['open-qr'].disabled,true);
  assert.equal(h.s.worklistReady,false);
});

test('sheet locks document scrolling and restores position on close',()=>{
  const h=harness();h.api.showSheet('QR1');assert.equal(h.doc.body.style.position,'fixed');
  assert.equal(h.doc.body.style.top,'-320px');
  h.api.closeSheet();assert.equal(h.doc.body.style.position,'');assert.deepEqual(h.win.lastRestored,[0,320]);
});

test('scanner cannot open without pending work even if called programmatically',async()=>{
  const h=harness();ready(h);h.s.worklistReady=false;
  let started=0;h.win.QrCameraModal=class{async open(){started++;}};
  await h.api.openScanner();assert.equal(started,0);
});


test('typing a different plan during pending scope load must not be overwritten',async()=>{
 const h=harness();ready(h);let respond;
 h.win.B3Api.worklist=()=>new Promise(resolve=>{respond=resolve;});
 const task=h.api.changePlanScope({id:2,ma_ke_hoach:'KH02'},false);
 h.nodes['plan-search'].value='KH03';h.s.planInputDirty=true;
 respond({rows:[{row_type:'FULL_TAKE'}]});await task;
 assert.equal(h.nodes['plan-search'].value,'KH03');
 assert.equal(h.s.planInputDirty,true);
 assert.equal(h.nodes['open-qr'].disabled,true);
});

test('bottom sheet scan choice overrides the main screen choice after successful save',async()=>{
 const h=harness();ready(h);
 h.s.scan={source:{raw_qr:'abc'}};h.s.context={plan:{id:1},item:{id:20}};h.s.action='TAKE_WHOLE_REEL';
 h.win.B3Api.takeWhole=async()=>({plan_complete:false});
 h.win.B3Api.worklist=async()=>({rows:[{row_type:'FULL_TAKE'}]});
 h.nodes['continuous-scan'].checked=true;h.nodes['b3-continue-scan'].checked=false;
 let cameraOpens=0;h.win.QrCameraModal=class{async open(){cameraOpens++;}};
 await h.api.saveAction();await new Promise(resolve=>setTimeout(resolve,240));
 assert.equal(cameraOpens,0);
});


test('keyboard interaction behind a sheet is inert and is restored on close',()=>{
 const h=harness();h.api.showSheet('QR');assert.equal(h.nodes['app-screen'].inert,true);
 h.nodes['qr-bottom-sheet'].inert=true;h.api.closeDecisionOverlay();assert.equal(h.nodes['qr-bottom-sheet'].inert,false);
 h.api.closeSheet();assert.equal(h.nodes['app-screen'].inert,false);
});
