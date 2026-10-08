'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const js = fs.readFileSync(path.join(root, 'public/js/cat-day/cat-day-ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/cat-day/cat-day-ui.css'), 'utf8');

function setup({ reducedMotion = false } = {}) {
  let now = 0, id = 0;
  const jobs = new Map();
  const setTimer = (callback, delay = 0) => { const key = ++id; jobs.set(key, { time: now + Number(delay), callback }); return key; };
  const clearTimer = key => jobs.delete(key);
  function advance(ms) {
    const target = now + ms;
    for (let limit = 0; limit < 3000; limit++) {
      let selected = null;
      for (const [key, task] of jobs) if (task.time <= target && (!selected || task.time < selected.task.time)) selected = {key,task};
      if (!selected) { now = target; return; }
      now = selected.task.time;
      jobs.delete(selected.key);
      selected.task.callback();
    }
    throw Error('Potential runaway timer');
  }
  class FakeElement {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
      this.listeners = new Map(); this.attrs = {}; this.dataset = {}; this.textContent = '';
      this._classes = new Set(); this.classList = {
        add: (...names) => names.forEach(n => this._classes.add(n)),
        remove: (...names) => names.forEach(n => this._classes.delete(n)),
        contains: n => this._classes.has(n),
        toggle: (name,on) => { if(on) this._classes.add(name); else this._classes.delete(name); }
      };
    }
    set className(v) { this._classes = new Set(v.split(/\s+/).filter(Boolean)); }
    get className() { return [...this._classes].join(' '); }
    setAttribute(name,val) { this.attrs[name] = String(val); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    removeAttribute(name) { delete this.attrs[name]; }
    appendChild(child) { if(child.parentElement)child.remove(); this.children.push(child); child.parentElement=this; return child; }
    prepend(child) { if(child.parentElement)child.remove(); this.children.unshift(child); child.parentElement=this; }
    remove() { if(this.parentElement){ const a=this.parentElement.children; a.splice(a.indexOf(this),1); this.parentElement=null; } }
    addEventListener(type, cb) { if(!this.listeners.has(type))this.listeners.set(type,[]); this.listeners.get(type).push(cb); }
    dispatch(type, props = {}) { for(const cb of this.listeners.get(type)||[])cb({type,target:this, ...props}); }
    click() { this.dispatch('click'); }
    contains(el) { return el===this || this.children.some(c=>c.contains(el)); }
    get offsetWidth() {return 100;}
    querySelector(selector) { return selector === '.btn-close' ? this.children.find(c=>c.classList.contains('btn-close')) : null; }
  }
  const host = new FakeElement('div');
  const nodes = Object.fromEntries(['#login-screen','#app-screen','#desktop-account-name','#plan-search','#plan-options','#plan-table-body','#empty-state','#pagination','#result-summary','#desktop-pagination'].map(k=>[k,new FakeElement('div')]));
  nodes['#empty-state'].querySelector=()=>new FakeElement('span');
  const documentEvents = new Map();
  const document = {
    hidden:false, activeElement:null,
    createElement(tag) {return new FakeElement(tag);},
    querySelector(selector) {return selector === '#app-alert-host' ? host : nodes[selector]||null;},
    addEventListener(type,cb) {if(!documentEvents.has(type))documentEvents.set(type,[]);documentEvents.get(type).push(cb);},
    dispatch(type) {for(const cb of documentEvents.get(type)||[])cb();}
  };
  const FakeDate = class extends Date {static now(){return now;}};
  const window = {B3State:{},B3Api:{},matchMedia:()=>({matches:reducedMotion})};
  const context = vm.createContext({document,window,Date:FakeDate,setTimeout:setTimer,clearTimeout:clearTimer,console});
  vm.runInContext(js.replace(/\}\)\(\);\s*$/, 'globalThis.testB3Popup={alertUser,showApp,showLogin,changePlanScope};})();'),context,{filename:'cat-day-ui.js'});
  return {alert:(type,message)=>context.testB3Popup.alertUser(type,message),host,advance,document,window,jobs,
    app:(user={username:'user'})=>context.testB3Popup.showApp(user),
    login:()=>context.testB3Popup.showLogin(),
    scope:(plan,all)=>context.testB3Popup.changePlanScope(plan,all)};
}
const closeButton = alert=>alert.querySelector('.btn-close');
const message = alert=>alert.children.find(el=>el.classList.contains('app-popup-alert-message'))?.textContent;

