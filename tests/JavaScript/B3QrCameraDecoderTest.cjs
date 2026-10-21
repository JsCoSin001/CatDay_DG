'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
const source=fs.readFileSync(path.join(root,'public/js/qr-scanner/qr-image-decoder.js'),'utf8');
function harness(decode){
  let clock=0;const window={jsQR:(...args)=>decode(...args),performance:{now:()=>clock}};
  class ImageData{constructor(data,width,height){Object.assign(this,{data,width,height});}}
  vm.runInNewContext(source,{window,ImageData,Uint8ClampedArray});
  const decoder=new window.QrImageDecoder();
  decoder.scaleImageData=(data,scale)=>new ImageData(data.data,Math.round(data.width*scale),Math.round(data.height*scale));
  return {decoder,advance(ms){clock+=ms;}};
}
const frame=side=>({width:side,height:side,data:new Uint8ClampedArray([0,0,0,255])});

test('camera decoder tries original then 2x on a small crop and stops at success',()=>{
  const seen=[];const h=harness((_data,width,height)=>{seen.push([width,height]);return seen.length===2?{data:'QR-SMALL'}:null;});
  assert.equal(h.decoder.decodeCameraFrame(frame(117)),'QR-SMALL');
  assert.deepEqual(seen,[[117,117],[234,234]]);
});
test('camera decoder never enlarges a 640px crop or does extra work after original succeeds',()=>{
  const h=harness(()=>({data:'QR-ORIGINAL'}));h.decoder.scaleImageData=()=>{throw Error('unexpected upscale');};
  assert.equal(h.decoder.decodeCameraFrame(frame(117)),'QR-ORIGINAL');
  const large=harness(()=>null);large.decoder.scaleImageData=()=>{throw Error('unexpected upscale');};
  assert.equal(large.decoder.decodeCameraFrame(frame(640)),null);
});
test('camera decoder stops remaining candidates after its cooperative time budget',()=>{
  let calls=0;let h;h=harness(()=>{calls++;h.advance(70);return null;});
  h.decoder.decodeCameraFrame(frame(117));assert.equal(calls,2,'two 70ms calls exhaust the 120ms budget');
});

