'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../../public/js/qr-scanner/qr-camera-scanner.js'),'utf8');

function harness({Camera=class{async start(){}async stop(){}async clear(){}},options={},decode=()=>null}={}){
  let now=0,nextId=0;const timers=new Map();
  const target={id:'camera',innerHTML:'',querySelector:()=>null};
  const window={Html5Qrcode:Camera,jsQR:()=>null,performance:{now:()=>now},
    QrImageDecoder:class{decodeCameraFrame(frame){return decode(frame,{advance(ms){now+=ms;},timers});}}};
  const setTimeout=(callback,delay)=>{const id=++nextId;timers.set(id,{callback,delay});return id;};
  vm.runInNewContext(source,{window,document:{getElementById:()=>target},setTimeout,clearTimeout:id=>timers.delete(id)});
  const scanner=new window.QrCameraScanner({elementId:'camera',emitEvents:false,...options});
  scanner.captureVisibleQrBox=()=>({width:640,height:640,data:new Uint8ClampedArray(4)});
  return {scanner,timers,window,run(){const [id,job]=timers.entries().next().value;timers.delete(id);now+=job.delay;job.callback();}};
}

test('adaptive defaults start after 250 ms and repeat after 300 ms; explicit options stay supported',()=>{
  const h=harness();assert.equal(h.scanner.options.adaptiveDelay,250);assert.equal(h.scanner.options.adaptiveInterval,300);
  const custom=harness({options:{adaptiveDelay:0,adaptiveInterval:350}}).scanner;
  assert.equal(custom.options.adaptiveDelay,0);assert.equal(custom.options.adaptiveInterval,1000,'preserve the existing explicit-option clamp; only defaults change');
  assert.equal(harness({options:{adaptiveInterval:1500}}).scanner.options.adaptiveInterval,1500);
});

test('adaptive frames schedule only after the previous decode returns and stop cancels pending work',async()=>{
  let calls=0;const h=harness({decode:(_frame,{advance,timers})=>{calls++;assert.equal(timers.size,0);advance(40);return null;}});
  h.scanner.running=true;h.scanner.sessionId=1;h.scanner.startAdaptiveScanning(1);
  assert.equal([...h.timers.values()][0].delay,250);h.run();
  assert.equal(calls,1);assert.equal(h.timers.size,1);assert.equal([...h.timers.values()][0].delay,300);
  h.run();assert.equal(calls,2);await h.scanner.stop();assert.equal(h.timers.size,0);
});

test('adaptive frames back off after slow decoding instead of keeping a short interval',()=>{
  const h=harness({decode:(_frame,{advance})=>{advance(120);return null;}});
  h.scanner.running=true;h.scanner.sessionId=1;h.scanner.startAdaptiveScanning(1);h.run();
  assert.equal([...h.timers.values()][0].delay,480);
});

test('disableFlip is enabled for primary and relaxed configurations',async()=>{
  const calls=[];class Camera{async start(camera,config){calls.push(config);if(config.aspectRatio)throw Error('unsupported square');}async stop(){}async clear(){}}
  const {scanner}=harness({Camera,options:{adaptiveScan:false,optimizeCamera:false}});await scanner.start();
  assert.ok(calls.some(c=>c.aspectRatio===1));assert.ok(calls.some(c=>!c.aspectRatio));
  assert.ok(calls.every(c=>c.disableFlip===true));await scanner.stop();
});

test('camera requests ideal resolution and keeps facingMode in videoConstraints',async()=>{
  const calls=[];class Camera{async start(camera,config){calls.push({camera,config});}async stop(){}async clear(){}}
  const {scanner}=harness({Camera,options:{adaptiveScan:false,optimizeCamera:false}});await scanner.start();
  const c=calls[0];assert.equal(c.camera.facingMode,'environment');assert.equal(c.config.videoConstraints.facingMode,'environment');
  assert.equal(c.config.videoConstraints.width.ideal,1920);assert.equal(c.config.videoConstraints.height.ideal,1080);
  assert.equal(c.config.videoConstraints.width.exact,undefined);assert.equal(c.config.aspectRatio,1);await scanner.stop();
});

test('resolution rejection retries the original config before changing the camera fallback stage',async()=>{
  const calls=[];class Camera{async start(camera,config){calls.push({camera,config});if(config.videoConstraints)throw Error('resolution unsupported');}async stop(){}async clear(){}}
  const {scanner}=harness({Camera,options:{adaptiveScan:false,optimizeCamera:false}});await scanner.start();
  assert.equal(calls.length,2);assert.ok(calls[0].config.videoConstraints);assert.equal(calls[1].config.videoConstraints,undefined);
  assert.equal(calls[1].config.aspectRatio,1);assert.equal(calls[1].camera.facingMode,'environment');await scanner.stop();
});

test('closing during a rejected high-resolution start prevents the legacy retry',async()=>{
  let rejectStart;let calls=0;
  class Camera{start(){calls++;return new Promise((_resolve,reject)=>{rejectStart=reject;});}async stop(){}async clear(){}}
  const {scanner}=harness({Camera,options:{adaptiveScan:false,optimizeCamera:false}});
  const starting=scanner.start();const closing=scanner.stop();rejectStart(Error('resolution failed after close'));
  await assert.rejects(starting);await closing;
  assert.equal(calls,1);assert.equal(scanner.running,false);
});

test('all old fallback stages remain ordered, and deviceId is copied into high-resolution constraints',async()=>{
  const calls=[];let enumeration=0;
  class Camera{
    async start(camera,config){calls.push({camera,config});if(typeof camera!=='string')throw Error('try another configuration');}
    static async getCameras(){enumeration++;return [{id:'rear-id',label:'Back camera'}];}async stop(){}async clear(){}
  }
  const {scanner}=harness({Camera,options:{adaptiveScan:false,optimizeCamera:false}});await scanner.start();
  assert.equal(enumeration,1);assert.equal(calls.length,7);
  assert.deepEqual(calls.slice(0,4).map(c=>c.camera.facingMode),['environment','environment','environment','environment']);
  assert.equal(calls[4].config.videoConstraints.deviceId.exact,'rear-id');assert.equal(calls[5].camera.deviceId.exact,'rear-id');
  assert.equal(calls[6].camera,'rear-id');assert.equal(calls[6].config.videoConstraints.deviceId.exact,'rear-id');await scanner.stop();
});