// Red-green contract: tests use the actual app JS, without duplicating the notification implementation.
test('X closes only the selected popup with exit animation, then releases timers',()=>{
  const s=setup();s.alert('success','Saved A');s.alert('danger','Error B');
  assert.equal(s.host.children.length,2);
  s.advance(250);
  const error = s.host.children[0], success=s.host.children[1];
  closeButton(error).click();
  assert.equal(error.classList.contains('app-popup-alert-leaving'),true);
  assert.equal(s.host.children.length,2);
  s.advance(179);assert.equal(s.host.children.length,2);
  s.advance(1);assert.deepEqual(s.host.children,[success]);
  s.advance(8000);assert.equal(s.host.children.length,0);assert.equal(s.jobs.size,0);
});
test('success closes 3000ms after entrance, error closes 8000ms after entrance',()=>{
  const s=setup();s.alert('success','ok');s.alert('danger','bad');
  s.advance(249);assert.equal(s.host.children.length,2);
  s.advance(3000);assert.equal(s.host.children.length,2);
  s.advance(1);assert.equal(s.host.children.length,2);
  s.advance(179);assert.equal(s.host.children.length,2);
  s.advance(1);assert.equal(s.host.children.length,1);
  s.advance(4820);assert.equal(s.host.children.length,1);
  s.advance(180);assert.equal(s.host.children.length,0);
});
test('newest on top and cap 3; oldest success removed first, then oldest error',()=>{
  const s=setup();s.alert('danger','A');s.alert('success','B');s.alert('danger','C');s.alert('success','D');
  assert.deepEqual(s.host.children.map(message),['D','C','A']);
  s.alert('danger','E');assert.deepEqual(s.host.children.map(message),['E','C','A']);
  s.alert('danger','F');assert.deepEqual(s.host.children.map(message),['F','E','C']);
});
test('repeat of same type and message within two seconds increments count, moves to top, restarts timer',()=>{
  const s=setup();s.alert('danger','Bad QR');s.advance(250);s.advance(1700);
  s.alert('success','Other');s.alert('danger','Bad QR');
  assert.equal(s.host.children.length,2);
  assert.equal(message(s.host.children[0]),'Bad QR (2 lần)');
  s.advance(7999);assert.equal(s.host.children.length,1);
  s.advance(1);assert.equal(s.host.children.length,1);
  s.advance(180);assert.equal(s.host.children.length,0);
});
test('different type, different content, out of window or leaving are never combined',()=>{
  const s=setup();s.alert('success','X');s.alert('danger','X');s.alert('danger','Y');
  assert.equal(s.host.children.length,3);
  s.advance(2100);s.alert('danger','Y');assert.equal(s.host.children.filter(el=>message(el)==='Y').length,2);
  closeButton(s.host.children[0]).click();s.alert('danger','Y');assert.equal(s.host.children.filter(el=>message(el)==='Y').length,3); // one exiting, two active
});
test('hover suspends timer and mouseleave resumes remaining time',()=>{
  const s=setup();s.alert('danger','hover');s.advance(250);s.advance(6000);
  const el=s.host.children[0];el.dispatch('mouseenter');s.advance(10000);assert.equal(s.host.children.length,1);
  el.dispatch('mouseleave');s.advance(1999);assert.equal(s.host.children.length,1);
  s.advance(1);assert.equal(el.classList.contains('app-popup-alert-leaving'),true);
});
test('keyboard focus keeps timer paused until focus leaves',()=>{
  const s=setup();s.alert('success','focus');s.advance(250);
  const el=s.host.children[0];s.document.activeElement=closeButton(el);el.dispatch('focusin');s.advance(10000);
  assert.equal(s.host.children.length,1);
  s.document.activeElement=null;el.dispatch('focusout');s.advance(3000);s.advance(180);
  assert.equal(s.host.children.length,0);
});
test('switching to background resumes countdown even if hovered; stale popup gone on return',()=>{
  const s=setup();s.alert('danger','error');s.advance(250);s.advance(2000);
  const el=s.host.children[0];el.dispatch('mouseenter');s.advance(1000);
  s.document.hidden=true;s.document.dispatch('visibilitychange');s.advance(6200);
  s.document.hidden=false;s.document.dispatch('visibilitychange');s.advance(180);
  assert.equal(s.host.children.length,0);
});
test('changing context removes previous alerts but failed request does not', async()=>{
  const s=setup();s.alert('danger','Previous');s.window.B3State.selectedPlan={id:1};s.window.B3State.showAll=false;
  s.window.B3Api.worklist=async()=>({rows:[]});
  await s.scope({id:2,ma_ke_hoach:'P2'},false);
  assert.equal(s.host.children.length,0);
  s.alert('danger','Keep previous');
  s.window.B3Api.worklist=async()=>{throw Error('No network');};
  await s.scope({id:3,ma_ke_hoach:'P3'},false);
  assert.ok(s.host.children.some(el=>message(el)==='Keep previous'));
  s.login();assert.equal(s.host.children.length,0);assert.equal(s.jobs.size,0);
});
test('reduced motion still respects popup duration and closes by X',()=>{
  const s=setup({reducedMotion:true});s.alert('success','ok');const el=s.host.children[0];
  s.advance(3000);assert.equal(s.host.children.length,0);
  s.alert('danger','err');closeButton(s.host.children[0]).click();assert.equal(s.host.children.length,0);
});
test('CSS supports scrolling text, responsive width, animation duration and z-layer priority',()=>{
  const hostZ=Number(css.match(/\.app-alert-host\s*\{[^}]*z-index:\s*(\d+)/s)?.[1]);
  const overlayZ=Number(css.match(/\.b3-decision-overlay\s*\{[^}]*z-index:\s*(\d+)/s)?.[1]);
  const loadingZ=Number(css.match(/\.b3-page-loading\s*\{[^}]*z-index:\s*(\d+)/s)?.[1]);
  assert.ok(hostZ>overlayZ&&hostZ>loadingZ&&hostZ<=2147483647);
  assert.match(css,/\.app-popup-alert-message\s*\{[^}]*max-height:/s);
  assert.match(css,/\.app-popup-alert-message\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css,/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});
test('a background-expired popup is removed immediately on visibility restore',()=>{
  const s=setup();s.alert('danger','expired');s.advance(250);
  s.document.hidden=true;s.document.dispatch('visibilitychange');s.advance(8050);
  // Browser timers can be throttled while hidden; restoring visibility must not expose an expired popup.
  s.document.hidden=false;s.document.dispatch('visibilitychange');
  assert.equal(s.host.children.length,0);
});
test('X pressed during entrance cancels entrance timer and completes one exit',()=>{
  const s=setup();s.alert('success','immediately');const el=s.host.children[0];
  closeButton(el).click();closeButton(el).click();s.advance(180);
  assert.equal(s.host.children.length,0);assert.equal(s.jobs.size,0);
});
test('repeated matching error during entrance gets one popup and complete post-entry countdown',()=>{
  const s=setup();s.alert('danger','NO QR');s.advance(80);s.alert('danger','NO QR');
  assert.equal(s.host.children.length,1);assert.equal(message(s.host.children[0]),'NO QR (2 lần)');
  s.advance(170);s.advance(7999);assert.equal(s.host.children.length,1);
  s.advance(1);assert.equal(s.host.children[0].classList.contains('app-popup-alert-leaving'),true);
});
test('original message is written as text, without HTML interpretation',()=>{
  const s=setup();s.alert('danger','<img src=x onerror=alert(1)>');
  const el=s.host.children[0];assert.equal(message(el),'<img src=x onerror=alert(1)>');
  assert.equal(el.children.length,2);
  assert.equal(el.getAttribute('role'),'alert');
  assert.equal(closeButton(el).getAttribute('aria-label'),'Đóng thông báo');
});
test('new alert appearing while previous exits remains visible and independent',()=>{
  const s=setup();s.alert('success','a');s.advance(250);const first=s.host.children[0];
  closeButton(first).click();s.alert('danger','b');
  assert.equal(s.host.children.length,2);s.advance(180);
  assert.deepEqual(s.host.children.map(message),['b']);
});
test('focus moving within popup must not restart countdown',()=>{
  const s=setup();s.alert('danger','focus');s.advance(250);s.advance(3000);
  const el=s.host.children[0], button=closeButton(el);s.document.activeElement=button;el.dispatch('focusin');
  el.dispatch('focusout',{relatedTarget:button});s.advance(12000);assert.equal(s.host.children.length,1);
  s.document.activeElement=null;el.dispatch('focusout');s.advance(5000);s.advance(180);
  assert.equal(s.host.children.length,0);
});
test('successful transition to a new plan clears toast, transition to same plan preserves it',async()=>{
  const s=setup();s.window.B3State.selectedPlan={id:1,ma_ke_hoach:'P1'};s.window.B3State.showAll=false;
  s.window.B3Api.worklist=async()=>({rows:[]});
  s.alert('danger','keep');await s.scope({id:1,ma_ke_hoach:'P1'},false);
  assert.deepEqual(s.host.children.map(message),['keep']);
  await s.scope({id:2,ma_ke_hoach:'P2'},false);
  assert.equal(s.host.children.length,0);
  s.alert('success','next');s.window.B3Api.allWorklist=async()=>({rows:[]});
  await s.scope(null,true);assert.equal(s.host.children.length,0);
});
test('login success clears stale notification without modifying API messages',()=>{
  const s=setup();s.alert('danger','Sign-in failed');s.app();assert.equal(s.host.children.length,0);
  assert.equal(s.jobs.size,0);
});
test('success and error do not expire during their 250ms entrance',()=>{
  const s=setup();s.alert('success','S');s.alert('danger','E');
  const elements=[...s.host.children];s.advance(249);
  assert.ok(elements.every(e=>e.classList.contains('show')));
  s.advance(1);assert.equal(s.host.children.length,2);
  assert.equal(s.jobs.size,2); // independent post-entrance clocks
});
test('success hover pauses its three-second countdown',()=>{
  const s=setup();s.alert('success','S');s.advance(250);s.advance(1000);
  const el=s.host.children[0];el.dispatch('mouseenter');s.advance(6000);
  assert.equal(s.host.children.length,1);
  el.dispatch('mouseleave');s.advance(1999);assert.equal(s.host.children.length,1);
  s.advance(181);assert.equal(s.host.children.length,0);
});
test('repeating a toast after it has been removed starts again at count one',()=>{
  const s=setup();s.alert('success','Same');s.advance(3430);
  assert.equal(s.host.children.length,0);
  s.alert('success','Same');assert.deepEqual(s.host.children.map(message),['Same']);
});
test('when four errors are received, oldest error is discarded and its timers cleared',()=>{
  const s=setup();['A','B','C','D'].forEach(v=>s.alert('danger',v));
  assert.deepEqual(s.host.children.map(message),['D','C','B']);
  assert.equal(s.jobs.size,3);
});
test('when oldest success is discarded, its timer cannot delete any surviving alert',()=>{
  const s=setup();s.alert('success','old');s.advance(1000);
  s.alert('danger','e1');s.alert('danger','e2');s.alert('danger','e3');
  assert.deepEqual(s.host.children.map(message),['e3','e2','e1']);
  s.advance(2500);assert.equal(s.host.children.length,3);
});
test('closing one popup manually does not restart or cancel a second popup timer',()=>{
  const s=setup();s.alert('success','S');s.alert('danger','E');s.advance(250);
  closeButton(s.host.children[0]).click();s.advance(180);
  assert.deepEqual(s.host.children.map(message),['S']);
  s.advance(2819);assert.equal(s.host.children.length,1);
  s.advance(181);assert.equal(s.host.children.length,0);
});
test('very long messages preserve the full text, including linebreaks and long QR data',()=>{
  const s=setup();const data='LOT_'+('1234567890'.repeat(80))+'\nKhông tìm thấy cuộn';
  s.alert('danger',data);
  assert.equal(message(s.host.children[0]),data);
});
test('CSS constrains popup position and maximum viewport height for phones',()=>{
  assert.match(css,/\.app-alert-host\s*\{[^}]*top:\s*calc\(12px \+ env\(safe-area-inset-top\)\)/s);
  assert.match(css,/\.app-alert-host\s*\{[^}]*width:\s*min\(560px, calc\(100vw/s);
  assert.match(css,/\.app-alert-host\s*\{[^}]*max-height:\s*calc\(100dvh/s);
});
test('CSS provides 250ms entrance with 12px travel and 180ms exit',()=>{
  assert.match(css,/\.app-popup-alert\s*\{[^}]*transform:\s*translateY\(-12px\)/s);
  assert.match(css,/\.app-popup-alert\s*\{[^}]*opacity\s*\.25s/s);
  assert.match(css,/\.app-popup-alert\.app-popup-alert-leaving\s*\{[^}]*transition-duration:\s*\.18s/s);
});
test('host does not block QR screen except for interactive notification cards',()=>{
  assert.match(css,/\.app-alert-host\s*\{[^}]*pointer-events:\s*none/s);
  assert.match(css,/\.app-popup-alert\s*\{[^}]*pointer-events:\s*auto/s);
});
test('screen reader roles distinguish success from error, and X has accessible label',()=>{
  const s=setup();s.alert('success','ok');s.alert('danger','oops');
  assert.equal(s.host.children[0].getAttribute('role'),'alert');
  assert.equal(s.host.children[1].getAttribute('role'),'status');
  assert.equal(closeButton(s.host.children[0]).getAttribute('aria-label'),'Đóng thông báo');
});
test('changing from show-all to selected plan clears popup',async()=>{
  const s=setup();s.window.B3State.showAll=true;s.window.B3State.selectedPlan=null;
  s.window.B3Api.worklist=async()=>({rows:[]});
  s.alert('danger','previous plan');await s.scope({id:4,ma_ke_hoach:'K4'},false);
  assert.equal(s.host.children.length,0);
});
test('resetting to login does not cancel a notification created afterward',()=>{
  const s=setup();s.alert('danger','old');s.login();s.alert('danger','new');
  assert.deepEqual(s.host.children.map(message),['new']);
  s.advance(250+8000+180);assert.equal(s.host.children.length,0);
});
test('the most recently repeated toast is treated as newest when overflow chooses the oldest success',()=>{
  const s=setup();s.alert('success','A');s.advance(300);s.alert('success','B');s.alert('danger','C');
  s.alert('success','A');assert.deepEqual(s.host.children.map(message),['A (2 lần)','C','B']);
  s.alert('danger','D');assert.deepEqual(s.host.children.map(message),['D','A (2 lần)','C']);
});