let chromium;
try{({chromium}=require(process.env.B3_PLAYWRIGHT_MODULE||'playwright'));}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
test('real jsQR compares the user JPG, smoothing modes and 640px frame cost',{skip:!chromium,timeout:60000},async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();await page.setContent('<!doctype html><body></body>');
    await page.addScriptTag({content:fs.readFileSync(path.join(root,'public/js/qr-scanner/lib/jsQR.js'),'utf8')});
    await page.addScriptTag({content:source});
    const sample=fs.readFileSync(path.join(root,'tests/fixtures/qr/user-small-117x114.jpg'));
    const report=await page.evaluate(async dataUrl=>{
      const image=new Image();image.src=dataUrl;await image.decode();
      const decoder=new QrImageDecoder();
      const canvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
      const src=canvas(image.naturalWidth,image.naturalHeight);src.getContext('2d').drawImage(image,0,0);
      const original=src.getContext('2d').getImageData(0,0,src.width,src.height);
      const enlarge=(input,smoothing)=>{
        const from=canvas(input.width,input.height);from.getContext('2d').putImageData(input,0,0);
        const to=canvas(input.width*2,input.height*2),ctx=to.getContext('2d');ctx.imageSmoothingEnabled=smoothing;
        ctx.drawImage(from,0,0,to.width,to.height);return ctx.getImageData(0,0,to.width,to.height);
      };
      const legacyBuilders=input=>[()=>input,()=>decoder.createGrayscaleBoostVariant(input),()=>decoder.createHighContrastVariant(input),()=>decoder.createThresholdVariant(input,140)];
      const tryBuilders=builders=>{for(const build of builders){const d=build(),r=jsQR(d.data,d.width,d.height,{inversionAttempts:'dontInvert'});if(r?.data)return r.data.trim();}return null;};
      const legacy=input=>tryBuilders(legacyBuilders(input));
      const experimental=(input,smoothing)=>tryBuilders([()=>input,()=>enlarge(input,smoothing),...legacyBuilders(input).slice(1)]);
      const decodedOriginal={legacy:legacy(original),nearest:experimental(original,false),smooth:experimental(original,true),production:decoder.decodeCameraFrame(original)};
      const staticValue=await decoder.decodeFile(await (await fetch(dataUrl)).blob());
      const cases=[],modes={legacy:input=>legacy(input),nearest:input=>experimental(input,false),smooth:input=>experimental(input,true),production:input=>decoder.decodeCameraFrame(input)};
      // Render into a larger camera frame, then crop the same centered guide region.
      for(const roi of [256,360])for(const width of [117,108,99,90,81,72])for(const blur of [0,0.25,0.5,0.75])for(const offset of [0,0.35]){
        const full=canvas(640,480),ctx=full.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,640,480);
        const height=width*src.height/src.width;ctx.filter='blur('+blur+'px)';ctx.drawImage(src,320-width/2+offset,240-height/2+offset,width,height);
        const crop=ctx.getImageData((640-roi)/2,(480-roi)/2,roi,roi);const outcome={roi,width,blur,offset,kind:width<90||blur>0.5?'stress':'mild'};
        for(const [mode,decode] of Object.entries(modes)){
          const started=performance.now();outcome[mode]={value:decode(crop),ms:performance.now()-started};
        }
        cases.push(outcome);
      }
      const summary={};for(const mode of Object.keys(modes)){
        const times=cases.map(c=>c[mode].ms).sort((a,b)=>a-b);
        summary[mode]={successes:cases.filter(c=>c[mode].value).length,total:cases.length,
          mild:{successes:cases.filter(c=>c.kind==='mild'&&c[mode].value).length,total:cases.filter(c=>c.kind==='mild').length},
          stress:{successes:cases.filter(c=>c.kind==='stress'&&c[mode].value).length,total:cases.filter(c=>c.kind==='stress').length},
          medianMs:times[Math.floor(times.length/2)],p95Ms:times[Math.floor(times.length*.95)],maxMs:times.at(-1)};
      }
      const large=canvas(640,640),ctx=large.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,640,640);ctx.filter='blur(0.4px)';ctx.drawImage(src,260.25,263.25,105,102.3);
      const input640=ctx.getImageData(0,0,640,640),timings=[];
      for(let i=0;i<12;i++){const start=performance.now();decoder.decodeCameraFrame(input640);timings.push(performance.now()-start);}
      timings.sort((a,b)=>a-b);
      return {sample:{width:src.width,height:src.height},decodedOriginal,staticValue,summary,
        frame640:{medianMs:timings[6],p95Ms:timings[11],maxMs:timings[11]},cases};
    },'data:image/jpeg;base64,'+sample.toString('base64'));
    assert.deepEqual(report.sample,{width:117,height:114});
    const values=[...Object.values(report.decodedOriginal),...report.cases.flatMap(c=>['legacy','nearest','smooth','production'].map(m=>c[m].value))].filter(Boolean);
    const expected='cuontp;265098;100;20261021;202610210959100006;GOLDCUP; TCVN 6610-3/IEC 60227-3; 450/750V Cu/PVC 70ºC 1x50 SQMM';
    for(const value of Object.values(report.decodedOriginal))assert.equal(value,expected,'original sample remains readable');
    assert.equal(report.staticValue,expected,'static file path remains readable with default scaling');
    for(const value of values)assert.equal(value,expected,'never count an unrelated/wrong decode as a success');
    const folder=path.join(root,'storage/app/verification');fs.mkdirSync(folder,{recursive:true});
    fs.writeFileSync(path.join(folder,'qr-small-camera-benchmark.json'),JSON.stringify(report,null,2));
    console.log('SMALL_QR_BENCHMARK '+JSON.stringify({sample:report.sample,decodedOriginal:report.decodedOriginal,summary:report.summary,frame640:report.frame640}));
    // Success rate is evidence, not a forced assertion of improvement.
    assert.equal(report.summary.production.total,96);
  }finally{await browser.close();}
});
