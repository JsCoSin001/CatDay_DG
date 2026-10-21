(function(){
'use strict';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const state=window.B3State; const api=window.B3Api; const PAGE_SIZE=10;
let planRequestVersion=0, worklistRequestVersion=0, planInputRevision=0, planSearchTimer=null, highlightedPlanIndex=-1;
let planLoadingTimer=null, pageLoadingId=0, saveInProgress=false, scanOpening=false;
let resultPageOpen=false, resultNavigation=null, scanResolveVersion=0;
let closeQrErrorMessage=null;
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
const productCollator=new Intl.Collator('vi',{sensitivity:'base'});
const planCollator=new Intl.Collator('vi',{sensitivity:'base',numeric:true});
function worklistStatus(row){
    const raw=String(row.tinh_trang||'').trim();
    let rank=1,name='pending',label='Chưa thực hiện';
    if(row.completed||/^(Hoàn thành|Đã thực hiện)/i.test(raw)){
        rank=2;name='done';label='Đã thực hiện';
    }else if(/^Đang thực hiện/i.test(raw)){
        rank=0;name='progress';label='Đang thực hiện';
    }
    const count=raw.match(/\(\d+\/\d+\)\s*$/);
    return {rank,name,label:label+(count?' '+count[0].trim():'')};
}
function sortWorklist(rows){
    return rows.slice().sort((a,b)=>worklistStatus(a).rank-worklistStatus(b).rank
        ||productCollator.compare(String(a.ten_san_pham||''),String(b.ten_san_pham||''))
        ||planCollator.compare(String(a.ma_ke_hoach||''),String(b.ma_ke_hoach||'')));
}
function statusBadge(row){
    const status=worklistStatus(row);
    return '<span class="badge b3-status-badge b3-status-'+status.name+'">'+esc(status.label)+'</span>';
}

document.addEventListener('DOMContentLoaded',init);
async function init(){bindLogin();bindAccount();bindPlanSearch();bindPagination();bindQr();bindResultPage();const version=scanResolveVersion;await withPageLoading('Đang kiểm tra phiên đăng nhập...',async()=>{try{const s=await api.session();if(version!==scanResolveVersion)return;showApp(s.user);resetPlanScope();}catch(_){if(version===scanResolveVersion)showLogin();}},'auth');}
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

function showLogin(){++scanResolveVersion;popupClearAll();closeResultPage({force:true});state.user=null;updateQrControls();$('#login-screen')?.classList.remove('d-none');$('#app-screen')?.classList.add('d-none');}
function showApp(user){popupClearAll();state.user=user;updateQrControls();$('#login-screen')?.classList.add('d-none');$('#app-screen')?.classList.remove('d-none');$('#desktop-account-name').textContent=user.name||user.username;}
function bindLogin(){const f=$('#login-form');if(!f)return;f.addEventListener('submit',async e=>{e.preventDefault();++scanResolveVersion;await withPageLoading('Đang đăng nhập...',async()=>{try{const r=await api.login($('#login-username').value.trim(),$('#login-password').value);showApp(r.user);resetPlanScope();}catch(err){alertUser('danger',err.message);}},'auth');});}
function resetPlanScope(){
    clearTimeout(planSearchTimer);planRequestVersion++;worklistRequestVersion++;scanResolveVersion++;
    state.plans=[];state.selectedPlan=null;state.showAll=false;state.worklist=[];state.page=1;
    state.worklistReady=false;state.worklistLoading=false;state.planInputDirty=false;updateQrControls();
    const input=$('#plan-search');if(input)input.value='';closePlanOptions();renderTable();
}
function bindAccount(){$$('[data-action="logout"]').forEach(b=>b.addEventListener('click',async()=>withPageLoading('Đang đăng xuất...',async()=>{try{await api.logout();}finally{resetPlanScope();showLogin();}},'auth')));}
function closePlanOptions(){hidePlanLoading();const host=$('#plan-options');if(host)host.hidden=true;const input=$('#plan-search');if(input){input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}highlightedPlanIndex=-1;}
function restorePlanInput(){const input=$('#plan-search');if(input)input.value=state.showAll?'':(state.selectedPlan?.ma_ke_hoach||'');state.planInputDirty=false;updateQrControls();closePlanOptions();}
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
        clearTimeout(planSearchTimer);planRequestVersion++;planInputRevision++;closePlanOptions();
        const expected=state.showAll?'':(state.selectedPlan?.ma_ke_hoach||'');
        state.planInputDirty=input.value.trim().toLowerCase()!==expected.toLowerCase();updateQrControls();
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
    ++scanResolveVersion;
    state.worklistLoading=true;state.worklistReady=false;updateQrControls();
    return withPageLoading('Đang tải danh sách kế hoạch...',async()=>{
    const previous={selectedPlan:state.selectedPlan,showAll:state.showAll,worklist:state.worklist,page:state.page};
    const version=++worklistRequestVersion;
    const input=$('#plan-search'),inputRevisionAtStart=planInputRevision;
    try{
        const r=all?await api.allWorklist():await api.worklist(plan.id);
        if(version!==worklistRequestVersion)return;
        if(state.showAll!==all||(!all&&String(state.selectedPlan?.id??'')!==String(plan?.id??'')))popupClearAll();
        state.selectedPlan=plan;state.showAll=all;state.worklist=sortWorklist(r.rows||[]);state.page=1;state.worklistReady=true;
        const editedWhileLoading=planInputRevision!==inputRevisionAtStart&&state.planInputDirty;
        if(input&&!editedWhileLoading)input.value=all?'':plan.ma_ke_hoach;
        const expected=all?'':plan.ma_ke_hoach;
        state.planInputDirty=!!input&&input.value.trim().toLowerCase()!==expected.toLowerCase();
        renderTable();
    }catch(e){
        if(version!==worklistRequestVersion)return;
        state.selectedPlan=previous.selectedPlan;state.showAll=previous.showAll;
        state.worklist=previous.worklist;state.page=previous.page;
        restorePlanInput();renderTable();alertUser('danger',e.message);
    }finally{if(version===worklistRequestVersion){state.worklistLoading=false;updateQrControls();}}
    },'worklist');
}
async function loadWorklist(){
    state.worklistLoading=true;state.worklistReady=false;updateQrControls();
    return withPageLoading('Đang tải danh sách kế hoạch...',async()=>{
    const version=++worklistRequestVersion;
    try{let r;if(state.showAll)r=await api.allWorklist();else if(state.selectedPlan)r=await api.worklist(state.selectedPlan.id);else{state.worklist=[];renderTable();return;}
        if(version!==worklistRequestVersion)return;
        state.worklist=sortWorklist(r.rows||[]);state.worklistReady=true;renderTable();
    }catch(e){if(version===worklistRequestVersion)alertUser('danger',e.message);}
    finally{if(version===worklistRequestVersion){state.worklistLoading=false;updateQrControls();}}
    },'worklist');
}
function renderTable(){const body=$('#plan-table-body'),empty=$('#empty-state'),pag=$('#pagination');if(!body)return;const total=state.worklist.length,pages=Math.max(1,Math.ceil(total/PAGE_SIZE));state.page=Math.min(state.page,pages);const rows=state.worklist.slice((state.page-1)*PAGE_SIZE,state.page*PAGE_SIZE);body.innerHTML=rows.map(r=>`<tr><td>${esc(r.ma_ke_hoach)}</td><td>${esc(r.ten_san_pham)}</td><td>${statusBadge(r)}</td><td class="text-end">${esc(fmt(r.chieu_dai_lay))}</td><td class="text-end">${esc(fmt(r.so_luong_cuon))}</td><td class="text-end">${esc(fmt(r.so_cuon_cat_le))}</td><td class="text-end">${esc(fmt(r.so_dau))}</td><td class="text-end">${esc(fmt(r.so_cuoi))}</td><td>${esc(fmt(r.lot))}</td></tr>`).join('');if(empty){empty.hidden=total>0;empty.querySelector('span').textContent='Chọn mã kế hoạch hoặc nhấn Tìm toàn bộ kế hoạch để xem công việc còn lại.';}if(pag)pag.hidden=total<=PAGE_SIZE;$('#result-summary').textContent=state.showAll?(total?`Đang xem toàn bộ kế hoạch · ${total} dòng công việc`:'Đang xem toàn bộ kế hoạch · Chưa có dữ liệu.'):(total?`${total} dòng công việc`:'Chưa có dữ liệu kế hoạch.');renderPagination(pages);}
function bindPagination(){$('#mobile-prev')?.addEventListener('click',()=>go(state.page-1));$('#mobile-next')?.addEventListener('click',()=>go(state.page+1));}
function renderPagination(pages){const h=$('#desktop-pagination');if(h){h.innerHTML='';for(let i=1;i<=pages;i++){const b=document.createElement('button');b.className='page-number'+(i===state.page?' active':'');b.textContent=i;b.onclick=()=>go(i);h.appendChild(b);}}const l=$('#mobile-page-label');if(l)l.textContent=`Trang ${state.page}/${pages}`;}
function go(p){const pages=Math.max(1,Math.ceil(state.worklist.length/PAGE_SIZE));state.page=Math.min(Math.max(1,p),pages);renderTable();}
function updateQrControls(){
    const allowed=typeof state.canScan==='function'&&state.canScan();
    const button=$('#open-qr'),checkbox=$('#continuous-scan'),guidance=$('#b3-qr-guidance');
    if(button){button.disabled=!allowed;button.setAttribute('aria-disabled',String(!allowed));}
    if(checkbox)checkbox.disabled=!allowed;
    if(guidance)guidance.hidden=!!allowed;
}
function bindQr(){$('#open-qr')?.addEventListener('click',openScanner);updateQrControls();}
async function openScanner(){
    if(!state.canScan()||scanOpening||state.singleQrModal?.isOpen)return;
    if(typeof window.QrCameraModal!=='function'){alertUser('danger','Module QR chưa sẵn sàng.');return;}
    scanOpening=true;
    try{
        if(!state.singleQrModal){state.singleQrModal=new window.QrCameraModal({title:'Quét QR',subtitle:'Đưa mã QR vào khung camera',mode:'single',duplicateDelay:1500,optimizeCamera:true,allowImage:false,formats:['QR_CODE'],onResult:resolveScan,onError:e=>alertUser('danger',e?.message||'Quét QR thất bại.')});}
        if(state.canScan())await state.singleQrModal.open();
    }finally{scanOpening=false;}
}
function isSessionError(error){return error?.sessionExpired||error?.status===401||['AUTH_REQUIRED','USER_INACTIVE'].includes(error?.code);}
function showQrError(error){
    if(error.code!=='QR_PRODUCT_AMBIGUOUS'){alertUser('danger',error.message);return;}
    closeQrErrorMessage?.();
    const previousFocus=document.activeElement;
    const background=[$('#app-screen'),$('#b3-result-page')].filter(Boolean);
    const previousInert=background.map(element=>element.inert);
    const overlay=document.createElement('div');
    overlay.id='b3-qr-error-dialog';overlay.className='b3-decision-overlay is-visible';
    overlay.setAttribute('role','alertdialog');overlay.setAttribute('aria-modal','true');
    overlay.setAttribute('aria-labelledby','b3-qr-error-title');
    overlay.setAttribute('aria-describedby','b3-qr-error-message');
    overlay.innerHTML='<section class="b3-decision-card b3-cut-settings-card"><h2 id="b3-qr-error-title">Không xác định được duy nhất sản phẩm</h2><p id="b3-qr-error-message" class="b3-decision-help">'+esc(error.message)+'</p><button type="button" class="btn btn-primary app-primary-button">Đóng</button></section>';
    document.body.appendChild(overlay);
    background.forEach(element=>{element.inert=true;});
    const button=overlay.querySelector('button');
    closeQrErrorMessage=()=>{
        overlay.remove();closeQrErrorMessage=null;
        background.forEach((element,index)=>{element.inert=previousInert[index];});
        previousFocus?.focus?.({preventScroll:true});
    };
    button.onclick=()=>closeQrErrorMessage?.();
    overlay.addEventListener('keydown',event=>{
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeQrErrorMessage?.();}
        if(event.key==='Tab'){event.preventDefault();button.focus();}
    });
    button.focus();
}
function handleSessionExpired(event){
    const hadUser=!!state.user;
    ++scanResolveVersion;
    closeResultPage({force:true});
    if(state.singleQrModal?.close)Promise.resolve(state.singleQrModal.close()).catch(()=>{});
    resetPlanScope();showLogin();
    if(hadUser)alertUser('danger',event?.detail?.message||'Phiên đăng nhập đã hết. Vui lòng đăng nhập lại và quét QR.');
}
async function resolveScan(raw){
    const version=++scanResolveVersion;
    return withPageLoading('Đang đọc dữ liệu QR...',async()=>{
        try{
            const r=await api.resolveQr(String(raw||'').trim(),state.showAll?null:state.selectedPlan?.id||null);
            if(version!==scanResolveVersion||!state.user)return;
            state.scan=r;chooseContext(r.selected_context||null);showResultPage(raw);
        }catch(e){if(version===scanResolveVersion&&!isSessionError(e))showQrError(e);}
    },'qr');
}
function chooseContext(ctx){
    if(state.cutSession?.active)return;
    state.cutSession=null;
    state.context=ctx;state.action=null;state.groupId=null;state.detailId=null;
    const partial=state.scan?.source?.source_type==='CUON_LE'?state.scan.source.partial:null;
    state.endValue=partial?String(partial.SoCuoi):'';
    state.direction=partial?(Number(partial.SoDau)<Number(partial.SoCuoi)?1:-1):'';
    state.cutParametersConfirmed=false;
    if(!ctx)return;
    const actions=ctx.available_actions||[];state.action=actions.length===1?actions[0]:null;
    state.groupId=ctx.groups?.length===1?ctx.groups[0].id:null;
    state.detailId=currentGroup()?.details?.find(d=>!Number(d.done)&&d.selectable!==false)?.id||null;
}
function bindResultPage(){
    $('#b3-result-back')?.addEventListener('click',()=>closeResultPage());
    $('#b3-cancel-action')?.addEventListener('click',()=>closeResultPage());
    $$('[data-b3-tab]').forEach(b=>b.addEventListener('click',()=>{
        if(saveInProgress||state.cutSession?.active)return;
        state.action=b.dataset.b3Tab==='whole'?'TAKE_WHOLE_REEL':(state.scan?.source?.source_type==='CUON_LE'?'CUT_PARTIAL_REEL':'CUT_FULL_REEL');
        if(state.action!=='TAKE_WHOLE_REEL')state.cutParametersConfirmed=false;
        renderResultPage();
    }));
    $('#b3-save-action')?.addEventListener('click',saveAction);
    // Reload starts at the list; an old history marker contains no draft.
    if(window.history?.state?.b3ResultPage)window.history.replaceState({...window.history.state,b3ResultPage:false},'');
    window.addEventListener?.('popstate',()=>{
        if(!resultPageOpen){
            // Forward must not resurrect a discarded draft or leave an active-page marker.
            if(window.history?.state?.b3ResultPage)window.history.replaceState({...window.history.state,b3ResultPage:false},'');
            return;
        }
        if(saveInProgress){window.history?.pushState({b3ResultPage:true},'');return;}
        closeResultPage({fromHistory:true});
    });
    window.addEventListener?.('b3:session-expired',handleSessionExpired);
    window.visualViewport?.addEventListener('resize',fitResultViewport);
    window.visualViewport?.addEventListener('scroll',fitResultViewport);
}
function fitResultViewport(){
    const page=$('#b3-result-page');
    if(!resultPageOpen||!page||!window.visualViewport)return;
    page.style.height=window.visualViewport.height+'px';
    page.style.top=window.visualViewport.offsetTop+'px';
    const dialog=$('#b3-cut-settings-dialog');
    if(dialog){
        dialog.style.height=window.visualViewport.height+'px';
        dialog.style.top=window.visualViewport.offsetTop+'px';
        dialog.style.bottom='auto';
    }
}
function showResultPage(raw){
    const page=$('#b3-result-page');if(!page)return;
    $('#qr-result-value').textContent=raw;
    const planDetails=$('.b3-plan-details',page);if(planDetails)planDetails.open=false;
    $('#b3-continue-scan').checked=!!$('#continuous-scan')?.checked;
    if(!resultPageOpen){
        const style=document.body.style;
        resultNavigation={x:window.scrollX||0,y:window.scrollY||0,styles:{}};
        for(const key of ['position','top','left','right','width','overflow'])resultNavigation.styles[key]=style[key];
        style.position='fixed';style.top=-resultNavigation.y+'px';style.left='0';style.right='0';style.width='100%';style.overflow='hidden';
        window.history?.pushState({...(window.history.state||{}),b3ResultPage:true},'');
    }
    resultPageOpen=true;
    const app=$('#app-screen');if(app){app.hidden=true;app.inert=true;}
    page.hidden=false;page.inert=false;fitResultViewport();
    const content=$('.b3-result-scroll',page);if(content)content.scrollTop=0;
    renderResultPage();
    if(!$('#b3-cut-settings-dialog'))$('#b3-result-back')?.focus?.();
}
function closeResultPage(options={}){
    if(saveInProgress&&!options.force)return false;
    if(!options.force&&state.cutSession?.pending?.status==='uncertain'){
        alertUser('danger','Chưa xác định kết quả lần Lưu trước. Vui lòng tải lại dữ liệu trước khi kết thúc cuộn.');return false;
    }
    closeDecisionOverlay();
    const wasOpen=resultPageOpen;resultPageOpen=false;
    const page=$('#b3-result-page');if(page){page.hidden=true;page.inert=false;page.style.height='';page.style.top='';}
    const app=$('#app-screen');if(app){app.hidden=false;app.inert=false;}
    if(resultNavigation){
        Object.assign(document.body.style,resultNavigation.styles);
        window.scrollTo?.(resultNavigation.x,resultNavigation.y);resultNavigation=null;
    }
    state.scan=null;state.context=null;state.action=null;state.groupId=null;state.detailId=null;
    state.endValue='';state.direction='';state.cutParametersConfirmed=false;
    state.cutSession=null;updateQrControls();
    if(wasOpen&&!options.fromHistory&&window.history?.state?.b3ResultPage)window.history.back();
    if(wasOpen)$('#open-qr')?.focus?.({preventScroll:true});
    return true;
}
function currentGroup(){return state.context?.groups?.find(g=>String(g.id)===String(state.groupId))||null;}
function renderResultPage(){
    const src=state.scan?.source;if(!src)return;
    const cutting=state.action&&state.action!=='TAKE_WHOLE_REEL';
    const continueLabel=$('#b3-continue-scan-label');if(continueLabel)continueLabel.hidden=!!cutting;
    const cancel=$('#b3-cancel-action');if(cancel)cancel.textContent=cutting?'KẾT THÚC CUỘN':'Hủy';
    const save=$('#b3-save-action');if(save)save.textContent=cutting?'LƯU LẦN CẮT TIẾP':'Lưu';
    const contexts=state.cutSession?.active?[state.context]:(state.scan.candidate_contexts||[]);const scope=$('#b3-plan-scope');
    if(!state.context && contexts.length>1){
        scope.innerHTML=`<select id="b3-plan-select" class="form-select form-select-sm"><option value="">Chọn kế hoạch...</option>${contexts.map((c,i)=>`<option value="${i}">${esc(c.plan.ma_ke_hoach)}${c.item.standard_length?` · ${esc(c.item.standard_length)} m`:``}</option>`).join('')}</select>`;
        $('#b3-product-name').textContent=contexts[0]?.item?.product_name||'';$('#b3-reel-code').textContent=src.source_type==='CUON_CHAN'?(src.ma_bin||src.raw_qr):src.raw_qr;$('#b3-reel-type').textContent=src.source_type==='CUON_CHAN'?'Cuộn chẵn':'Cuộn lẻ';
        $('#b3-plan-select').onchange=e=>{if(e.target.value==='')return;chooseContext(contexts[Number(e.target.value)]);renderResultPage();};
        $('#b3-tab-whole').hidden=true;$('#b3-tab-cut').hidden=true;$('#b3-tab-content').innerHTML='<section class="b3-operation-panel"><p>Vui lòng chọn phạm vi kế hoạch để tiếp tục.</p></section>';$('#b3-save-action').disabled=true;return;
    }
    const ctx=state.context;if(!ctx)return;
    if(contexts.length>1){scope.innerHTML=`<select id="b3-plan-select" class="form-select form-select-sm">${contexts.map((c,i)=>`<option value="${i}" ${c===ctx?'selected':''}>${esc(c.plan.ma_ke_hoach)}</option>`).join('')}</select>`;$('#b3-plan-select').onchange=e=>{chooseContext(contexts[Number(e.target.value)]);renderResultPage();};}else scope.innerHTML=`<strong>${esc(ctx.plan.ma_ke_hoach)}</strong>`;
    $('#b3-product-name').textContent=ctx.item.product_name;$('#b3-reel-code').textContent=src.source_type==='CUON_CHAN'?(src.ma_bin||src.raw_qr):src.raw_qr;$('#b3-reel-type').textContent=src.source_type==='CUON_CHAN'?'Cuộn chẵn':'Cuộn lẻ';
    const actions=ctx.available_actions||[];const whole=$('#b3-tab-whole'),cut=$('#b3-tab-cut');whole.hidden=!!state.cutSession?.active||!actions.includes('TAKE_WHOLE_REEL');cut.hidden=!actions.some(a=>a.startsWith('CUT_'));cut.disabled=!!state.cutSession?.active;whole.classList.toggle('active',state.action==='TAKE_WHOLE_REEL');cut.classList.toggle('active',!!state.action&&state.action!=='TAKE_WHOLE_REEL');whole.setAttribute('aria-selected',state.action==='TAKE_WHOLE_REEL'?'true':'false');cut.setAttribute('aria-selected',state.action&&state.action!=='TAKE_WHOLE_REEL'?'true':'false');
    const host=$('#b3-tab-content');if(!state.action){host.innerHTML='<section class="b3-operation-panel"><p>Vui lòng chọn loại thao tác cần thực hiện.</p></section>';$('#b3-save-action').disabled=true;return;}$('#b3-save-action').disabled=false;if(state.action==='TAKE_WHOLE_REEL')renderWhole(host,ctx);else renderCut(host,ctx,src);
}
function renderWhole(host,ctx){const left=Math.max(0,ctx.item.whole_required-ctx.item.whole_done);host.innerHTML=`<section class="b3-operation-panel"><div class="b3-operation-heading"><span class="b3-operation-kicker">LẤY NGUYÊN CUỘN</span><h3>${esc(ctx.item.product_name)}</h3></div><div class="b3-value-list"><div><span>Chiều dài một cuộn</span><strong>${esc(ctx.item.standard_length)} m</strong></div><div><span>Kế hoạch</span><strong>${ctx.item.whole_required} cuộn</strong></div><div><span>Đã lấy</span><strong>${ctx.item.whole_done} cuộn</strong></div><div><span>Còn lại</span><strong>${left} cuộn</strong></div><div><span>Lần này</span><strong>1 cuộn</strong></div></div></section>`;}
function cutSourceLength(src){
    return src.source_type==='CUON_LE'
        ?Math.abs(Number(src.partial.SoCuoi)-Number(src.partial.SoDau))
        :Number(src.chieu_dai_1cuon||state.context?.item?.standard_length||0);
}
function cutSettingsError(endText,directionText,src){
    if(String(endText).trim()==='')return {field:'b3-end-value-input',message:'Vui lòng nhập số cuối.'};
    const end=Number(endText),direction=Number(directionText);
    if(!Number.isSafeInteger(end)||end<0)return {field:'b3-end-value-input',message:'Số cuối phải là số nguyên lớn hơn hoặc bằng 0.'};
    if(![1,-1].includes(direction))return {field:'b3-direction-select',message:'Vui lòng chọn chiều thuận hoặc chiều nghịch.'};
    const length=cutSourceLength(src);
    if(!Number.isSafeInteger(length)||length<=0)return {field:'b3-end-value-input',message:'Không xác định được chiều dài cuộn. Vui lòng quét lại.'};
    if(end-direction*length<0)return {field:'b3-end-value-input',message:'Số cuối và chiều không phù hợp với chiều dài cuộn. Vui lòng kiểm tra lại.'};
    return null;
}
function renderCut(host,ctx,src){
    if(!state.cutParametersConfirmed){
        host.innerHTML='<section class="b3-operation-panel b3-first-cut-waiting" aria-hidden="true"></section>';
        $('#b3-save-action').disabled=true;showCutSettingsDialog();return;
    }
    const session=state.cutSession;
    const groups=session?.groupId?(ctx.groups||[]).filter(g=>String(g.id)===String(session.groupId)):(ctx.groups||[]);
    if(groups.length>1&&!state.groupId){
        host.innerHTML='<section class="b3-operation-panel"><label class="b3-input-block"><span>Nhóm cần thực hiện</span><select id="b3-group-select" class="form-select app-control"><option value="">Chọn nhóm...</option>'+groups.map(g=>'<option value="'+esc(g.id)+'">'+esc(g.details.filter(d=>!Number(d.done)).map(d=>d.ChieuDaiCanCat).join(';'))+'</option>').join('')+'</select></label><p class="b3-inline-note">Chọn nhóm trước khi chọn chiều dài cần cắt.</p></section>';
        $('#b3-group-select').onchange=event=>{if(!event.target.value)return;state.groupId=Number(event.target.value);if(session)session.groupId=state.groupId;state.detailId=null;renderResultPage();};
        $('#b3-save-action').disabled=true;return;
    }
    const group=currentGroup();
    if(!group){host.innerHTML='<div class="b3-complete-state">Không còn nhóm cắt phù hợp.</div>';$('#b3-save-action').disabled=true;return;}
    if(!group.details.some(d=>String(d.id)===String(state.detailId)&&!Number(d.done)&&d.selectable!==false)){
        state.detailId=group.details.find(d=>!Number(d.done)&&d.selectable!==false)?.id||null;
    }
    const detail=group.details.find(d=>String(d.id)===String(state.detailId));
    const groupSelect=groups.length>1?'<label class="b3-input-block"><span>Nhóm cần thực hiện</span><select id="b3-group-select" class="form-select app-control">'+groups.map(g=>'<option value="'+esc(g.id)+'" '+(String(g.id)===String(state.groupId)?'selected':'')+'>'+esc(g.details.filter(d=>!Number(d.done)).map(d=>d.ChieuDaiCanCat).join(';'))+'</option>').join('')+'</select></label>':'';
    const detailSelect='<label class="b3-input-block"><span>Chiều dài cần cắt</span><select id="b3-cut-detail-select" class="form-select app-control">'+group.details.map(d=>'<option value="'+esc(d.id)+'" '+(String(d.id)===String(state.detailId)?'selected':'')+' '+(Number(d.done)||d.selectable===false?'disabled':'')+'>'+esc(d.ChieuDaiCanCat)+' m'+(Number(d.done)?' · Đã thực hiện':d.selectable===false?' · Không đủ chiều dài':'')+'</option>').join('')+'</select></label>';
    host.innerHTML='<section class="b3-operation-panel"><div class="b3-operation-heading"><span class="b3-operation-kicker">CẮT LẺ</span><h3>'+esc(ctx.item.product_name)+'</h3></div>'+cutSessionSummary(src)+'<div class="b3-cut-layout"><div class="b3-cut-main">'+groupSelect+detailSelect+'<div id="b3-cut-preview">'+(detail?previewHtml(src,detail):'')+'</div></div><aside class="b3-cut-side"><section class="b3-detail-list"><h4>Các đoạn trong nhóm</h4><ul>'+group.details.map(d=>'<li class="b3-detail-row '+(Number(d.done)?'is-done':String(d.id)===String(state.detailId)?'is-selected':'')+'"><span>'+(Number(d.done)?'✓':'•')+'</span><span>'+esc(d.ChieuDaiCanCat)+' m</span><small>'+(Number(d.done)?'Đã thực hiện':d.selectable===false?'Không đủ chiều dài':'Chưa thực hiện')+'</small></li>').join('')+'</ul></section></aside></div></section>';
    const preview=detail?Number(state.endValue)-Number(state.direction)*Number(detail.ChieuDaiCanCat):-1;
    $('#b3-save-action').disabled=saveInProgress||!!session?.blocked||!detail||preview<0||!!cutSettingsError(state.endValue,state.direction,src);
    $('#b3-cut-recover')?.addEventListener('click',recoverCutSession);
    $('#b3-cut-retry')?.addEventListener('click',()=>saveCutSession(true));
    if($('#b3-cut-detail-select'))$('#b3-cut-detail-select').disabled=saveInProgress||!!session?.blocked;
    $('#b3-group-select')?.addEventListener('change',event=>{state.groupId=Number(event.target.value);state.detailId=null;renderResultPage();});
    $('#b3-cut-detail-select')?.addEventListener('change',event=>{state.detailId=Number(event.target.value);renderResultPage();});
}

