import { CATEGORIES, readDailyData, writeDailyData, applyGarmentState } from './daily-store.js?v=20261030-1';
import { wearKey, wearDate } from './wear-model.js?v=20261030-1';

const snapshot=item=>({id:item.id,name:item.name,category:item.category,color:item.color});
const samePieces=(a,b)=>JSON.stringify(a.map(piece=>piece.id).sort())===JSON.stringify(b.map(piece=>piece.id).sort());
function entry(data,date,slot) {
  const id=wearKey(date,slot),stamp=new Date().toISOString();
  return data.wearLogs.find(row=>row.id===id)||{id,date,slot,selectedPieces:[],selectedAt:'',candidateId:'',candidates:[],actualPieces:[],actualTime:'',confirmedAt:'',actualUndoneAt:'',planCancelledAt:'',laundryIds:[],laundryChanges:[],rating:null,feedback:[],comment:'',context:{weatherText:'',preference:'',courses:[]},createdAt:stamp,updatedAt:stamp,deletedAt:''};
}
function put(data,row) {data.wearLogs=[...data.wearLogs.filter(item=>item.id!==row.id),row];return writeDailyData(data);}
function actualPieces(data,ids) {
  if(!Array.isArray(ids)||!ids.length||ids.length>12||new Set(ids).size!==ids.length)throw Error('至少选择一件实际穿过的单品，最多12件');
  return ids.map(id=>{const item=data.garments.find(item=>item.id===id);if(!item)throw Error('单品已不存在，请重新选择');return snapshot(item);});
}
export function defaultWearLaundryIds(data,garmentIds) {
  return [...new Set(garmentIds)].filter(id=>data.garments.some(item=>item.id===id&&!item.deletedAt&&['top','bottom'].includes(CATEGORIES[item.category]?.group)));
}
const lastGarmentEvent=(data,id)=>data.garmentEvents.filter(event=>event.garmentId===id).at(-1);
function ownsState(data,change,state,eventId,at) {
  const item=data.garments.find(item=>item.id===change.garmentId);
  return item&&!item.deletedAt&&item.state===state&&item.stateAt===at&&lastGarmentEvent(data,item.id)?.id===eventId;
}
function otherConfirmedWearNeedsLaundry(data,row,change) {
  return data.wearLogs.some(other=>other.id!==row.id&&!other.actualUndoneAt&&other.actualPieces.some(piece=>piece.id===change.garmentId)&&other.laundryIds?.includes(change.garmentId)&&other.date>=row.date);
}
function undoLaundry(data,row,changes,stamp) {
  for(const change of changes) {
    if(change.undoneAt||!ownsState(data,change,'dirty',change.eventId,change.at)||otherConfirmedWearNeedsLaundry(data,row,change))continue;
    const [event]=applyGarmentState(data,[change.garmentId],change.fromState,change.fromExpectedDate,stamp);
    change.undoneAt=stamp;change.undoEventId=event.id;
    row.updatedAt=stamp;
  }
}
function restoreLaundry(data,row,stamp,onlyIds=null) {
  // A previous-day correction describes history; it must not dirty today's
  // freshly washed clothes. Only reverse our own untouched undo event.
  if(row.date!==wearDate(new Date(stamp)))return;
  for(const change of row.laundryChanges||[]) {
    if(onlyIds&&!onlyIds.includes(change.garmentId))continue;
    if(!change.undoneAt||!ownsState(data,change,change.fromState,change.undoEventId,change.undoneAt))continue;
    const [event]=applyGarmentState(data,[change.garmentId],'dirty','',stamp);
    change.at=stamp;change.eventId=event.id;change.undoneAt='';change.undoEventId='';
    row.updatedAt=stamp;
  }
}
function saveLaundry(data,row,pieces,requested,stamp,wasActive,previousPieceIds) {
  const explicit=requested!==undefined,oldIds=row.laundryIds||[],oldChanges=row.laundryChanges||[];
  let ids=explicit?requested:wasActive?[...oldIds.filter(id=>pieces.some(piece=>piece.id===id)),...defaultWearLaundryIds(data,pieces.filter(piece=>!previousPieceIds.has(piece.id)).map(piece=>piece.id))]:defaultWearLaundryIds(data,pieces.map(piece=>piece.id));
  if(!Array.isArray(ids)||ids.length>12||new Set(ids).size!==ids.length||ids.some(id=>!pieces.some(piece=>piece.id===id)))throw Error('一起待洗的单品必须是这次实际穿过的衣物');
  ids=[...ids];
  if(ids.some(id=>data.garments.find(item=>item.id===id)?.deletedAt))throw Error('已收起的单品不能自动更新洗晒，可取消勾选或先恢复衣物');
  const isToday=row.date===wearDate(new Date(stamp));
  if(isToday)undoLaundry(data,row,oldChanges.filter(change=>!ids.includes(change.garmentId)),stamp);
  row.laundryIds=ids;
  row.laundryChanges=oldChanges.filter(change=>ids.includes(change.garmentId));
  if(!isToday)return;
  if(!wasActive)restoreLaundry(data,row,stamp);
  for(const id of ids) {
    // Keep the original receipt even after a manual wash. Editing a score or
    // confirming the same actual outfit again cannot make clean clothes dirty.
    if(row.laundryChanges.some(change=>change.garmentId===id)||wasActive&&oldIds.includes(id)&&previousPieceIds.has(id))continue;
    const item=data.garments.find(item=>item.id===id);
    if(!['ready','rewear'].includes(item.state))continue;
    const fromState=item.state,fromExpectedDate=item.expectedDate;
    const [event]=applyGarmentState(data,[id],'dirty','',stamp);
    row.laundryChanges.push({garmentId:id,fromState,fromExpectedDate,eventId:event.id,at:stamp,undoneAt:'',undoEventId:''});
  }
}
export function saveWearSelection(date,slot,set,candidates,context={}) {
  const data=readDailyData(),row=entry(data,date,slot),stamp=new Date().toISOString();
  if(!set||!candidates.some(candidate=>candidate.id===set.id))throw Error('候选已变化，请重新选择');
  const selected=actualPieces(data,set.pieces.map(piece=>piece.id));
  if(selected.some(piece=>{const item=data.garments.find(item=>item.id===piece.id);return item.deletedAt||!['ready','rewear'].includes(item.state);}))throw Error('这套有单品已不在可穿状态，请重新挑选');
  row.selectedPieces=selected;row.selectedAt=stamp;row.candidateId=set.id;
  row.candidates=candidates.map(candidate=>({id:candidate.id,pieces:actualPieces(data,candidate.pieces.map(piece=>piece.id))}));
  row.context={weatherText:context.weatherText||'',preference:context.preference||'',courses:context.courses||[]};
  row.planCancelledAt='';row.deletedAt='';row.updatedAt=stamp;return put(data,row);
}
export function saveActualWear({date,slot,garmentIds,actualTime='',rating=null,feedback=[],comment='',expectedUpdatedAt,laundryGarmentIds}) {
  const now=new Date(),data=readDailyData(),row=entry(data,date,slot),pieces=actualPieces(data,garmentIds);
  if(expectedUpdatedAt!==undefined&&(data.wearLogs.find(item=>item.id===row.id)?.updatedAt||'')!==expectedUpdatedAt)throw Error('这条记录已在另一页面更新，输入仍保留；请重新打开后核对再保存');
  if(date>wearDate(now)||date===wearDate(now)&&actualTime&&new Date(`${date}T${actualTime}`)>now)throw Error('未来的穿搭先保存为计划，实际穿过后再确认');
  const wasActive=!!row.actualPieces.length&&!row.actualUndoneAt,previousPieceIds=new Set(row.actualPieces.map(piece=>piece.id));
  saveLaundry(data,row,pieces,laundryGarmentIds,now.toISOString(),wasActive,previousPieceIds);
  Object.assign(row,{actualPieces:pieces,actualTime,actualUndoneAt:'',rating,feedback,comment,confirmedAt:row.confirmedAt||now.toISOString(),updatedAt:now.toISOString(),deletedAt:''});
  return put(data,row);
}
export function changeWearRecord(id,action) {
  const data=readDailyData(),row=data.wearLogs.find(row=>row.id===id);if(!row)throw Error('记录已不存在');
  const stamp=new Date().toISOString();
  if(action==='undoActual'&&row.actualPieces.length) {
    row.actualUndoneAt=stamp;
    undoLaundry(data,row,row.laundryChanges||[],stamp);
    // Two actual slots can share a T-shirt. If the earlier slot was already
    // undone, restore its automatic state once no confirmed slot still needs it.
    for(const other of data.wearLogs)if(other.id!==row.id&&other.actualUndoneAt)undoLaundry(data,other,other.laundryChanges||[],stamp);
  }
  else if(action==='restoreActual'&&row.actualPieces.length){
    restoreLaundry(data,row,stamp);row.actualUndoneAt='';
    for(const other of data.wearLogs)if(other.id!==row.id&&other.actualUndoneAt)restoreLaundry(data,other,stamp,row.laundryIds||[]);
  }
  else if(action==='clearPlan'&&row.selectedPieces.length)row.planCancelledAt=stamp;
  else if(action==='restorePlan'&&row.selectedPieces.length)row.planCancelledAt='';
  else if(action==='trash')row.deletedAt=stamp;
  else if(action==='restore')row.deletedAt='';else throw Error('不支持的穿搭记录操作');
  row.updatedAt=stamp;return put(data,row);
}
export function selectedWear(data,date,slot) {return data.wearLogs?.find(row=>row.date===date&&row.slot===slot&&!row.deletedAt)||null;}
export { samePieces };
