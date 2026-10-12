'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const js=fs.readFileSync(path.resolve(__dirname,'../../public/js/qr-scanner/qr-camera-scanner.js'),'utf8');

test('permission denial does not trigger camera fallback prompts and has guidance',async()=>{
 let attempts=0;const events=[];
 class Camera{async start(){attempts++;const e=Error('Permission denied');e.name='NotAllowedError';throw e;} async stop(){}async clear(){}}
 const target={id:'camera',innerHTML:''};
 const window={Html5Qrcode:Camera};
 const document={getElementById:()=>target,dispatchEvent(){}};
 const ctx=vm.createContext({window,document,console,setTimeout,clearTimeout,CustomEvent:class{}});
 vm.runInContext(js,ctx);
 const scanner=new window.QrCameraScanner({elementId:'camera',onError:e=>events.push(e)});
 await assert.rejects(scanner.start());
 assert.equal(attempts,1,'a denial must not cause more prompts from fallback configurations');
 assert.match(events.at(-1).message,/cài đặt|quyền camera/i);
});