function closeDecisionOverlay(){
    closeQrErrorMessage?.();
    $('#b3-cut-settings-dialog')?.remove();
    const page=$('#b3-result-page');if(page){page.inert=false;page.classList.remove('b3-decision-active');}
}
function showCutSettingsDialog(){
    if($('#b3-cut-settings-dialog'))return;
    const src=state.scan?.source;if(!src)return;
    const initialEnd=String(state.endValue),initialDirection=String(state.direction);
    const overlay=document.createElement('div');
    overlay.id='b3-cut-settings-dialog';overlay.className='b3-decision-overlay is-visible';
    overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');
    overlay.setAttribute('aria-labelledby','b3-cut-settings-title');
    overlay.innerHTML='<section class="b3-decision-card b3-cut-settings-card"><header class="b3-cut-settings-header"><h2 id="b3-cut-settings-title">Xác nhận thông số cuộn</h2><button id="b3-cut-settings-close" type="button" class="b3-cut-settings-close" aria-label="Hủy và quét lại">×</button></header><form id="b3-cut-settings-form" novalidate><label class="b3-input-block"><span>Số cuối</span><input id="b3-end-value-input" type="number" inputmode="numeric" min="0" step="1" required class="form-control app-control" value="'+esc(initialEnd)+'" aria-describedby="b3-cut-settings-error"><small id="b3-cut-settings-error" class="b3-cut-settings-error" role="alert" hidden></small></label><label class="b3-input-block"><span>Chiều</span><select id="b3-direction-select" required class="form-select app-control"><option value="">Chọn chiều...</option><option value="1" '+(initialDirection==='1'?'selected':'')+'>Chiều thuận</option><option value="-1" '+(initialDirection==='-1'?'selected':'')+'>Chiều nghịch</option></select></label><button id="b3-cut-settings-confirm" type="submit" class="btn btn-primary app-primary-button">Xác nhận</button></form></section>';
    document.body.appendChild(overlay);
    fitResultViewport();
    const page=$('#b3-result-page');if(page){page.inert=true;page.classList.add('b3-decision-active');}
    const endInput=$('#b3-end-value-input'),directionInput=$('#b3-direction-select');
    const confirm=$('#b3-cut-settings-confirm'),errorHost=$('#b3-cut-settings-error');
    const updateLabel=()=>{
        confirm.textContent=endInput.value!==initialEnd||directionInput.value!==initialDirection?'Cập nhật':'Xác nhận';
        errorHost.hidden=true;endInput.removeAttribute('aria-invalid');directionInput.removeAttribute('aria-invalid');
    };
    endInput.addEventListener('input',updateLabel);directionInput.addEventListener('change',updateLabel);
    $('#b3-cut-settings-form').addEventListener('submit',event=>{
        event.preventDefault();
        const error=cutSettingsError(endInput.value,directionInput.value,src);
        if(error){errorHost.textContent=error.message;errorHost.hidden=false;const field=$('#'+error.field);field.setAttribute('aria-invalid','true');field.focus();return;}
        state.endValue=endInput.value;state.direction=Number(directionInput.value);state.cutParametersConfirmed=true;
        state.cutSession={active:true,rawQr:state.scan.source.raw_qr,planId:state.context.plan.id,itemId:state.context.item.id,
            groupId:state.groupId,partialId:src.ton_cuon_le_id??null,cutsSaved:0,countedTokens:[],pending:null,
            blocked:false,retryAllowed:false,lastSaved:null,message:''};
        updateQrControls();
        closeDecisionOverlay();renderResultPage();
    });
    const cancel=async()=>{closeResultPage();await openScanner();};
    $('#b3-cut-settings-close').onclick=cancel;
    overlay.addEventListener('keydown',event=>{
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancel();return;}
        if(event.key==='Tab'){
            const controls=Array.from(overlay.querySelectorAll('button,input,select')).filter(element=>!element.disabled);
            const index=controls.indexOf(document.activeElement);
            event.preventDefault();controls[(index+(event.shiftKey?-1:1)+controls.length)%controls.length]?.focus();
        }
    });
    endInput.focus();
}

