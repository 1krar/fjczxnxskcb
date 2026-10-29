import { readDailyData, writeDailyData } from './daily-store.js?v=20261029-3';
import { wearKey, wearDate } from './wear-model.js?v=20261029-3';

const snapshot=item=>({id:item.id,name:item.name,category:item.category,color:item.color});
const samePieces=(a,b)=>JSON.stringify(a.map(piece=>piece.id).sort())===JSON.stringify(b.map(piece=>piece.id).sort());
function entry(data,date,slot) {
  const id=wearKey(date,slot),stamp=new Date().toISOString();
  return data.wearLogs.find(row=>row.id===id)||{id,date,slot,selectedPieces:[],selectedAt:'',candidateId:'',candidates:[],actualPieces:[],actualTime:'',confirmedAt:'',actualUndoneAt:'',planCancelledAt:'',rating:null,feedback:[],comment:'',context:{weatherText:'',preference:'',courses:[]},createdAt:stamp,updatedAt:stamp,deletedAt:''};
}
function put(data,row) {data.wearLogs=[...data.wearLogs.filter(item=>item.id!==row.id),row];return writeDailyData(data);}
function actualPieces(data,ids) {
  if(!Array.isArray(ids)||!ids.length||ids.length>12||new Set(ids).size!==ids.length)throw Error('至少选择一件实际穿过的单品，最多12件');
  return ids.map(id=>{const item=data.garments.find(item=>item.id===id);if(!item)throw Error('单品已不存在，请重新选择');return snapshot(item);});
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
export function saveActualWear({date,slot,garmentIds,actualTime='',rating=null,feedback=[],comment='',expectedUpdatedAt}) {
  const now=new Date(),data=readDailyData(),row=entry(data,date,slot),pieces=actualPieces(data,garmentIds);
  if(expectedUpdatedAt!==undefined&&(data.wearLogs.find(item=>item.id===row.id)?.updatedAt||'')!==expectedUpdatedAt)throw Error('这条记录已在另一页面更新，输入仍保留；请重新打开后核对再保存');
  if(date>wearDate(now)||date===wearDate(now)&&actualTime&&new Date(`${date}T${actualTime}`)>now)throw Error('未来的穿搭先保存为计划，实际穿过后再确认');
  Object.assign(row,{actualPieces:pieces,actualTime,actualUndoneAt:'',rating,feedback,comment,confirmedAt:row.confirmedAt||now.toISOString(),updatedAt:now.toISOString(),deletedAt:''});
  return put(data,row);
}
export function changeWearRecord(id,action) {
  const data=readDailyData(),row=data.wearLogs.find(row=>row.id===id);if(!row)throw Error('记录已不存在');
  const stamp=new Date().toISOString();
  if(action==='undoActual'&&row.actualPieces.length)row.actualUndoneAt=stamp;
  else if(action==='restoreActual'&&row.actualPieces.length)row.actualUndoneAt='';
  else if(action==='clearPlan'&&row.selectedPieces.length)row.planCancelledAt=stamp;
  else if(action==='restorePlan'&&row.selectedPieces.length)row.planCancelledAt='';
  else if(action==='trash')row.deletedAt=stamp;
  else if(action==='restore')row.deletedAt='';else throw Error('不支持的穿搭记录操作');
  row.updatedAt=stamp;return put(data,row);
}
export function selectedWear(data,date,slot) {return data.wearLogs?.find(row=>row.date===date&&row.slot===slot&&!row.deletedAt)||null;}
export { samePieces };
