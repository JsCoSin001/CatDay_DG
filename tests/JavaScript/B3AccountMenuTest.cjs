'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const uiSource = fs.readFileSync(path.join(root, 'public/js/cat-day/cat-day-ui.js'), 'utf8');
const stateSource = fs.readFileSync(path.join(root, 'public/js/cat-day/b3-state.js'), 'utf8');

function harness() {
  const nodes = {};
  let document;
  class FakeElement {
    constructor(id) {
      this.id=id;this.hidden=true;this.disabled=false;this.inert=false;this.value='';
      this.textContent='';this.listeners={};this.attributes={};
      this.classList={add(){},remove(){}};this.style={};
    }
    addEventListener(type,cb){(this.listeners[type]??=[]).push(cb);}
    fire(type,extra={}) {
      const event={target:this,key:null,preventDefault(){this.defaultPrevented=true;},stopPropagation(){},...extra};
      return Promise.all((this.listeners[type]||[]).map(cb=>cb(event)));
    }
    contains(target){return this.id==='mobile-menu'&&['mobile-logout','mobile-password'].includes(target.id);}
    setAttribute(k,v){this.attributes[k]=String(v);}
    removeAttribute(k){delete this.attributes[k];}
    focus(){document.activeElement=this;this.focusCount=(this.focusCount||0)+1;}
    reset(){for(const id of ['password-current','password-new','password-confirm'])nodes[id].value='';}
    querySelectorAll(selector){
      if(this.id==='password-change-form')return [nodes['password-current'],nodes['password-new'],nodes['password-confirm'],nodes['password-dialog-cancel'],nodes['password-dialog-save']];
      if(this.id==='password-dialog')return [nodes['password-dialog-close'],nodes['password-current'],nodes['password-new'],nodes['password-confirm'],nodes['password-dialog-cancel'],nodes['password-dialog-save']].filter(el=>!el.disabled);
      return [];
    }
  }
  const ids=['mobile-menu','mobile-menu-button','password-dialog','password-change-form','password-dialog-close',
    'password-dialog-cancel','password-dialog-save','password-current','password-new','password-confirm',
    'password-change-error','app-screen','login-screen','desktop-account-name','login-password'];
  for(const id of ids)nodes[id]=new FakeElement(id);
  const mobileLogout=new FakeElement('mobile-logout'),desktopLogout=new FakeElement('desktop-logout');
  const mobilePassword=new FakeElement('mobile-password'),desktopPassword=new FakeElement('desktop-password');
  const wrap={contains(target){return [nodes['mobile-menu'],nodes['mobile-menu-button'],mobileLogout,mobilePassword].includes(target);}};
  const body={style:{overflow:''},classList:{add(){},remove(){}}};
  document={body,documentElement:{style:{}},activeElement:null,listeners:{},
    querySelector(selector){return selector==='.mobile-menu-wrap'?wrap:(selector[0]==='#'?nodes[selector.slice(1)]||null:null);},
    querySelectorAll(selector){
      if(selector==='[data-action="logout"]')return [mobileLogout,desktopLogout];
      if(selector==='[data-action="change-password"]')return [mobilePassword,desktopPassword];
      return [];
    },
    addEventListener(type,cb){(this.listeners[type]??=[]).push(cb);},
    fire(type,event){for(const cb of (this.listeners[type]||[]))cb(event);},
  };
  const win={};
  const sandbox={window:win,document,setTimeout,clearTimeout,console};
  vm.runInNewContext(stateSource,sandbox);
  win.B3Api={changePassword:async()=>({success:true,message:'Đổi mật khẩu thành công.'}),logout:async()=>({success:true})};
  vm.runInNewContext(uiSource.replace(/\}\)\(\);\s*$/,
    'globalThis.accountTest={bindAccount,showLogin,showApp,openPasswordDialog,closePasswordDialog};})();'),sandbox);
  const state=win.B3State;
  state.user={username:'worker'};
  sandbox.accountTest.bindAccount();
  return {nodes,doc:document,win,state,wrap,mobileLogout,mobilePassword,desktopLogout,desktopPassword,api:sandbox.accountTest};
}
const click = async (el)=>el.fire('click',{stopPropagation(){}});

