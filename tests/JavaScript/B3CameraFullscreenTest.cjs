'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
let chromium;
try{({chromium}=require(process.env.B3_PLAYWRIGHT_MODULE||'playwright'));}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}

async function ready(page){
  await page.waitForFunction(()=>window.modal?.scanner.html5QrCode?.qrRegion&&document.querySelector('.qr-lib-region video')?.readyState>=2);
}
async function geometry(page){
  return page.evaluate(()=>{
    const scanner=window.modal.scanner,region=document.querySelector('.qr-lib-region');
    const video=region.querySelector('video'),shade=region.querySelector('#qr-shaded-region');
    const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    const style=getComputedStyle(shade),r=rect(shade);
    const scaleX=r.width/parseFloat(style.width),scaleY=r.height/parseFloat(style.height);
    const guide={left:r.left+parseFloat(style.borderLeftWidth)*scaleX,right:r.right-parseFloat(style.borderRightWidth)*scaleX,
      top:r.top+parseFloat(style.borderTopWidth)*scaleY,bottom:r.bottom-parseFloat(style.borderBottomWidth)*scaleY};
    const capture=document.createElement('canvas'),ctx=capture.getContext('2d',{willReadFrequently:true});
    let crop=null;const draw=ctx.drawImage.bind(ctx);ctx.drawImage=(...args)=>{crop=args.slice(1,5);draw(...args);};
    scanner.adaptiveCanvas=capture;const image=scanner.captureVisibleQrBox();
    const native=scanner.html5QrCode.qrRegion;
    return {region:rect(region),video:rect(video),body:rect(document.querySelector('.qr-lib-body')),header:rect(document.querySelector('.qr-lib-header')),
      guide,crop,image:!!image,viewport:{width:innerWidth,height:innerHeight},ratio:video.videoWidth/video.videoHeight,
      native:[native.x*video.videoWidth/video.clientWidth,native.y*video.videoHeight/video.clientHeight,
        native.width*video.videoWidth/video.clientWidth,native.height*video.videoHeight/video.clientHeight],
      scrolling:document.querySelector('.qr-lib-body').scrollHeight>document.querySelector('.qr-lib-body').clientHeight+1,
      constraints:window.trackConstraints};
  });
}
function assertGeometry(g){
  assert.ok(g.region.bottom>=g.body.bottom-22,'camera fills the available height below the header');
  assert.ok(g.region.top>=g.header.bottom,'header remains outside the camera');
  assert.ok(g.region.width>=g.body.width-42,'camera uses the available width');
  assert.ok(g.region.bottom<=g.viewport.height,'camera fits the browser viewport');
  assert.equal(g.scrolling,false,'camera page does not scroll');
  assert.ok(g.video.left<=g.region.left+.5&&g.video.right>=g.region.right-.5&&g.video.top<=g.region.top+.5&&g.video.bottom>=g.region.bottom-.5,'video covers the viewport without a black band');
  assert.ok(Math.abs(g.video.width/g.video.height-g.ratio)<.01,'video is not stretched');
  assert.ok(Math.abs((g.guide.left+g.guide.right)/2-(g.region.left+g.region.right)/2)<2,'guide is horizontally centered');
  assert.ok(Math.abs((g.guide.top+g.guide.bottom)/2-(g.region.top+g.region.bottom)/2)<2,'guide is vertically centered');
  assert.ok(g.guide.left>=g.region.left&&g.guide.right<=g.region.right&&g.guide.top>=g.region.top&&g.guide.bottom<=g.region.bottom,'guide fits the visible camera');
  assert.ok(Math.abs(g.guide.right-g.guide.left-(g.guide.bottom-g.guide.top))<2,'guide remains square');
  assert.ok(g.image,'fallback can capture the visible guide');
  for(let i=0;i<4;i++)assert.ok(Math.abs(g.crop[i]-g.native[i])<2,'fallback and native vendor scan the same source pixels: '+JSON.stringify(g));
  assert.ok(g.constraints.every(c=>!('zoom' in c)),'display fit never changes camera zoom');
}

for(const viewport of [{width:390,height:844},{width:844,height:390},{width:1280,height:800}]){
  for(const source of [{width:1920,height:1080},{width:1080,height:1920}]){
    test(`camera fills ${viewport.width}x${viewport.height}, source ${source.width}x${source.height}`,{skip:!chromium,timeout:30000},async()=>{
      const browser=await chromium.launch({headless:true});
      try{
        const page=await browser.newPage({viewport});await page.setContent('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><body style="margin:0"></body>');
        await page.addStyleTag({content:fs.readFileSync(path.join(root,'public/css/qr-scanner/qr-camera-modal.css'),'utf8')});
        for(const file of ['lib/html5-qrcode.min.js','qr-camera-scanner.js','qr-camera-modal.js'])await page.addScriptTag({content:fs.readFileSync(path.join(root,'public/js/qr-scanner',file),'utf8')});
        await page.evaluate(async source=>{
          window.trackConstraints=[];window.streams=[];window.cameraStarts=0;
          Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{
            window.cameraStarts++;
            const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;
            const ctx=canvas.getContext('2d');ctx.fillStyle='#cbd5e1';ctx.fillRect(0,0,canvas.width,canvas.height);
            ctx.strokeStyle='#64748b';ctx.lineWidth=4;
            for(let x=0;x<canvas.width;x+=120){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke();}
            for(let y=0;y<canvas.height;y+=120){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke();}
            const stream=canvas.captureStream(5);window.streams.push(stream);
            stream.getVideoTracks()[0].getCapabilities=()=>({focusMode:['continuous']});
            stream.getVideoTracks()[0].applyConstraints=async constraints=>{
              window.trackConstraints.push(constraints);
              // The image may start playing while post-start focus tuning is pending.
              if(constraints.advanced)await new Promise(resolve=>{
                const guideReady=()=>window.modal.scanner.html5QrCode.qrRegion?resolve():requestAnimationFrame(guideReady);
                guideReady();
              });
            };
            return stream;
          }}});
          window.modal=new QrCameraModal({allowImage:false,optimizeCamera:true,mode:'continuous'});
          await window.modal.open();
        },source);
        await ready(page);assertGeometry(await geometry(page));
        if(viewport.width===390&&source.width===1920){
          const folder=path.join(root,'storage/app/verification');fs.mkdirSync(folder,{recursive:true});
          await page.screenshot({path:path.join(folder,'qr-camera-fullscreen-portrait.png')});
          const beforeSmallResize=await page.evaluate(()=>window.cameraStarts);
          await page.setViewportSize({width:395,height:844});
          await page.waitForFunction(starts=>window.cameraStarts>starts,beforeSmallResize,{timeout:2000});await ready(page);
          assertGeometry(await geometry(page));
          const starts=await page.evaluate(()=>window.cameraStarts);
          await page.setViewportSize({width:844,height:390});
          await page.waitForFunction(starts=>window.cameraStarts>starts,starts);await ready(page);
          assertGeometry(await geometry(page));
          const beforeToolbarResize=await page.evaluate(()=>window.cameraStarts);
          await page.evaluate(()=>{
            document.querySelector('.qr-lib-dialog').style.height='350px';
            window.visualViewport.dispatchEvent(new Event('resize'));
          });
          await page.waitForFunction(starts=>window.cameraStarts>starts,beforeToolbarResize);await ready(page);
          assertGeometry(await geometry(page));
        }
        await page.getByRole('button',{name:'Đóng',exact:true}).click();
        await page.waitForFunction(()=>!window.modal.isOpen&&window.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));
      }finally{await browser.close();}
    });
  }
}