function cutSessionSummary(src){
    const session=state.cutSession;if(!session)return '';
    const length=session.remainingLength??cutSourceLength(src);
    const end=session.currentEnd??Number(state.endValue);
    const start=session.currentStart??(end-Number(state.direction)*length);
    const last=session.lastSaved;
    const recovery=session.blocked?'<div class="b3-cut-recovery" role="status"><p>'+esc(session.message||'Cần tải lại dữ liệu trước khi cắt tiếp.')+'</p><button id="b3-cut-recover" type="button" class="btn btn-outline-secondary">Tải lại dữ liệu</button>'+(session.retryAllowed?'<button id="b3-cut-retry" type="button" class="btn btn-primary">Thử lưu lại lần cắt này</button>':'')+'</div>':'';
    return '<section class="b3-cut-session" aria-label="Cuộn đang cắt"><div class="b3-session-reel"><span>Mã cuộn</span><strong>'+esc(src.partial?.MaCuon||src.raw_qr)+'</strong></div><div class="b3-session-values"><div><span>Loại cuộn</span><strong>'+(src.source_type==='CUON_LE'?'Cuộn lẻ':'Cuộn chẵn')+'</strong></div><div><span>Chiều</span><strong>'+(Number(state.direction)===1?'Thuận':'Nghịch')+'</strong></div><div><span>Số đầu hiện tại</span><strong id="b3-current-start">'+esc(start)+'</strong></div><div><span>Số cuối hiện tại</span><strong id="b3-current-end">'+esc(end)+'</strong></div><div><span>Chiều dài còn lại</span><strong id="b3-remaining-length">'+esc(length)+' m</strong></div><div><span>Đã cắt trong phiên</span><strong id="b3-session-cut-count">'+session.cutsSaved+' lần</strong></div></div>'+(last?'<p class="b3-last-cut" role="status">Lần lưu gần nhất: '+esc(last.cut_length)+' m · Thành công</p>':'')+recovery+'</section>';
}
function countSavedCut(session,payload,last){
    if(!session.countedTokens.includes(payload.operation_token)){
        session.countedTokens.push(payload.operation_token);session.cutsSaved++;
    }
    session.lastSaved=last||{cut_length:currentGroup()?.details.find(d=>String(d.id)===String(payload.detail_id))?.ChieuDaiCanCat||''};
}
function applyCutState(session,fresh,allowFull=false){
    const src=fresh?.source,ctx=fresh?.context;
    const group=ctx?.groups?.find(g=>String(g.id)===String(session.groupId));
    if(!src||src.raw_qr!==session.rawQr||String(ctx?.plan?.id)!==String(session.planId)
        ||String(ctx?.item?.id)!==String(session.itemId)||!group||!fresh.source_version
        ||!fresh.operation_token||fresh.operation_token===session.pending?.payload.operation_token
        ||(!allowFull&&src.source_type!=='CUON_LE'))throw new Error('Phản hồi chưa có trạng thái cuộn đáng tin cậy. Vui lòng tải lại dữ liệu.');
    if(src.source_type==='CUON_LE'){
        if((session.partialId!==null&&String(session.partialId)!==String(src.ton_cuon_le_id))
            ||!Number.isSafeInteger(fresh.current_start)||!Number.isSafeInteger(fresh.current_end)
            ||fresh.remaining_length!==Math.abs(fresh.current_end-fresh.current_start)
            ||Number(src.partial?.SoDau)!==fresh.current_start||Number(src.partial?.SoCuoi)!==fresh.current_end)
            throw new Error('Thông số cuộn chưa đồng bộ. Vui lòng tải lại dữ liệu.');
        session.partialId=src.ton_cuon_le_id;
        session.currentStart=fresh.current_start;session.currentEnd=fresh.current_end;
        state.endValue=String(fresh.current_end);state.direction=fresh.direction;
    }
    session.remainingLength=fresh.remaining_length;
    session.pending=null;session.blocked=false;session.retryAllowed=false;session.message='';
    state.scan={...state.scan,source:src,source_version:fresh.source_version,operation_token:fresh.operation_token,
        candidate_contexts:[ctx],selected_context:ctx};
    state.context={...ctx,groups:[group]};state.groupId=session.groupId;state.detailId=null;
    state.action=src.source_type==='CUON_LE'?'CUT_PARTIAL_REEL':'CUT_FULL_REEL';state.cutParametersConfirmed=true;
    if(!fresh.active){
        const message=(fresh.end_reason||'Không còn đoạn cắt phù hợp trong nhóm.')+' Còn lại: '+fresh.remaining_length+' m.';
        closeResultPage({force:true});alertUser('success',message);return false;
    }
    renderResultPage();return true;
}
async function recoverCutSession(){
    const session=state.cutSession;if(!session||saveInProgress||!session.groupId)return;
    const version=scanResolveVersion;saveInProgress=true;setResultSaving(true);
    try{
        const payload=session.pending?.payload;
        const response=await api.cutSession({raw_qr:session.rawQr,ke_hoach_id:session.planId,
            ke_hoach_hang_id:session.itemId,group_id:session.groupId,
            ...(payload?{operation_token:payload.operation_token,detail_id:payload.detail_id}:{})});
        if(version!==scanResolveVersion||state.cutSession!==session||!state.user)return;
        const fresh=response.cut_session;
        if(payload){
            if(fresh?.operation_status==='NOT_FOUND'&&session.pending.status==='uncertain'){
                // The original request may still arrive: only its exact token and payload may be retried.
                session.retryAllowed=true;session.message='Chưa ghi nhận giao dịch. Có thể thử lưu lại đúng lần cắt này.';return;
            }
            if(fresh?.operation_status!=='SAVED'||fresh.last_operation?.operation_token!==payload.operation_token
                ||String(fresh.last_operation.detail_id)!==String(payload.detail_id))
                throw new Error('Chưa xác định được kết quả giao dịch. Vui lòng tải lại dữ liệu.');
            countSavedCut(session,payload,fresh.last_operation);
        }
        const active=applyCutState(session,fresh,!payload);
        if(active)alertUser('success',payload?'Đã xác nhận lần cắt được lưu.':'Đã tải lại dữ liệu cuộn.');
        await loadWorklist();
    }catch(error){
        if(version!==scanResolveVersion||state.cutSession!==session||isSessionError(error))return;
        session.blocked=true;session.message=error.message;session.retryAllowed=false;
        alertUser('danger',error.message);
    }finally{
        saveInProgress=false;setResultSaving(false);
        if(state.cutSession===session)renderResultPage();
    }
}
async function saveCutSession(retry=false){
    const session=state.cutSession;if(!session||!session.active||saveInProgress)return;
    if(session.blocked&&!(retry&&session.retryAllowed))return;
    if(!session.groupId||!state.cutParametersConfirmed)return;
    let payload;
    if(retry){payload=session.pending?.payload;if(!payload)return;}
    else{
        const detail=currentGroup()?.details.find(d=>String(d.id)===String(state.detailId)&&!Number(d.done)&&d.selectable!==false);
        if(!detail||!state.scan.source_version){alertUser('danger','Dữ liệu cuộn chưa sẵn sàng. Vui lòng tải lại hoặc quét lại QR.');return;}
        const error=cutSettingsError(state.endValue,state.direction,state.scan.source);
        if(error){alertUser('danger',error.message);return;}
        payload={raw_qr:session.rawQr,ke_hoach_id:session.planId,ke_hoach_hang_id:session.itemId,
            group_id:session.groupId,detail_id:state.detailId,operation_token:state.scan.operation_token,
            source_version:state.scan.source_version,expected_cut_length:Number(detail.ChieuDaiCanCat)};
        if(session.cutsSaved===0){payload.end_value=Number(state.endValue);payload.direction=Number(state.direction);}
    }
    session.pending={payload,status:'pending'};session.blocked=true;session.retryAllowed=false;
    const version=scanResolveVersion;saveInProgress=true;setResultSaving(true);
    try{
        const response=await api.cut(payload);
        if(version!==scanResolveVersion||state.cutSession!==session||!state.user)return;
        session.pending.status='saved';countSavedCut(session,payload,response.cut_session?.last_operation);
        if(response.cut_session?.operation_status!=='SAVED'||response.cut_session.last_operation?.operation_token!==payload.operation_token)
            throw new Error('Đã lưu lần cắt nhưng chưa đồng bộ được dữ liệu cuộn. Vui lòng tải lại dữ liệu.');
        const active=applyCutState(session,response.cut_session);
        if(active)alertUser('success','Lưu thành công. Có thể chọn lần cắt tiếp theo.');
        await loadWorklist();
    }catch(error){
        if(version!==scanResolveVersion||state.cutSession!==session||isSessionError(error))return;
        const uncertain=!error.status||error.status>=500||error.code==='DUPLICATE_REQUEST';
        if(session.pending?.status!=='saved'){
            if(uncertain)session.pending.status='uncertain';else session.pending=null;
        }
        session.blocked=true;session.message=session.pending?.status==='saved'
            ?'Lần cắt đã được lưu. Cần tải lại dữ liệu trước khi cắt tiếp.'
            :session.pending?'Chưa xác định kết quả lần Lưu. Tải lại dữ liệu để kiểm tra giao dịch, không cắt thêm.':error.message;
        showQrError(error);
    }finally{
        saveInProgress=false;setResultSaving(false);
        if(state.cutSession===session)renderResultPage();
    }
}