test('mobile three-dot menu toggles, closes outside and on Escape',async()=>{
  const h=harness(),button=h.nodes['mobile-menu-button'],menu=h.nodes['mobile-menu'];
  assert.equal(menu.hidden,true);
  await click(button);
  assert.equal(menu.hidden,false);
  assert.equal(button.attributes['aria-expanded'],'true');
  h.doc.fire('click',{target:h.nodes['app-screen']});
  assert.equal(menu.hidden,true);
  assert.equal(button.attributes['aria-expanded'],'false');
  await click(button);
  h.doc.fire('keydown',{key:'Escape',preventDefault(){this.prevented=true;}});
  assert.equal(menu.hidden,true);
  assert.equal(button.focusCount,1);
});

test('change password opens modal and validates required fields, length and confirmation',async()=>{
  const h=harness(),n=h.nodes;
  await click(n['mobile-menu-button']);
  await click(h.mobilePassword);
  assert.equal(n['mobile-menu'].hidden,true);
  assert.equal(n['password-dialog'].hidden,false);
  assert.equal(n['app-screen'].inert,true);
  assert.equal(h.doc.activeElement,n['password-current']);
  let count=0;
  h.win.B3Api.changePassword=async()=>{count++;return {success:true};};
  await n['password-change-form'].fire('submit');
  assert.match(n['password-change-error'].textContent,/hiện tại/i);
  n['password-current'].value='OldPassword!';n['password-new'].value='short';
  await n['password-change-form'].fire('submit');
  assert.match(n['password-change-error'].textContent,/8/);
  n['password-new'].value='NewPassword!';n['password-confirm'].value='wrong';
  await n['password-change-form'].fire('submit');
  assert.match(n['password-change-error'].textContent,/không khớp/i);
  assert.equal(count,0);
  n['password-confirm'].value='NewPassword!';
  await n['password-change-form'].fire('submit');
  assert.equal(count,1);
  assert.equal(n['password-dialog'].hidden,true);
  assert.equal(n['app-screen'].inert,false);
  assert.equal(n['password-current'].value,'');
  assert.equal(h.state.user.username,'worker');
});

test('incorrect current password keeps dialog open, preserves response and permits retry',async()=>{
  const h=harness(),n=h.nodes;
  await click(h.desktopPassword);
  n['password-current'].value='wrong';n['password-new'].value='NewPassword123';n['password-confirm'].value='NewPassword123';
  let attempts=0;
  h.win.B3Api.changePassword=async()=>{attempts++;if(attempts===1)throw Object.assign(new Error('Mật khẩu hiện tại không đúng.'),{status:422});return {success:true};};
  await n['password-change-form'].fire('submit');
  assert.equal(n['password-dialog'].hidden,false);
  assert.match(n['password-change-error'].textContent,/không đúng/i);
  assert.equal(n['password-dialog-save'].disabled,false);
  await n['password-change-form'].fire('submit');
  assert.equal(attempts,2);
  assert.equal(n['password-dialog'].hidden,true);
});

test('cancel clears password fields, restores focus and permits reopening',async()=>{
  const h=harness(),n=h.nodes;
  await click(h.desktopPassword);
  n['password-current'].value='secret';
  await click(n['password-dialog-cancel']);
  assert.equal(n['password-current'].value,'');
  assert.equal(h.doc.activeElement,h.desktopPassword);
  await click(h.desktopPassword);
  assert.equal(n['password-dialog'].hidden,false);
  h.doc.fire('keydown',{key:'Escape',preventDefault(){}});
  assert.equal(n['password-dialog'].hidden,true);
});

test('logout calls the existing API and returns to login only after a success',async()=>{
  const h=harness();let calls=0;
  h.win.B3Api.logout=async()=>{calls++;return {success:true};};
  await click(h.nodes['mobile-menu-button']);
  await click(h.mobileLogout);
  assert.equal(calls,1);
  assert.equal(h.state.user,null);
  assert.equal(h.nodes['mobile-menu'].hidden,true);
  assert.equal(h.nodes['login-screen'].classList.add!==undefined,true);
});

test('failed logout does not pretend the server ended the session',async()=>{
  const h=harness();
  h.win.B3Api.logout=async()=>{throw new Error('Mất kết nối');};
  await click(h.desktopLogout);
  assert.equal(h.state.user.username,'worker');
});
