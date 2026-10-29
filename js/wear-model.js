// Wear logs describe reported use. Neither selections nor laundry guesses count.
export const WEAR_SLOTS={daily:'日常',sport:'运动换装'};
export const WEAR_FEEDBACK={comfortable:'舒服',looks:'好看',hot:'偏热',cold:'偏冷',restrictive:'不便活动',wet:'雨天不合适'};
export const wearDate=now=>`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
export const wearKey=(date,slot)=>`wear:${date}:${slot}`;
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(+new Date(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const stamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value));
const text=(value,max)=>typeof value==='string'&&value.length<=max;
export function validateWearLog(value,garments) {
  const error=()=>{throw Error('穿搭记录格式无效，原资料未改动');};
  if(!value||!validDay(value.date)||!Object.hasOwn(WEAR_SLOTS,value.slot)||value.id!==wearKey(value.date,value.slot))error();
  const catalog=new Map(garments.map(item=>[item.id,item]));
  function pieces(rows,max=12) {
    if(!Array.isArray(rows)||rows.length>max||new Set(rows.map(row=>row?.id)).size!==rows.length)error();
    return rows.map(row=>{
      if(!row||!catalog.has(row.id)||!text(row.name,120)||!row.name.trim()||row.category!==catalog.get(row.id).category||!text(row.color,40))error();
      return {id:row.id,name:row.name,category:row.category,color:row.color};
    });
  }
  const selectedPieces=pieces(value.selectedPieces),actualPieces=pieces(value.actualPieces);
  if(!Array.isArray(value.candidates)||value.candidates.length>3||new Set(value.candidates.map(row=>row?.id)).size!==value.candidates.length)error();
  const candidates=value.candidates.map(row=>{
    if(!row||!text(row.id,2000)||!row.id)error();
    const result={id:row.id,pieces:pieces(row.pieces)};if(!result.pieces.length)error();return result;
  });
  if(!text(value.candidateId,2000)||value.candidateId&&!candidates.some(row=>row.id===value.candidateId&&JSON.stringify(row.pieces.map(p=>p.id).sort())===JSON.stringify(selectedPieces.map(p=>p.id).sort())))error();
  if(selectedPieces.length?!stamp(value.selectedAt):value.selectedAt!==''||value.candidateId||candidates.length)error();
  if(actualPieces.length?!stamp(value.confirmedAt):value.confirmedAt!=='')error();
  if(!text(value.actualTime,5)||value.actualTime&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.actualTime))error();
  if(value.rating!==null&&(!Number.isInteger(value.rating)||value.rating<1||value.rating>5)||!Array.isArray(value.feedback)||value.feedback.length>6||new Set(value.feedback).size!==value.feedback.length||value.feedback.some(tag=>!Object.hasOwn(WEAR_FEEDBACK,tag))||!text(value.comment,500))error();
  if(!actualPieces.length&&(value.actualTime||value.rating!==null||value.feedback.length||value.comment))error();
  const actualUndoneAt=value.actualUndoneAt??'',planCancelledAt=value.planCancelledAt??'';
  if(actualUndoneAt!==''&&!stamp(actualUndoneAt)||planCancelledAt!==''&&!stamp(planCancelledAt)||!actualPieces.length&&actualUndoneAt||!selectedPieces.length&&planCancelledAt)error();
  // Optional receipts keep older backups readable and let undo restore only the
  // automatic laundry state that still belongs to this confirmation.
  const laundryIds=value.laundryIds??[],changes=value.laundryChanges??[];
  if(!Array.isArray(laundryIds)||laundryIds.length>12||new Set(laundryIds).size!==laundryIds.length||laundryIds.some(id=>!actualPieces.some(piece=>piece.id===id))||!Array.isArray(changes)||changes.length>12||new Set(changes.map(change=>change?.garmentId)).size!==changes.length)error();
  const laundryChanges=changes.map(change=>{
    if(!change||!laundryIds.includes(change.garmentId)||!['ready','rewear'].includes(change.fromState)||!text(change.fromExpectedDate,10)||change.fromExpectedDate&&!validDay(change.fromExpectedDate)||!text(change.eventId,100)||!change.eventId||!stamp(change.at))error();
    const undoneAt=change.undoneAt??'',undoEventId=change.undoEventId??'';
    if(undoneAt!==''&&!stamp(undoneAt)||!text(undoEventId,100)||Boolean(undoneAt)!==Boolean(undoEventId))error();
    return {garmentId:change.garmentId,fromState:change.fromState,fromExpectedDate:change.fromExpectedDate,eventId:change.eventId,at:change.at,undoneAt,undoEventId};
  });
  if(!stamp(value.createdAt)||!stamp(value.updatedAt)||value.deletedAt!==''&&!stamp(value.deletedAt))error();
  const context=value.context;
  if(!context||!text(context.weatherText,500)||!text(context.preference,300)||!Array.isArray(context.courses)||context.courses.length>20||context.courses.some(name=>!text(name,300)))error();
  return {id:value.id,date:value.date,slot:value.slot,selectedPieces,selectedAt:value.selectedAt,candidateId:value.candidateId,candidates,
    actualPieces,actualTime:value.actualTime,confirmedAt:value.confirmedAt,actualUndoneAt,planCancelledAt,laundryIds:[...laundryIds],laundryChanges,rating:value.rating,feedback:[...value.feedback],comment:value.comment,
    context:{weatherText:context.weatherText,preference:context.preference,courses:[...context.courses]},createdAt:value.createdAt,updatedAt:value.updatedAt,deletedAt:value.deletedAt};
}
export function validateGarmentEvent(value,garments) {
  if(!value||!text(value.id,100)||!value.id||!garments.some(item=>item.id===value.garmentId)||!['ready','rewear','dirty','washing','drying'].includes(value.state)||!stamp(value.at))throw Error('单品洗晒历史格式无效');
  return {id:value.id,garmentId:value.garmentId,state:value.state,at:value.at};
}
export function visibleWearCandidates(fit,preferred=null) {
  const pool=[...new Map([...(preferred?[preferred]:[]),...(fit?.candidates||fit?.sets||[])].filter(set=>!set.conditionalIds?.length).map(set=>[set.id,set])).values()];
  const result=pool.length?[pool[0]]:[];
  while(result.length<3) {
    const remaining=pool.filter(set=>!result.some(row=>row.id===set.id));if(!remaining.length)break;
    const distance=set=>Math.min(...result.map(row=>{
      const ids=new Set(row.pieces.map(piece=>piece.id));
      return set.pieces.reduce((score,piece)=>score+(ids.has(piece.id)?0:['tshirt','shirt','jeans','trousers','joggers','sportshorts','shorts'].includes(piece.category)?3:1),0);
    }));
    remaining.sort((a,b)=>distance(b)-distance(a));result.push(remaining[0]);
  }
  return result;
}
function usage(rows,events,now) {
  const today=wearDate(now),start=days=>{const date=new Date(today+'T12:00');date.setDate(date.getDate()-days+1);return wearDate(date);};
  const actual=rows.filter(row=>!row.deletedAt&&!row.actualUndoneAt&&row.actualPieces.length&&row.date<=today&&(!row.actualTime||new Date(`${row.date}T${row.actualTime}`)<=now));
  const recent=days=>actual.filter(row=>row.date>=start(days));
  const days=values=>new Set(values.map(row=>row.date)).size;
  const pastEvents=events.filter(event=>Date.parse(event.at)<=+now).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  const laundry=pastEvents.filter(event=>['washing','drying'].includes(event.state)).at(-1);
  let wash=laundry?.state==='washing'?laundry:null;
  if(laundry?.state==='drying') {
    const previous=pastEvents[pastEvents.indexOf(laundry)-1];if(previous?.state==='washing')wash=previous;
  }
  let afterWash=null,sameDayUnknown=0;
  if(wash) {
    const day=wearDate(new Date(wash.at));afterWash=0;
    for(const row of actual) {
      if(row.date>day)afterWash++;
      else if(row.date===day){if(!row.actualTime)sameDayUnknown++;else if(+new Date(`${day}T${row.actualTime}`)>Date.parse(wash.at))afterWash++;}
    }
  }
  return {days7:days(recent(7)),times7:recent(7).length,days30:days(recent(30)),times30:recent(30).length,
    lastWorn:actual.map(row=>row.date).sort().at(-1)||'',afterWash,sameDayUnknown,washAt:wash?.at||'',lastStateEvent:pastEvents.at(-1)||null};
}
export function wearUsageIndex(data,now=new Date()) {
  const rows=new Map(),events=new Map();
  for(const row of data.wearLogs||[])for(const piece of row.actualPieces){if(!rows.has(piece.id))rows.set(piece.id,[]);rows.get(piece.id).push(row);}
  for(const event of data.garmentEvents||[]){if(!events.has(event.garmentId))events.set(event.garmentId,[]);events.get(event.garmentId).push(event);}
  return new Map(data.garments.map(item=>[item.id,usage(rows.get(item.id)||[],events.get(item.id)||[],now)]));
}
