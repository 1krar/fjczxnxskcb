import { reconcileRows } from './ui-list.js?v=20261030-1';
import { CATEGORIES } from './daily-store.js?v=20261030-1';
import { WEAR_SLOTS, WEAR_FEEDBACK, wearDate } from './wear-model.js?v=20261030-1';
import { saveActualWear, changeWearRecord, samePieces, defaultWearLaundryIds } from './wear-store.js?v=20261030-1';
import { escapeText as esc } from './tasks-store.js?v=20261030-1';

const names=pieces=>pieces.map(piece=>piece.name).join(' ＋ ');
export function mountWearLog(root,{getData,getDate=()=>wearDate(new Date()),onSaved,guard}) {
  root.innerHTML=`<div class="daily-heading"><h2>今天穿了什么</h2><button type="button" class="daily-text-button" data-wear-new>记录今天 / 补记</button></div><p class="daily-small"><span data-wear-date></span> · 穿过后再记，日常和运动换装分开记。</p><p class="daily-feedback" data-wear-status role="status"></p><div data-wear-current></div><details class="wear-history"><summary>最近记录与已收起内容</summary><div data-wear-history></div><button type="button" class="daily-text-button" data-wear-more hidden>再显示10条</button></details>
    <dialog class="capture-dialog wear-dialog" aria-labelledby="wear-dialog-title"><form data-wear-form>
      <div class="capture-heading"><div><h2 id="wear-dialog-title">记录实际穿搭</h2><p>勾选实际穿过的单品，记一部分也可以。</p></div><button type="button" class="capture-close" data-wear-close aria-label="关闭穿搭记录">×</button></div>
      <div class="wardrobe-fields"><label>穿着日期（必填）<input type="date" name="wearDate" required min="2000-01-01" max="${wearDate(new Date())}"></label><label>这次穿着<select name="wearSlot">${Object.entries(WEAR_SLOTS).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label></div>
      <p class="daily-small" data-wear-existing></p><label>按常用搭配勾选<select name="wearOutfit"><option value="">选择一套，再按实际微调</option></select></label><p class="daily-small" data-wear-outfit-hint>这里只勾选单品，不会自动保存。</p><fieldset class="wear-piece-picker"><legend>实际穿过的单品（至少一件）</legend><div data-wear-pieces></div></fieldset>
      <fieldset class="wear-laundry-picker"><legend>穿过后的洗晒</legend><label class="wear-laundry-toggle"><input type="checkbox" data-wear-laundry-toggle checked> 同时把勾选单品加入待洗</label><p class="daily-small" data-wear-laundry-hint>今天实穿的上衣和下装默认待洗，鞋、外套和腰带可按需要加入。</p><details data-wear-laundry-options><summary>调整待洗单品</summary><div data-wear-laundry-pieces></div></details></fieldset>
      <details data-wear-extra><summary>时间与穿着感受（可选）</summary><label>大约几点穿上<input type="time" name="actualTime"></label><p class="daily-small">不填也能记。与洗衣同一天但未记时间时，不猜测先洗还是先穿。</p><label>体验评分<select name="rating"><option value="">暂不评分</option><option value="1">1 · 很不满意</option><option value="2">2 · 不太满意</option><option value="3">3 · 一般</option><option value="4">4 · 满意</option><option value="5">5 · 很满意</option></select></label><div class="wear-feedback-tags" role="group" aria-label="穿着感受">${Object.entries(WEAR_FEEDBACK).map(([key,label])=>`<label><input type="checkbox" name="wearFeedback" value="${key}">${label}</label>`).join('')}</div><label>其他感受<textarea name="comment" rows="2" maxlength="500" placeholder="可不填"></textarea></label></details>
      <p class="personal-error" data-wear-error role="alert"></p><button type="submit" class="btn btn-primary">保存实穿</button>
    </form></dialog>`;
  const $=selector=>root.querySelector(selector),dialog=$('dialog'),form=$('[data-wear-form]');let limit=10,expected='',originalPieces=[],openRecordIds=new Set();
  function laundryChoices(initialIds=null,rebuild=true) {
    const data=getData(),today=form.elements.wearDate.value===wearDate(new Date());
    const ids=[...form.querySelectorAll('[name=actualGarment]:checked')].map(input=>input.value);
    const previous=new Map([...form.querySelectorAll('[name=laundryGarment]')].map(input=>[input.value,input.checked]));
    const defaults=new Set(initialIds||defaultWearLaundryIds(data,ids));
    if(rebuild)$('[data-wear-laundry-pieces]').innerHTML=ids.map(id=>data.garments.find(item=>item.id===id)).filter(Boolean).map(item=>`<label><input type="checkbox" name="laundryGarment" value="${esc(item.id)}"${(initialIds!==null?defaults.has(item.id):previous.has(item.id)?previous.get(item.id):defaults.has(item.id))?' checked':''}><span>${esc(item.name)}</span></label>`).join('')||'<p class="daily-small">先勾选实际穿过的单品。</p>';
    const toggle=$('[data-wear-laundry-toggle]');toggle.disabled=!today;if(!today)toggle.checked=false;
    const enabled=today&&toggle.checked;
    form.querySelectorAll('[name=laundryGarment]').forEach(input=>input.disabled=!enabled);
    $('[data-wear-laundry-options]').hidden=!today||!ids.length;
    const count=[...form.querySelectorAll('[name=laundryGarment]:checked')].length;
    $('[data-wear-laundry-hint]').textContent=!today?'补记只更新穿搭记录，不追改今天的洗晒状态。':!toggle.checked?'这次只保存穿搭记录，不改洗晒状态。':count?`这次有${count}件加入待洗；默认上衣和下装，鞋与外套按勾选决定。`:'尚未勾选待洗单品；这次只保存穿搭记录。';
  }
  function record(row) {
    const actual=row.actualPieces.length&&!row.actualUndoneAt,planned=row.selectedPieces.length&&!row.planCancelledAt;
    return `<article class="wear-record" data-wear-id="${esc(row.id)}"><div class="wear-record-heading"><strong>${esc(row.date.slice(5))} · ${WEAR_SLOTS[row.slot]}</strong><span class="daily-small">${row.deletedAt?'已收起':actual?'已确认穿过':planned?'已选计划':row.actualUndoneAt?'已撤销实穿':'计划已取消'}</span></div>
      ${row.actualPieces.length?`<p class="wear-record-pieces${row.actualUndoneAt?' is-undone':''}">${esc(names(row.actualPieces))}</p>${actual&&row.rating!==null?`<p class="daily-small">体验 ${row.rating}/5${row.feedback.length?' · '+row.feedback.map(tag=>WEAR_FEEDBACK[tag]).join('、'):''}</p>`:actual&&row.feedback.length?`<p class="daily-small">${row.feedback.map(tag=>WEAR_FEEDBACK[tag]).join('、')}</p>`:''}${actual&&row.comment?`<p class="daily-small wear-comment">${esc(row.comment)}</p>`:''}`:''}
      ${row.selectedPieces.length?`<p class="daily-small">${row.planCancelledAt?'已取消计划':actual?'原计划':'计划'}：${esc(names(row.selectedPieces))}${actual&&!samePieces(row.selectedPieces,row.actualPieces)?' · 实际有调整':''}</p>`:''}
      <div class="wear-record-actions">${row.deletedAt?'<button type="button" data-wear-action="restore">恢复记录</button>':`${row.date<=wearDate(new Date())?`<button type="button" data-wear-edit>${actual?'修改 / 评分':'记录实穿'}</button>`:'<span class="daily-small">到当天再确认实穿</span>'}<details class="wear-record-more"${openRecordIds.has(row.id)?' open':''}><summary>更多操作</summary><div>${actual?'<button type="button" data-wear-action="undoActual">撤销实穿</button>':row.actualUndoneAt?'<button type="button" data-wear-action="restoreActual">恢复实穿</button>':''}${planned?'<button type="button" data-wear-action="clearPlan">取消计划</button>':row.planCancelledAt?'<button type="button" data-wear-action="restorePlan">恢复计划</button>':''}<button type="button" data-wear-action="trash">收起记录</button></div></details>`}</div></article>`;
  }
  function render() {
    openRecordIds=new Set([...root.querySelectorAll('.wear-record-more[open]')].map(node=>node.closest('[data-wear-id]').dataset.wearId));
    const focused=document.activeElement, focusId=focused?.closest('[data-wear-id]')?.dataset.wearId;
    const focusAction=focused?.dataset.wearAction, focusEdit=focused?.hasAttribute('data-wear-edit'), focusSummary=focused?.matches('.wear-record-more > summary');
    const data=getData(),date=getDate(),today=wearDate(new Date()),current=(data.wearLogs||[]).filter(row=>row.date===date&&!row.deletedAt&&(row.selectedPieces.length||row.actualPieces.length));
    const actualCount=current.filter(row=>row.actualPieces.length&&!row.actualUndoneAt).length;
    $('[data-wear-date]').textContent=`${date===today?'今天 · ':''}${date}${actualCount?` · 已记${actualCount}次实穿`:''}`;
    reconcileRows($('[data-wear-current]'),current.length?current.map(record).join(''):`<p class="daily-muted">${date===today?'今天':esc(date)}还没记实穿。穿过后记下，也可以补记以前的穿搭。</p>`,'data-wear-id');
    const history=[...(data.wearLogs||[])].filter(row=>row.date!==date||row.deletedAt).sort((a,b)=>b.date.localeCompare(a.date)||b.updatedAt.localeCompare(a.updatedAt));
    $('.wear-history > summary').textContent=`最近记录与已收起内容 · ${history.length}条`;
    reconcileRows($('[data-wear-history]'),history.slice(0,limit).map(record).join('')||'<p class="daily-small">还没有其他记录。</p>','data-wear-id');
    $('[data-wear-more]').hidden=history.length<=limit;
    if (focusId) {
      const row=[...root.querySelectorAll('[data-wear-id]')].find(node=>node.dataset.wearId===focusId);
      const target=focusEdit?row?.querySelector('[data-wear-edit]'):focusSummary?row?.querySelector('.wear-record-more > summary'):focusAction?[...row?.querySelectorAll('[data-wear-action]')||[]].find(node=>node.dataset.wearAction===focusAction):null;
      target?.focus({preventScroll:true});
    }
  }
  function focusRecord(id) {
    const row=[...root.querySelectorAll('[data-wear-id]')].find(node=>node.dataset.wearId===id);
    const history=row?.closest('.wear-history');
    (history&&!history.open?history.querySelector('summary'):row?.querySelector('[data-wear-edit], summary, button')||$('[data-wear-new]')).focus({preventScroll:true});
  }
  function fill(date,slot) {
    const data=getData(),row=data.wearLogs?.find(row=>row.date===date&&row.slot===slot);expected=row?.updatedAt||'';
    originalPieces=row?.actualPieces||[];
    const chosen=new Set((row?.actualPieces.length?row.actualPieces:row&&!row.planCancelledAt?row.selectedPieces:[]).map(piece=>piece.id));
    $('[data-wear-existing]').textContent=row?.deletedAt?'这天有已收起的记录，保存会恢复并修改同一条，不重复计数。':row?.actualPieces.length?'已有这天的记录，保存会修正同一条，不重复增加次数。':'只记录你确认穿过的单品；未来日期请先选计划。';
    const garments=data.garments.filter(item=>!item.deletedAt||chosen.has(item.id));
    const outfits=data.outfits.filter(item=>!item.deletedAt);
    form.elements.wearOutfit.innerHTML='<option value="">选择一套，再按实际微调</option>'+outfits.map(outfit=>{
      const unavailable=outfit.garmentIds.some(id=>!data.garments.some(item=>item.id===id&&!item.deletedAt));
      return `<option value="${esc(outfit.id)}"${unavailable?' disabled':''}>${esc(outfit.name)}${unavailable?'（含已收起或缺失单品，暂不可选）':''}</option>`;
    }).join('');
    form.elements.wearOutfit.disabled=!outfits.length;
    $('[data-wear-outfit-hint]').textContent=outfits.length?'选择只替换下方勾选，时间与评价保留；含已收起单品的搭配需先恢复衣物。':'尚无常用搭配，可先直接勾选单品；在衣物洗晒里连接一套后即可快选。';
    $('[data-wear-pieces]').innerHTML=Object.entries(CATEGORIES).filter(([category])=>garments.some(item=>item.category===category)).map(([category,label])=>`<div class="wear-picker-group"><h3>${label.label}</h3>${garments.filter(item=>item.category===category).map(item=>`<label><input type="checkbox" name="actualGarment" value="${esc(item.id)}"${chosen.has(item.id)?' checked':''}><span>${esc(item.name)}${item.deletedAt?'（已收起）':''}</span></label>`).join('')}</div>`).join('')||'<p class="daily-muted">先录几件自己的衣服，再来记录。</p>';
    form.elements.actualTime.value=row?.actualTime||'';form.elements.rating.value=row?.rating??'';form.elements.comment.value=row?.comment||'';
    form.querySelectorAll('[name=wearFeedback]').forEach(input=>input.checked=!!row?.feedback.includes(input.value));
    $('[data-wear-extra]').open=!!row?.actualPieces.length;$('[data-wear-error]').textContent='';
    const initialLaundry=row?.actualPieces.length?row.laundryIds||[]:defaultWearLaundryIds(data,[...chosen]);
    $('[data-wear-laundry-toggle]').checked=row?.actualPieces.length?initialLaundry.length>0:true;
    $('[data-wear-laundry-options]').open=false;laundryChoices(initialLaundry);
  }
  function open(date=getDate(),slot='daily') {
    guard();const today=wearDate(new Date());if(date>today)date=today;
    form.elements.wearDate.max=today;form.reset();form.elements.wearDate.value=date;form.elements.wearSlot.value=slot;fill(date,slot);dialog.showModal();form.elements.wearDate.focus();
  }
  const click=event=>{
    const button=event.target.closest('button');if(!button||!root.contains(button))return;
    try{
      if(button.hasAttribute('data-wear-close'))dialog.close();
      else if(button.hasAttribute('data-wear-new'))open();
      else if(button.hasAttribute('data-wear-more')){limit+=10;render();}
      else if(button.hasAttribute('data-wear-edit')){const row=getData().wearLogs.find(row=>row.id===button.closest('[data-wear-id]').dataset.wearId);open(row.date,row.slot);}
      else if(button.dataset.wearAction){guard();const id=button.closest('[data-wear-id]').dataset.wearId;changeWearRecord(id,button.dataset.wearAction);onSaved('穿搭记录已更新');render();$('[data-wear-status]').textContent='已保存，可在记录中恢复或修改。';focusRecord(id);}
    }catch(error){$('[data-wear-status]').textContent=error.message;}
  };
  const change=event=>{
    try{
    if(['wearDate','wearSlot'].includes(event.target.name))fill(form.elements.wearDate.value,form.elements.wearSlot.value);
    else if(event.target.name==='wearOutfit'){
      if(!event.target.value)return;
      guard();const data=getData(),outfit=data.outfits.find(item=>item.id===event.target.value&&!item.deletedAt);
      if(!outfit||outfit.garmentIds.some(id=>!data.garments.some(item=>item.id===id&&!item.deletedAt)))throw Error('这套搭配包含已收起或缺失的单品，请先恢复衣物或逐件勾选。');
      const ids=new Set(outfit.garmentIds);
      form.querySelectorAll('[name=actualGarment]').forEach(input=>input.checked=ids.has(input.value));
      laundryChoices(defaultWearLaundryIds(data,outfit.garmentIds));
      $('[data-wear-outfit-hint]').textContent=`已按「${outfit.name}」勾选${ids.size}件，可继续微调；时间与评价保留，尚未保存。`;
      $('[data-wear-error]').textContent='';
    }
    else if(event.target.name==='actualGarment'){
      form.elements.wearOutfit.value='';
      const selected=[...form.querySelectorAll('[name=actualGarment]:checked')].map(input=>({id:input.value}));
      if(originalPieces.length&&!samePieces(selected,originalPieces)){form.elements.rating.value='';form.elements.comment.value='';form.querySelectorAll('[name=wearFeedback]').forEach(input=>input.checked=false);$('[data-wear-existing]').textContent='单品有调整，旧评分和感受已清空，可重新评价；保存后仍是同一条记录。';}
      laundryChoices();
    } else if(event.target.matches('[data-wear-laundry-toggle], [name=laundryGarment]'))laundryChoices(null,false);
    }catch(error){$('[data-wear-error]').textContent=error.message;}
  };
  const submit=event=>{
    if(event.target!==form)return;event.preventDefault();
    try{guard();const fields=new FormData(form);const laundryIds=$('[data-wear-laundry-toggle]').checked&&fields.get('wearDate')===wearDate(new Date())?fields.getAll('laundryGarment'):[];saveActualWear({date:fields.get('wearDate'),slot:fields.get('wearSlot'),garmentIds:fields.getAll('actualGarment'),laundryGarmentIds:laundryIds,actualTime:fields.get('actualTime')||'',rating:fields.get('rating')?Number(fields.get('rating')):null,feedback:fields.getAll('wearFeedback'),comment:fields.get('comment').trim(),expectedUpdatedAt:expected});dialog.close();onSaved(laundryIds.length?'已保存实穿与待洗选择；已处理过的洗晒不会重复修改':'已记下实际穿搭，同一日期和时段不会重复计数');render();focusRecord(getData().wearLogs.find(row=>row.date===fields.get('wearDate')&&row.slot===fields.get('wearSlot'))?.id);}catch(error){$('[data-wear-error]').textContent=error.message;}
  };
  root.addEventListener('click',click);form.addEventListener('change',change);form.addEventListener('submit',submit);render();
  return {render,open,cleanup:()=>{dialog.close();root.removeEventListener('click',click);form.removeEventListener('change',change);form.removeEventListener('submit',submit);}};
}
