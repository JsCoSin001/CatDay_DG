'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
let chromium;
try{({chromium}=require(process.env.B3_PLAYWRIGHT_MODULE||'playwright'));}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
for(const rejectResolution of [false,true])test(`actual local vendor camera constraints and guide mapping (resolution fallback=${rejectResolution})`,{skip:!chromium,timeout:20000},async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();await page.setContent('<!doctype html><div class="qr-lib-modal"><div class="qr-lib-dialog"><div class="qr-lib-body"><div id="camera" class="qr-lib-region" style="width:320px"></div></div></div></div>');
    await page.addStyleTag({content:fs.readFileSync(path.join(root,'public/css/qr-scanner/qr-camera-modal.css'),'utf8')});
    await page.addScriptTag({content:fs.readFileSync(path.join(root,'public/js/qr-scanner/lib/html5-qrcode.min.js'),'utf8')});
    await page.addScriptTag({content:fs.readFileSync(path.join(root,'public/js/qr-scanner/qr-camera-scanner.js'),'utf8')});
    const result=await page.evaluate(async rejectResolution=>{
      const requests=[],trackConstraints=[],streams=[];
      Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async request=>{
        requests.push(request);
        if(rejectResolution&&request.video.width)throw new DOMException('Unsupported resolution','OverconstrainedError');
        const canvas=document.createElement('canvas');canvas.width=request.video.width?1920:640;canvas.height=request.video.height?1080:480;
        const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
        const stream=canvas.captureStream(5);streams.push(stream);
        stream.getVideoTracks()[0].applyConstraints=async constraints=>{trackConstraints.push(constraints);};
        return stream;
      }}});
      const scanner=new QrCameraScanner({elementId:'camera',adaptiveScan:false,optimizeCamera:false,emitEvents:false});
      try{
        await scanner.start();
        // The vendor resolves start() before its onRenderSurfaceReady callback.
        await new Promise((resolve,reject)=>{
          const deadline=performance.now()+5000;
          const ready=()=>scanner.html5QrCode.qrRegion?resolve():performance.now()>deadline?reject(new Error('Vendor guide was not initialized')):requestAnimationFrame(ready);
          ready();
        });
        const video=document.querySelector('#camera video');
        const vendorRegion=scanner.html5QrCode.qrRegion;
        const capture=document.createElement('canvas'),ctx=capture.getContext('2d',{willReadFrequently:true});
        let draw=null;const drawImage=ctx.drawImage.bind(ctx);ctx.drawImage=(...args)=>{draw=args.slice(1);drawImage(...args);};
        scanner.adaptiveCanvas=capture;
        const image=scanner.captureVisibleQrBox();
        return {requests,trackConstraints,video:{width:video.videoWidth,height:video.videoHeight,clientWidth:video.clientWidth,clientHeight:video.clientHeight},
          expected:[vendorRegion.x*video.videoWidth/video.clientWidth,vendorRegion.y*video.videoHeight/video.clientHeight,
            vendorRegion.width*video.videoWidth/video.clientWidth,vendorRegion.height*video.videoHeight/video.clientHeight],
          crop:draw,image:image?{width:image.width,height:image.height}:null};
      }finally{await scanner.stop();for(const stream of streams)for(const track of stream.getTracks())track.stop();}
    },rejectResolution);
    assert.equal(result.requests[0].video.facingMode,'environment');assert.equal(result.requests[0].video.width.ideal,1920);
    assert.equal(result.requests.length,rejectResolution?2:1);
    if(rejectResolution)assert.equal(result.requests[1].video.width,undefined);
    assert.ok(result.trackConstraints.some(c=>c.aspectRatio===1),'original square aspect request is retained');
    assert.ok(result.image,'guide remains capturable');
    for(let i=0;i<4;i++)assert.ok(Math.abs(result.crop[i]-result.expected[i])<=0.1,'fallback crop equals native vendor QR region: '+JSON.stringify(result));
    assert.equal(result.image.width,Math.min(640,Math.round(result.expected[2])));
    assert.equal(result.image.width,result.image.height);
  }finally{await browser.close();}
});
