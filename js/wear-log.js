import { reconcileRows } from './ui-list.js?v=20261024-2';
import { CATEGORIES } from './daily-store.js?v=20261024-2';
import { WEAR_SLOTS, WEAR_FEEDBACK, wearDate } from './wear-model.js?v=20261024-2';
import { saveActualWear, changeWearRecord, samePieces } from './wear-store.js?v=20261024-2';
import { escapeText as esc } from './tasks-store.js?v=20261024-2';

const names=pieces=>pieces.map(piece=>piece.name).join(' ＋ ');
export function mountWearLog(root,{getData,getDate,onSaved,guard}) {
  root.innerHTML=`<div class="daily-heading"><h2>穿搭记录</h2><button type="button" class="daily-text-button" data-wear-new>记录 / 补记</button></div><p class="daily-small">选中只是计划，确认穿过才计数；日常和运动换装分开记。</p><p class="daily-feedback" data-wear-status role="status"></p><div data-wear-current></div><details class="wear-history"><summary>最近记录与已收起内容</summary><div data-wear-history></div><button type="button" class="daily-text-button" data-wear-more hidden>再显示10条</button></details>
    <dialog class="capture-dialog wear-dialog" aria-labelledby="wear-dialog-title"><form data-wear-form>
      <div class="capture-heading"><div><h2 id="wear-dialog-title">记录实际穿搭</h2><p>勾选实际穿过的单品，记一部分也可以。</p></div><button type="button" class="capture-close" data-wear-close aria-label="关闭穿搭记录">×</button></div>
      <div class="wardrobe-fields"><label>穿着日期（必填）<input type="date" name="wearDate" required min="2000-01-01" max="${wearDate(new Date())}"></label><label>这次穿着<select name="wearSlot">${Object.entries(WEAR_SLOTS).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label></div>
      <p class="daily-small" data-wear-existing></p><fieldset class="wear-piece-picker"><legend>实际穿过的单品（至少一件）</legend><div data-wear-pieces></div></fieldset>
      <details data-wear-extra><summary>时间与穿着感受（可选）</summary><label>大约几点穿上<input type="time" name="actualTime"></label><p class="daily-small">不填也能记。与洗衣同一天但未记时间时，不猜测先洗还是先穿。</p><label>体验评分<select name="rating"><option value="">暂不评分</option><option value="1">1 · 很不满意</option><option value="2">2 · 不太满意</option><option value="3">3 · 一般</option><option value="4">4 · 满意</option><option value="5">5 · 很满意</option></select></label><div class="wear-feedback-tags" role="group" aria-label="穿着感受">${Object.entries(WEAR_FEEDBACK).map(([key,label])=>`<label><input type="checkbox" name="wearFeedback" value="${key}">${label}</label>`).join('')}</div><label>其他感受<textarea name="comment" rows="2" maxlength="500" placeholder="可不填"></textarea></label></details>
      <p class="personal-error" data-wear-error role="alert"></p><p class="daily-small">保存实穿不会自动把单品移到待洗；按实际情况单独调整洗晒状态。</p><button type="submit" class="btn btn-primary">保存实穿</button>
    </form></dialog>`;
  const $=selector=>root.querySelector(selector),dialog=$('dialog'),form=$('[data-wear-form]');let limit=10,expected='',originalPieces=[],openRecordIds=new Set();
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
    const data=getData(),date=getDate(),current=(data.wearLogs||[]).filter(row=>row.date===date&&!row.deletedAt&&(row.selectedPieces.length||row.actualPieces.length));
    reconcileRows($('[data-wear-current]'),current.length?current.map(record).join(''):'<p class="daily-muted">这天还没记录。选好一套后留作计划，穿过再确认。</p>','data-wear-id');
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
    $('[data-wear-pieces]').innerHTML=Object.entries(CATEGORIES).filter(([category])=>garments.some(item=>item.category===category)).map(([category,label])=>`<div class="wear-picker-group"><h3>${label.label}</h3>${garments.filter(item=>item.category===category).map(item=>`<label><input type="checkbox" name="actualGarment" value="${esc(item.id)}"${chosen.has(item.id)?' checked':''}><span>${esc(item.name)}${item.deletedAt?'（已收起）':''}</span></label>`).join('')}</div>`).join('')||'<p class="daily-muted">先录几件自己的衣服，再来记录。</p>';
    form.elements.actualTime.value=row?.actualTime||'';form.elements.rating.value=row?.rating??'';form.elements.comment.value=row?.comment||'';
    form.querySelectorAll('[name=wearFeedback]').forEach(input=>input.checked=!!row?.feedback.includes(input.value));
    $('[data-wear-extra]').open=!!row?.actualPieces.length;$('[data-wear-error]').textContent='';
  }
  function open(date=getDate(),slot='daily') {
    guard();const today=wearDate(new Date());if(date>today)date=today;
    form.reset();form.elements.wearDate.value=date;form.elements.wearSlot.value=slot;fill(date,slot);dialog.showModal();form.elements.wearDate.focus();
  }
  const click=event=>{
    const button=event.target.closest('button');if(!button||!root.contains(button))return;
    try{
      if(button.hasAttribute('data-wear-close'))dialog.close();
      else if(button.hasAttribute('data-wear-new'))open();
      else if(button.hasAttribute('data-wear-more')){limit+=10;render();}
      else if(button.hasAttribute('data-wear-edit')){const row=getData().wearLogs.find(row=>row.id===button.closest('[data-wear-id]').dataset.wearId);open(row.date,row.slot);}
      else if(button.dataset.wearAction){guard();const id=button.closest('[data-wear-id]').dataset.wearId;changeWearRecord(id,button.dataset.wearAction);onSaved('穿搭记录已更新；洗晒状态未改动');render();$('[data-wear-status]').textContent='已保存，可在记录中恢复或修改。';focusRecord(id);}
    }catch(error){$('[data-wear-status]').textContent=error.message;}
  };
  const change=event=>{
    if(['wearDate','wearSlot'].includes(event.target.name))fill(form.elements.wearDate.value,form.elements.wearSlot.value);
    else if(event.target.name==='actualGarment'&&originalPieces.length){
      const selected=[...form.querySelectorAll('[name=actualGarment]:checked')].map(input=>({id:input.value}));
      if(!samePieces(selected,originalPieces)){form.elements.rating.value='';form.elements.comment.value='';form.querySelectorAll('[name=wearFeedback]').forEach(input=>input.checked=false);$('[data-wear-existing]').textContent='单品有调整，旧评分和感受已清空，可重新评价；保存后仍是同一条记录。';}
    }
  };
  const submit=event=>{
    if(event.target!==form)return;event.preventDefault();
    try{guard();const fields=new FormData(form);saveActualWear({date:fields.get('wearDate'),slot:fields.get('wearSlot'),garmentIds:fields.getAll('actualGarment'),actualTime:fields.get('actualTime')||'',rating:fields.get('rating')?Number(fields.get('rating')):null,feedback:fields.getAll('wearFeedback'),comment:fields.get('comment').trim(),expectedUpdatedAt:expected});dialog.close();onSaved('已记下实际穿搭，同一日期和时段不会重复计数');render();focusRecord(getData().wearLogs.find(row=>row.date===fields.get('wearDate')&&row.slot===fields.get('wearSlot'))?.id);}catch(error){$('[data-wear-error]').textContent=error.message;}
  };
  root.addEventListener('click',click);form.addEventListener('change',change);form.addEventListener('submit',submit);render();
  return {render,open,cleanup:()=>{dialog.close();root.removeEventListener('click',click);form.removeEventListener('change',change);form.removeEventListener('submit',submit);}};
}
