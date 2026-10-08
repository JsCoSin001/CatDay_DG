(function(){
'use strict';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const state=window.B3State; const api=window.B3Api; const PAGE_SIZE=10;
let planRequestVersion=0, worklistRequestVersion=0, planSearchTimer=null, highlightedPlanIndex=-1;
let planLoadingTimer=null, pageLoadingId=0, saveInProgress=false;
const pageLoadingTasks=new Map();
function updatePageLoading(){
    const host=$('#b3-page-loading');if(!host)return;
    const visible=Array.from(pageLoadingTasks.values()).filter(t=>t.visible);
    host.hidden=visible.length===0;
    if(visible.length){const message=$('#b3-page-loading-message');if(message)message.textContent=visible[visible.length-1].message;}
}
function beginPageLoading(message,group){
    if(group){for(const [id,task] of pageLoadingTasks){if(task.group===group){clearTimeout(task.timer);pageLoadingTasks.delete(id);}}}
    const id=++pageLoadingId, task={message,group,visible:false,timer:null};
    pageLoadingTasks.set(id,task);
    task.timer=setTimeout(()=>{if(pageLoadingTasks.get(id)!==task)return;task.visible=true;updatePageLoading();},500);
    updatePageLoading();
    return ()=>{clearTimeout(task.timer);pageLoadingTasks.delete(id);updatePageLoading();};
}
async function withPageLoading(message,work,group){
    const finish=beginPageLoading(message,group);
    try{return await work();}finally{finish();}
}
function hidePlanLoading(){clearTimeout(planLoadingTimer);planLoadingTimer=null;const host=$('#b3-plan-loading');if(host)host.hidden=true;}
function showPlanLoading(version){
    hidePlanLoading();
    planLoadingTimer=setTimeout(()=>{if(version===planRequestVersion){const host=$('#b3-plan-loading');if(host)host.hidden=false;}},500);
}
const esc=(v)=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt=(v)=>v===null||v===undefined?'':String(v);

document.addEventListener('DOMContentLoaded',init);
async function init(){bindLogin();bindAccount();bindPlanSearch();bindPagination();bindQr();bindSheet();await withPageLoading('Đang kiểm tra phiên đăng nhập...',async()=>{try{const s=await api.session();showApp(s.user);resetPlanScope();}catch(_){showLogin();}},'auth');}
// B3 popup notifications: UI-only lifecycle, independent of Bootstrap JavaScript.
const popupAlerts=[];
const POPUP_ENTER_MS=250, POPUP_EXIT_MS=180, POPUP_REPEAT_MS=2000, POPUP_MAX=3;
function popupReducedMotion(){return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;}
function popupReflow(host,mutate){
    const before=new Map();
    if(!popupReducedMotion())for(const item of popupAlerts){
        if(item.status==='visible'&&item.element.parentElement===host&&item.element.getBoundingClientRect){
            before.set(item,item.element.getBoundingClientRect().top);
        }
    }
    mutate();
    for(const [item,previousTop] of before){
        if(item.status!=='visible'||item.element.parentElement!==host||!item.element.animate)continue;
        const difference=previousTop-item.element.getBoundingClientRect().top;
        if(Math.abs(difference)>1)item.element.animate(
            [{transform:`translateY(${difference}px)`},{transform:'translateY(0)'}],
            {duration:POPUP_EXIT_MS,easing:'ease-out'}
        );
    }
}
function popupRemove(item){
    if(item.status==='removed')return;
    clearTimeout(item.enterTimer);clearTimeout(item.timer);clearTimeout(item.exitTimer);
    item.status='removed';
    const index=popupAlerts.indexOf(item);if(index!==-1)popupAlerts.splice(index,1);
    const host=item.element.parentElement;
    if(host)popupReflow(host,()=>item.element.remove());
}
function popupClose(item,immediate=false){
    if(item.status==='removed')return;
    if(item.status==='leaving'){if(immediate)popupRemove(item);return;}
    clearTimeout(item.enterTimer);clearTimeout(item.timer);
    item.timer=null;item.deadline=null;item.status='leaving';
    if(immediate||popupReducedMotion()){popupRemove(item);return;}
    item.element.classList.remove('show');
    item.element.classList.add('app-popup-alert-leaving');
    item.exitTimer=setTimeout(()=>popupRemove(item),POPUP_EXIT_MS);
}
function popupClearAll(){for(const item of [...popupAlerts])popupClose(item,true);}
function popupClock(item){
    if(item.status!=='visible')return;
    clearTimeout(item.timer);item.timer=null;
    if(item.deadline!==null)item.remaining=Math.max(0,item.deadline-Date.now());
    // An elapsed deadline wins even when a hover/focus is still active after a background tab resumes.
    if(item.remaining===0){popupClose(item,document.hidden);return;}
    if(!document.hidden&&(item.hovered||item.focused)){item.deadline=null;return;}
    if(item.deadline===null)item.deadline=Date.now()+item.remaining;
    item.timer=setTimeout(()=>popupClock(item),item.remaining);
}
document.addEventListener('visibilitychange',()=>{
    for(const item of [...popupAlerts]){
        if(!document.hidden&&item.status==='leaving'){popupClose(item,true);continue;}
        if(!document.hidden&&item.status==='visible'&&item.deadline!==null&&Date.now()>=item.deadline){
            popupClose(item,true);continue;
        }
        popupClock(item);
    }
});
function alertUser(type,msg){
    const host=$('#app-alert-host');if(!host)return;
    const kind=type==='danger'?'danger':'success', content=String(msg??'');
    const now=Date.now();
    const previous=popupAlerts.find(item=>item.status!=='leaving'&&item.status!=='removed'&&
        item.kind===kind&&item.content===content&&now-item.lastOccurrence<=POPUP_REPEAT_MS);
    if(previous){
        previous.count++;previous.lastOccurrence=now;
        previous.message.textContent=`${content} (${previous.count} lần)`;
        previous.remaining=kind==='danger'?8000:3000;previous.deadline=null;
        popupAlerts.splice(popupAlerts.indexOf(previous),1);popupAlerts.unshift(previous);
        popupReflow(host,()=>host.prepend(previous.element));
        if(previous.status==='visible')popupClock(previous);
        return;
    }
    if(popupAlerts.length>=POPUP_MAX){
        const oldestSuccess=[...popupAlerts].reverse().find(item=>item.kind==='success'&&item.status!=='leaving');
        popupClose(oldestSuccess||[...popupAlerts].reverse().find(item=>item.status!=='leaving')||popupAlerts[popupAlerts.length-1],true);
    }
    const element=document.createElement('div');
    element.className=`alert alert-${kind} alert-dismissible app-popup-alert`;
    element.setAttribute('role',kind==='danger'?'alert':'status');
    const message=document.createElement('span');message.className='app-popup-alert-message';message.textContent=content;
    const button=document.createElement('button');button.type='button';button.className='btn-close';
    button.setAttribute('aria-label','Đóng thông báo');
    element.appendChild(message);element.appendChild(button);
    const item={kind,content,count:1,lastOccurrence:now,element,message,status:'entering',
        remaining:kind==='danger'?8000:3000,deadline:null,hovered:false,focused:false,
        enterTimer:null,timer:null,exitTimer:null};
    button.addEventListener('click',()=>popupClose(item));
    element.addEventListener('mouseenter',()=>{item.hovered=true;popupClock(item);});
    element.addEventListener('mouseleave',()=>{item.hovered=false;popupClock(item);});
    element.addEventListener('focusin',()=>{item.focused=true;popupClock(item);});
    element.addEventListener('focusout',event=>{
        if(event.relatedTarget&&element.contains(event.relatedTarget))return;
        item.focused=element.contains(document.activeElement);popupClock(item);
    });
    popupAlerts.unshift(item);
    popupReflow(host,()=>host.prepend(element));
    void element.offsetWidth; // Ensure the CSS starting transform is painted before entering.
    element.classList.add('show');
    if(popupReducedMotion()){
        item.status='visible';popupClock(item);
    }else{
        item.enterTimer=setTimeout(()=>{
            if(item.status!=='entering')return;
            item.status='visible';popupClock(item);
        },POPUP_ENTER_MS);
    }
}

function showLogin(){popupClearAll();state.user=null;$('#login-screen')?.classList.remove('d-none');$('#app-screen')?.classList.add('d-none');}
function showApp(user){popupClearAll();state.user=user;$('#login-screen')?.classList.add('d-none');$('#app-screen')?.classList.remove('d-none');$('#desktop-account-name').textContent=user.name||user.username;}
function bindLogin(){const f=$('#login-form');if(!f)return;f.addEventListener('submit',async e=>{e.preventDefault();await withPageLoading('Đang đăng nhập...',async()=>{try{const r=await api.login($('#login-username').value.trim(),$('#login-password').value);showApp(r.user);resetPlanScope();}catch(err){alertUser('danger',err.message);}},'auth');});}
function resetPlanScope(){
    clearTimeout(planSearchTimer);planRequestVersion++;worklistRequestVersion++;
    state.plans=[];state.selectedPlan=null;state.showAll=false;state.worklist=[];state.page=1;
    const input=$('#plan-search');if(input)input.value='';closePlanOptions();renderTable();
}
function bindAccount(){$$('[data-action="logout"]').forEach(b=>b.addEventListener('click',async()=>withPageLoading('Đang đăng xuất...',async()=>{try{await api.logout();}finally{resetPlanScope();showLogin();}},'auth')));}
function closePlanOptions(){hidePlanLoading();const host=$('#plan-options');if(host)host.hidden=true;const input=$('#plan-search');if(input){input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}highlightedPlanIndex=-1;}
function restorePlanInput(){const input=$('#plan-search');if(input)input.value=state.showAll?'':(state.selectedPlan?.ma_ke_hoach||'');closePlanOptions();}
async function refreshPlans(q,selectExact=false){
    const term=q.trim(),version=++planRequestVersion;
    if(!term){state.plans=[];closePlanOptions();return;}
    try{
        showPlanLoading(version);
        const r=await api.plans(term);
        if(version!==planRequestVersion||$('#plan-search')?.value.trim()!==term)return;
        state.plans=(r.plans||[]).filter(p=>String(p.ma_ke_hoach).toLowerCase().includes(term.toLowerCase()));
        if(selectExact){const exact=state.plans.find(p=>String(p.ma_ke_hoach).toLowerCase()===term.toLowerCase());if(exact){selectPlan(exact);return;}}
        renderPlanOptions(term);
    }catch(e){if(version!==planRequestVersion)return;closePlanOptions();if(e.status===401)showLogin();else alertUser('danger',e.message);}
    finally{if(version===planRequestVersion)hidePlanLoading();}
}
function bindPlanSearch(){
    const input=$('#plan-search'),all=$('#search-all');if(!input)return;
    input.addEventListener('focus',()=>input.select());
    input.addEventListener('click',()=>input.select());
    input.addEventListener('input',()=>{
        clearTimeout(planSearchTimer);planRequestVersion++;closePlanOptions();
        const value=input.value.trim();if(!value){state.plans=[];return;}
        planSearchTimer=setTimeout(()=>refreshPlans(input.value),300);
    });
    input.addEventListener('keydown',e=>{
        const options=$$('.plan-option[data-id]',$('#plan-options'));
        const visible=!$('#plan-options').hidden;
        if(e.key==='Escape'){e.preventDefault();clearTimeout(planSearchTimer);planRequestVersion++;restorePlanInput();return;}
        if(e.key==='ArrowDown'||e.key==='ArrowUp'){
            if(!visible||!options.length)return;
            e.preventDefault();highlightedPlanIndex=(highlightedPlanIndex+(e.key==='ArrowDown'?1:-1)+options.length)%options.length;
            options.forEach((o,i)=>o.classList.toggle('is-highlighted',i===highlightedPlanIndex));
            input.setAttribute('aria-activedescendant',options[highlightedPlanIndex].id);
            options[highlightedPlanIndex].scrollIntoView({block:'nearest'});return;
        }
        if(e.key==='Enter'){
            e.preventDefault();
            if(visible&&highlightedPlanIndex>=0&&options[highlightedPlanIndex]){options[highlightedPlanIndex].click();return;}
            const exact=state.plans.find(p=>p.ma_ke_hoach.toLowerCase()===input.value.trim().toLowerCase());
            if(visible&&exact){selectPlan(exact);return;}
            // Enter before the debounce finishes: search, then require explicit selection.
            if(!visible&&input.value.trim()){clearTimeout(planSearchTimer);refreshPlans(input.value,true);}
        }
    });
    all?.addEventListener('click',async()=>{
        clearTimeout(planSearchTimer);planRequestVersion++;closePlanOptions();
        await changePlanScope(null,true);
    });
    document.addEventListener('click',e=>{
        if(!e.target.closest('#plan-combobox')){
            clearTimeout(planSearchTimer);planRequestVersion++;restorePlanInput();
        }
    });
}
function renderPlanOptions(q=''){
    const host=$('#plan-options'),input=$('#plan-search');if(!host||!input||!q.trim())return;
    const list=state.plans.filter(p=>String(p.ma_ke_hoach).toLowerCase().includes(q.trim().toLowerCase())).slice(0,20);
    host.innerHTML=list.map((p,i)=>`<button type="button" role="option" id="plan-option-${i}" class="plan-option" data-id="${esc(p.id)}">${esc(p.ma_ke_hoach)}</button>`).join('')||'<div class="plan-option-empty">Không tìm thấy kế hoạch phù hợp</div>';
    highlightedPlanIndex=-1;host.hidden=false;input.setAttribute('aria-expanded','true');input.removeAttribute('aria-activedescendant');
    $$('.plan-option[data-id]',host).forEach(b=>b.addEventListener('click',()=>{
        const p=state.plans.find(x=>String(x.id)===b.dataset.id);if(p)selectPlan(p);
    }));
}
async function selectPlan(plan){
    clearTimeout(planSearchTimer);planRequestVersion++;closePlanOptions();
    await changePlanScope(plan,false);
}
async function changePlanScope(plan,all){
    return withPageLoading('Đang tải danh sách kế hoạch...',async()=>{
    const previous={selectedPlan:state.selectedPlan,showAll:state.showAll,worklist:state.worklist,page:state.page};
    const version=++worklistRequestVersion;
    const input=$('#plan-search');
    try{
        const r=all?await api.allWorklist():await api.worklist(plan.id);
        if(version!==worklistRequestVersion)return;
        if(!all&&r.complete===true){
            state.plans=state.plans.filter(p=>String(p.id)!==String(plan.id));
            restorePlanInput();
            alertUser('danger','Kế hoạch đã hoàn thành, vui lòng chọn kế hoạch khác.');
            return;
        }
        if(state.showAll!==all||(!all&&String(state.selectedPlan?.id??'')!==String(plan?.id??'')))popupClearAll();
        state.selectedPlan=plan;state.showAll=all;state.worklist=r.rows||[];state.page=1;
        if(input)input.value=all?'':plan.ma_ke_hoach;
        renderTable();
    }catch(e){
        if(version!==worklistRequestVersion)return;
        state.selectedPlan=previous.selectedPlan;state.showAll=previous.showAll;
        state.worklist=previous.worklist;state.page=previous.page;
        restorePlanInput();renderTable();alertUser('danger',e.message);
    }
    },'worklist');
}
async function loadWorklist(){
    return withPageLoading('Đang tải danh sách kế hoạch...',async()=>{
    const version=++worklistRequestVersion;
    try{let r;if(state.showAll)r=await api.allWorklist();else if(state.selectedPlan)r=await api.worklist(state.selectedPlan.id);else{state.worklist=[];renderTable();return;}
        if(version!==worklistRequestVersion)return;
        state.worklist=r.rows||[];renderTable();
    }catch(e){if(version===worklistRequestVersion)alertUser('danger',e.message);}
    },'worklist');
}
function renderTable(){const body=$('#plan-table-body'),empty=$('#empty-state'),pag=$('#pagination');if(!body)return;const total=state.worklist.length,pages=Math.max(1,Math.ceil(total/PAGE_SIZE));state.page=Math.min(state.page,pages);const rows=state.worklist.slice((state.page-1)*PAGE_SIZE,state.page*PAGE_SIZE);body.innerHTML=rows.map(r=>`<tr><td>${esc(r.ma_ke_hoach)}</td><td>${esc(r.ten_san_pham)}</td><td>${esc(fmt(r.lot))}</td><td class="text-end">${esc(fmt(r.so_luong_cuon))}</td><td class="text-end">${esc(fmt(r.so_dau))}</td><td class="text-end">${esc(fmt(r.so_cuoi))}</td><td class="text-end">${esc(fmt(r.so_cuon_cat_le))}</td><td>${esc(r.tinh_trang)}</td></tr>`).join('');if(empty){empty.hidden=total>0;empty.querySelector('span').textContent='Chọn mã kế hoạch hoặc nhấn Tìm toàn bộ kế hoạch để xem công việc còn lại.';}if(pag)pag.hidden=total<=PAGE_SIZE;$('#result-summary').textContent=state.showAll?(total?`Đang xem toàn bộ kế hoạch · ${total} dòng công việc`:'Đang xem toàn bộ kế hoạch · Chưa có dữ liệu.'):(total?`${total} dòng công việc`:'Chưa có dữ liệu kế hoạch.');renderPagination(pages);}
function bindPagination(){$('#mobile-prev')?.addEventListener('click',()=>go(state.page-1));$('#mobile-next')?.addEventListener('click',()=>go(state.page+1));}
function renderPagination(pages){const h=$('#desktop-pagination');if(h){h.innerHTML='';for(let i=1;i<=pages;i++){const b=document.createElement('button');b.className='page-number'+(i===state.page?' active':'');b.textContent=i;b.onclick=()=>go(i);h.appendChild(b);}}const l=$('#mobile-page-label');if(l)l.textContent=`Trang ${state.page}/${pages}`;}
function go(p){const pages=Math.max(1,Math.ceil(state.worklist.length/PAGE_SIZE));state.page=Math.min(Math.max(1,p),pages);renderTable();}
function bindQr(){$('#open-qr')?.addEventListener('click',openScanner);}
async function openScanner(){if(!state.hasPlanScope()){alertUser('danger','Vui lòng chọn mã kế hoạch hoặc nhấn “Tìm toàn bộ kế hoạch” trước khi quét QR.');return;}if(typeof window.QrCameraModal!=='function'){alertUser('danger','Module QR chưa sẵn sàng.');return;}if(!state.singleQrModal){state.singleQrModal=new window.QrCameraModal({title:'Quét QR',subtitle:'Đưa mã QR vào khung camera',mode:'single',duplicateDelay:1500,optimizeCamera:true,allowImage:false,formats:['QR_CODE'],onResult:resolveScan,onError:e=>alertUser('danger',e?.message||'Quét QR thất bại.')});}await state.singleQrModal.open();}
async function resolveScan(raw){return withPageLoading('Đang đọc dữ liệu QR...',async()=>{try{const r=await api.resolveQr(String(raw||'').trim(),state.showAll?null:state.selectedPlan?.id||null);state.scan=r;chooseContext(r.selected_context||null);showSheet(raw);}catch(e){alertUser('danger',e.message);}},'qr');}
function chooseContext(ctx){state.context=ctx;state.action=null;state.groupId=null;state.detailId=null;state.endValue='';state.direction=1;state.firstCutConfirmed=false;if(!ctx)return;const actions=ctx.available_actions||[];state.action=actions.length===1?actions[0]:null;state.groupId=ctx.groups?.length===1?ctx.groups[0].id:null;const g=currentGroup();state.detailId=g?.details?.find(d=>!Number(d.done)&&d.selectable!==false)?.id||null;}
function bindSheet(){$('#close-bottom-sheet-x')?.addEventListener('click',closeSheet);$('#b3-cancel-action')?.addEventListener('click',closeSheet);$('#qr-bottom-sheet-backdrop')?.addEventListener('click',closeSheet);$$('[data-b3-tab]').forEach(b=>b.addEventListener('click',()=>{state.action=b.dataset.b3Tab==='whole'?'TAKE_WHOLE_REEL':(state.scan?.source?.source_type==='CUON_LE'?'CUT_PARTIAL_REEL':'CUT_FULL_REEL');if(state.action==='CUT_FULL_REEL')state.firstCutConfirmed=false;renderSheet();}));$('#b3-save-action')?.addEventListener('click',saveAction);}
function showSheet(raw){$('#qr-result-value').textContent=raw;$('#b3-continue-scan').checked=!!$('#continuous-scan')?.checked;$('#qr-bottom-sheet').hidden=false;$('#qr-bottom-sheet-backdrop').hidden=false;renderSheet();}
function closeSheet(){$('#qr-bottom-sheet').hidden=true;$('#qr-bottom-sheet-backdrop').hidden=true;}
function currentGroup(){return state.context?.groups?.find(g=>String(g.id)===String(state.groupId))||null;}
function renderSheet(){
    const src=state.scan?.source;if(!src)return;
    const contexts=state.scan.candidate_contexts||[];const scope=$('#b3-plan-scope');
    if(!state.context && contexts.length>1){
        scope.innerHTML=`<select id="b3-plan-select" class="form-select form-select-sm"><option value="">Chọn kế hoạch...</option>${contexts.map((c,i)=>`<option value="${i}">${esc(c.plan.ma_ke_hoach)}</option>`).join('')}</select>`;
        $('#b3-product-name').textContent=contexts[0]?.item?.product_name||'';$('#b3-reel-code').textContent=src.source_type==='CUON_CHAN'?(src.ma_bin||src.raw_qr):src.raw_qr;$('#b3-reel-type').textContent=src.source_type==='CUON_CHAN'?'Cuộn chẵn':'Cuộn lẻ';
        $('#b3-plan-select').onchange=e=>{if(e.target.value==='')return;chooseContext(contexts[Number(e.target.value)]);renderSheet();};
        $('#b3-tab-whole').hidden=true;$('#b3-tab-cut').hidden=true;$('#b3-tab-content').innerHTML='<section class="b3-operation-panel"><p>Vui lòng chọn phạm vi kế hoạch để tiếp tục.</p></section>';$('#b3-save-action').disabled=true;return;
    }
    const ctx=state.context;if(!ctx)return;
    if(contexts.length>1){scope.innerHTML=`<select id="b3-plan-select" class="form-select form-select-sm">${contexts.map((c,i)=>`<option value="${i}" ${c===ctx?'selected':''}>${esc(c.plan.ma_ke_hoach)}</option>`).join('')}</select>`;$('#b3-plan-select').onchange=e=>{chooseContext(contexts[Number(e.target.value)]);renderSheet();};}else scope.innerHTML=`<strong>${esc(ctx.plan.ma_ke_hoach)}</strong>`;
    $('#b3-product-name').textContent=ctx.item.product_name;$('#b3-reel-code').textContent=src.source_type==='CUON_CHAN'?(src.ma_bin||src.raw_qr):src.raw_qr;$('#b3-reel-type').textContent=src.source_type==='CUON_CHAN'?'Cuộn chẵn':'Cuộn lẻ';
    const actions=ctx.available_actions||[];const whole=$('#b3-tab-whole'),cut=$('#b3-tab-cut');whole.hidden=!actions.includes('TAKE_WHOLE_REEL');cut.hidden=!actions.some(a=>a.startsWith('CUT_'));whole.classList.toggle('active',state.action==='TAKE_WHOLE_REEL');cut.classList.toggle('active',!!state.action&&state.action!=='TAKE_WHOLE_REEL');whole.setAttribute('aria-selected',state.action==='TAKE_WHOLE_REEL'?'true':'false');cut.setAttribute('aria-selected',state.action&&state.action!=='TAKE_WHOLE_REEL'?'true':'false');
    const host=$('#b3-tab-content');if(!state.action){host.innerHTML='<section class="b3-operation-panel"><p>Vui lòng chọn loại thao tác cần thực hiện.</p></section>';$('#b3-save-action').disabled=true;return;}$('#b3-save-action').disabled=false;if(state.action==='TAKE_WHOLE_REEL')renderWhole(host,ctx);else renderCut(host,ctx,src);
}
function renderWhole(host,ctx){const left=Math.max(0,ctx.item.whole_required-ctx.item.whole_done);host.innerHTML=`<section class="b3-operation-panel"><div class="b3-operation-heading"><span class="b3-operation-kicker">LẤY NGUYÊN CUỘN</span><h3>${esc(ctx.item.product_name)}</h3></div><div class="b3-value-list"><div><span>Kế hoạch</span><strong>${ctx.item.whole_required} cuộn</strong></div><div><span>Đã lấy</span><strong>${ctx.item.whole_done} cuộn</strong></div><div><span>Còn lại</span><strong>${left} cuộn</strong></div><div><span>Lần này</span><strong>1 cuộn</strong></div></div></section>`;}
function renderCut(host,ctx,src){if(src.source_type==='CUON_CHAN'&&!state.firstCutConfirmed){host.innerHTML='<section class="b3-operation-panel b3-first-cut-waiting" aria-hidden="true"></section>';showFirstCutDecisionOverlay();return;}const groups=ctx.groups||[];if(groups.length>1&&!state.groupId){host.innerHTML=`<section class="b3-operation-panel"><div class="b3-operation-heading"><span class="b3-operation-kicker">CẮT LẺ</span><h3>${esc(ctx.item.product_name)}</h3></div><label class="b3-input-block"><span>Nhóm cần thực hiện</span><select id="b3-group-select" class="form-select app-control"><option value="">Chọn nhóm...</option>${groups.map(x=>`<option value="${x.id}">${x.details.filter(y=>!Number(y.done)).map(y=>y.ChieuDaiCanCat).join(';')}</option>`).join('')}</select></label><p class="b3-inline-note">Có nhiều nhóm phù hợp. Vui lòng chọn nhóm trước khi chọn chiều dài cần cắt.</p></section>`;$('#b3-group-select').onchange=e=>{if(!e.target.value)return;state.groupId=Number(e.target.value);state.detailId=null;renderSheet();};$('#b3-save-action').disabled=true;return;}const g=currentGroup();if(!g){host.innerHTML='<div class="b3-complete-state">Không còn nhóm cắt phù hợp.</div>';$('#b3-save-action').disabled=true;return;}$('#b3-save-action').disabled=false;if(!state.detailId||!g.details.some(d=>String(d.id)===String(state.detailId)&&!Number(d.done)&&d.selectable!==false))state.detailId=g.details.find(d=>!Number(d.done)&&d.selectable!==false)?.id||null;const d=g.details.find(x=>String(x.id)===String(state.detailId));const groupSelect=groups.length>1?`<label class="b3-input-block"><span>Nhóm cần thực hiện</span><select id="b3-group-select" class="form-select app-control">${groups.map(x=>`<option value="${x.id}" ${String(x.id)===String(state.groupId)?'selected':''}>${x.details.filter(y=>!Number(y.done)).map(y=>y.ChieuDaiCanCat).join(';')}</option>`).join('')}</select></label>`:'';const detailSelect=`<label class="b3-input-block"><span>Chiều dài cần cắt</span><select id="b3-cut-detail-select" class="form-select app-control">${g.details.map(x=>`<option value="${x.id}" ${String(x.id)===String(state.detailId)?'selected':''} ${Number(x.done)||x.selectable===false?'disabled':''}>${x.ChieuDaiCanCat} m${Number(x.done)?' · Đã thực hiện':x.selectable===false?' · Không đủ chiều dài':''}</option>`).join('')}</select></label>`;let input='';if(src.source_type==='CUON_CHAN'){input=`<label class="b3-input-block"><span>Số cuối</span><input id="b3-end-value-input" type="number" class="form-control app-control" value="${esc(state.endValue)}"></label><label class="b3-input-block"><span>Chiều</span><select id="b3-direction-select" class="form-select app-control"><option value="1" ${state.direction===1?'selected':''}>Chiều thuận</option><option value="-1" ${state.direction===-1?'selected':''}>Chiều nghịch</option></select></label>`;}else{input=`<div class="b3-value-list compact"><div><span>Số đầu</span><strong>${src.partial.SoDau}</strong></div><div><span>Số cuối</span><strong>${src.partial.SoCuoi}</strong></div></div>`;}const preview=d?previewHtml(src,d):'';host.innerHTML=`<section class="b3-operation-panel"><div class="b3-operation-heading"><span class="b3-operation-kicker">CẮT LẺ</span><h3>${esc(ctx.item.product_name)}</h3></div><div class="b3-cut-layout"><div class="b3-cut-main">${groupSelect}${detailSelect}${input}${preview}</div><aside class="b3-cut-side"><section class="b3-detail-list"><h4>Các đoạn trong nhóm</h4><ul>${g.details.map(x=>`<li class="b3-detail-row ${Number(x.done)?'is-done':String(x.id)===String(state.detailId)?'is-selected':''}"><span>${Number(x.done)?'✓':'•'}</span><span>${x.ChieuDaiCanCat} m</span><small>${Number(x.done)?'Đã thực hiện':x.selectable===false?'Không đủ chiều dài':'Chưa thực hiện'}</small></li>`).join('')}</ul></section></aside></div></section>`;$('#b3-group-select')?.addEventListener('change',e=>{state.groupId=Number(e.target.value);state.detailId=null;renderSheet();});$('#b3-cut-detail-select')?.addEventListener('change',e=>{state.detailId=Number(e.target.value);renderSheet();});$('#b3-end-value-input')?.addEventListener('input',e=>{state.endValue=e.target.value;renderSheet();});$('#b3-direction-select')?.addEventListener('change',e=>{state.direction=Number(e.target.value);renderSheet();});}

function showFirstCutDecisionOverlay(){if($('#b3-first-cut-decision-overlay'))return;const overlay=document.createElement('div');overlay.id='b3-first-cut-decision-overlay';overlay.className='b3-decision-overlay';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.innerHTML=`<section class="b3-decision-card" data-b3-ui-purpose="confirm-first-cut-from-whole-reel"><div class="b3-decision-kicker">CẮT LẺ · CUỘN CHẴN</div><h2 id="b3-first-cut-decision-title">Cuộn vừa quét là cuộn chẵn</h2><p class="b3-decision-question">Bạn có muốn sử dụng cuộn này để bắt đầu cắt lẻ không?</p><p class="b3-decision-help">Nếu chọn “Không, quét lại”, màn hình sẽ quay trở lại quét QR.</p><div class="b3-decision-actions"><button id="b3-first-cut-no" type="button" class="btn b3-first-cut-cancel">Không, quét lại</button><button id="b3-first-cut-yes" type="button" class="btn b3-first-cut-continue">Tiếp tục cắt lẻ</button></div></section>`;document.body.appendChild(overlay);$('#b3-first-cut-no').onclick=async()=>{overlay.remove();closeSheet();await openScanner();};$('#b3-first-cut-yes').onclick=()=>{state.firstCutConfirmed=true;overlay.remove();renderSheet();};}

function previewHtml(src,d){if(src.source_type!=='CUON_CHAN'||state.endValue==='')return'';const v=Number(state.endValue)-state.direction*Number(d.ChieuDaiCanCat);return `<div id="b3-after-cut-card" class="b3-after-cut-card ${v<0?'is-error':''}" aria-live="polite"><span class="b3-after-cut-label">SỐ ĐẦU SAU CẮT</span><strong id="b3-after-cut-value">${v<0?'LỖI':v}</strong><small id="b3-after-cut-note">${v<0?'Kiểm tra lại số cuối · Số đầu sau cắt phải lớn hơn hoặc bằng 0.':'Giá trị xem trước trên UI · logic thật sẽ do server tính/kiểm tra lại.'}</small></div>`;}
async function saveAction(){const ctx=state.context;if(!ctx||saveInProgress)return;saveInProgress=true;const saveButton=$('#b3-save-action');if(saveButton)saveButton.disabled=true;try{return await withPageLoading('Đang lưu dữ liệu...',async()=>{try{let r;if(state.action==='TAKE_WHOLE_REEL'){r=await api.takeWhole({raw_qr:state.scan.source.raw_qr,ke_hoach_id:ctx.plan.id,ke_hoach_hang_id:ctx.item.id,operation_token:state.scan.operation_token});}else{if(!state.groupId||!state.detailId)throw new Error('Vui lòng chọn nhóm và chiều dài cần cắt.');const p={raw_qr:state.scan.source.raw_qr,ke_hoach_id:ctx.plan.id,ke_hoach_hang_id:ctx.item.id,group_id:state.groupId,detail_id:state.detailId,operation_token:state.scan.operation_token};if(state.scan.source.source_type==='CUON_CHAN'){if(state.endValue==='')throw new Error('Vui lòng nhập số cuối.');const det=currentGroup()?.details?.find(x=>String(x.id)===String(state.detailId));const pv=Number(state.endValue)-state.direction*Number(det?.ChieuDaiCanCat||0);if(pv<0)throw new Error('Lỗi - kiểm tra lại số cuối. Số đầu sau cắt phải lớn hơn hoặc bằng 0.');p.end_value=Number(state.endValue);p.direction=state.direction;}r=await api.cut(p);}alertUser('success','Lưu thành công.');closeSheet();if(r?.plan_complete){state.plans=state.plans.filter(x=>String(x.id)!==String(r.plan_id));if(state.selectedPlan&&String(state.selectedPlan.id)===String(r.plan_id)){state.selectedPlan=null;const input=$('#plan-search');if(input)input.value='';}if(state.showAll)await loadWorklist();else{state.worklist=[];renderTable();}}else{await loadWorklist();}if($('#b3-continue-scan')?.checked||$('#continuous-scan')?.checked)setTimeout(openScanner,200);}catch(e){alertUser('danger',e.message);if(e.code==='STALE_DATA'||e.code==='DETAIL_ALREADY_DONE'||e.code==='DUPLICATE_REQUEST'){closeSheet();await loadWorklist();}}},'save');}finally{saveInProgress=false;if(saveButton&&!$('#qr-bottom-sheet')?.hidden)saveButton.disabled=false;}}
})();