function previewHtml(src,detail){
    if(!state.cutParametersConfirmed||state.endValue===''||![1,-1].includes(Number(state.direction)))return '';
    const value=Number(state.endValue)-Number(state.direction)*Number(detail.ChieuDaiCanCat);
    return '<div id="b3-after-cut-card" class="b3-after-cut-card '+(value<0?'is-error':'')+'" aria-live="polite"><span class="b3-after-cut-label">SỐ CUỐI SAU CẮT</span><strong id="b3-after-cut-value">'+(value<0?'LỖI':esc(value))+'</strong><small>'+(value<0?'Kiểm tra lại số cuối và chiều.':'Kiểm tra thông số trước khi lưu.')+'</small></div>';
}
function setResultSaving(saving){
    for(const id of ['b3-save-action','b3-cancel-action','b3-result-back','b3-continue-scan','b3-cut-detail-select','b3-group-select','b3-plan-select','b3-cut-recover','b3-cut-retry']){
        const element=$('#'+id);if(element)element.disabled=saving;
    }
    const page=$('#b3-result-page');if(page)page.setAttribute('aria-busy',String(saving));
    if(!saving&&state.cutSession?.active){
        const blocked=!!state.cutSession.blocked;
        for(const id of ['b3-save-action','b3-cut-detail-select'])if($('#'+id))$('#'+id).disabled=blocked;
        if($('#b3-group-select'))$('#b3-group-select').disabled=!!state.cutSession.groupId;
    }
}
async function saveAction(){
    const ctx=state.context,scan=state.scan;
    if(!ctx||!scan||saveInProgress)return;
    if(state.action!=='TAKE_WHOLE_REEL'){await saveCutSession();return;}
    // Snapshot before closing the page; closing deliberately discards the draft.
    const continueScanning=!!$('#b3-continue-scan')?.checked;
    const operationVersion=scanResolveVersion;
    saveInProgress=true;setResultSaving(true);
    try{
        await withPageLoading('Đang lưu dữ liệu...',async()=>{
            try{
                const result=await api.takeWhole({raw_qr:scan.source.raw_qr,ke_hoach_id:ctx.plan.id,
                        ke_hoach_hang_id:ctx.item.id,quy_cach_cuon_chan_id:ctx.item.quy_cach_id,
                        operation_token:scan.operation_token});
                if(operationVersion!==scanResolveVersion||!state.user)return;
                alertUser('success','Lưu thành công.');
                closeResultPage({force:true});
                const continuous=$('#continuous-scan');if(continuous)continuous.checked=continueScanning;
                if(result?.plan_complete)state.plans=state.plans.filter(x=>String(x.id)!==String(result.plan_id));
                await loadWorklist();
                if(continueScanning&&operationVersion===scanResolveVersion&&state.canScan()){
                    setTimeout(()=>{if(operationVersion===scanResolveVersion&&state.user)openScanner();},200);
                }
            }catch(error){
                if(operationVersion!==scanResolveVersion||isSessionError(error))return;
                showQrError(error);
                if(['STALE_DATA','DETAIL_ALREADY_DONE','DUPLICATE_REQUEST'].includes(error.code)){
                    closeResultPage({force:true});await loadWorklist();
                }
            }
        },'save');
    }finally{saveInProgress=false;setResultSaving(false);}
}
})();
