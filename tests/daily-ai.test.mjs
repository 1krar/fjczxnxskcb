import assert from 'node:assert/strict';
import { DAILY_CACHE_KEY, dailyIdentity, requestDaily, cachedDaily, canRequestDaily, unlockAISession, aiSessionStatus } from '../js/ai-client.js';

const storage=new Map();
globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
globalThis.sessionStorage={getItem:()=>null,removeItem:()=>{}};
globalThis.window=new EventTarget();
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});
let time=+new Date('2026-10-23T04:00:00Z');
const originalNow=Date.now;Date.now=()=>time;
let authenticated=false, expiresAt='', mode='success', calls=0, sent;
let output={sentence:'留一点空白给喜欢的小事，也挺好的。',basisIds:[]};
globalThis.fetch=async(url,options)=>{
  assert.equal(options.credentials,'same-origin');assert.equal(options.headers.Authorization,undefined,'new requests never send a saved PIN');
  if(url==='/api/ai-session'){
    if(options.method==='POST'){authenticated=true;expiresAt=new Date(time+30*86400000).toISOString();}
    return Response.json({authenticated,remembered:true,expiresAt:authenticated?expiresAt:null});
  }
  assert.equal(url,'/api/ai');calls++;sent=JSON.parse(options.body);
  if(mode==='offline')throw TypeError('network unavailable');
  if(mode==='expired'){authenticated=false;return Response.json({error:'expired',code:'unauthorized'},{status:401});}
  if(mode==='quota')return Response.json({error:'limit',code:'rate_limited'},{status:429});
  return Response.json({result:output});
};
await unlockAISession('012345',true);
const scope={semester:'test',className:'test'};
const facts=[{id:'date',text:'今天是2026-10-23。'},{id:'item:abc',text:'准备数学课上的公式。'},{id:'courses:today',text:'下午课表无课，私人安排未知。'}];
let key=dailyIdentity(scope,'2026-10-23',facts);
mode='offline';
const before=calls;
const first=requestDaily(key,facts);
assert.equal(requestDaily(key,facts),first,'same tab shares an in-flight request');
await assert.rejects(first,/network/);
assert.equal(calls,before+1);assert.equal(JSON.parse(storage.get(DAILY_CACHE_KEY)).automaticKey,undefined,'a failure never consumes the daily success marker');
assert.equal(canRequestDaily(key),false,'backoff prevents immediate rerender loops');
await requestDaily(key,facts);assert.equal(calls,before+1);
time+=61000;assert.equal(canRequestDaily(key),true);
mode='success';output={sentence:'数学课的公式可以顺手放在笔记首页。',basisIds:['item:abc']};
const success=await requestDaily(key,facts);
assert.equal(success.sentence,output.sentence);assert.equal(cachedDaily(key).sentence,output.sentence);
assert.equal(canRequestDaily(key),false,'a successful day is not generated again on ticks');
time+=61000;
output={sentence:'留一点空白给喜欢的小事，也挺好的。',basisIds:[]};
await requestDaily(key,facts,true);
assert.ok(!sent.facts.some(f=>f.id==='item:abc'),'a just-mentioned item is not repeatedly fed as a compulsory topic');
assert.ok(sent.recentTopics.some(row=>row.ids.includes('item:abc')));
assert.equal(cachedDaily(key).basisIds.length,0,'generic conversation needs no invented personal evidence');
const changedKey=dailyIdentity(scope,'2026-10-23',[...facts,{id:'new',text:'记录更新。'}]);
await requestDaily(changedKey,facts);assert.equal(calls,before+3,'record changes do not trigger a second automatic generation that day');

// Next day: failed automatic work resumes after reauthorization instead of being permanently settled.
time+=86400000;key=dailyIdentity(scope,'2026-10-24',facts);mode='expired';
await assert.rejects(()=>requestDaily(key,facts),/expired/);
assert.equal(aiSessionStatus().status,'locked');assert.equal(canRequestDaily(key),true,'new authorization can retry without the previous long auth backoff');
time+=1000;await unlockAISession('012345',true);mode='success';
assert.equal(canRequestDaily(key),true);await requestDaily(key,facts);
assert.ok(cachedDaily(key));

// Quota failures back off and automatic retry is bounded even if ticks continue.
time+=86400000;key=dailyIdentity(scope,'2026-10-25',facts);mode='quota';
await assert.rejects(()=>requestDaily(key,facts),/limit/);time+=61000;
assert.equal(canRequestDaily(key),false,'quota backoff is longer than one minute');
time+=5*60000;await assert.rejects(()=>requestDaily(key,facts),/limit/);
time+=5*60000;await assert.rejects(()=>requestDaily(key,facts),/limit/);
time+=5*60000;assert.equal(canRequestDaily(key),false,'stop after three automatic failures');
assert.equal(canRequestDaily(key,true),true,'explicit manual retry remains available');

// Another tab's lease must not cause an immediate paid call or an infinite render loop.
time+=86400000;key=dailyIdentity(scope,'2026-10-26',facts);mode='success';
storage.set(DAILY_CACHE_KEY+'-lease',JSON.stringify({id:'other-tab',until:time+40000}));
const previous=calls;assert.equal(await requestDaily(key,facts),null);assert.equal(calls,previous);
assert.equal(canRequestDaily(key),false);time+=41000;assert.equal(canRequestDaily(key),true);
await requestDaily(key,facts);assert.ok(cachedDaily(key));
time+=86400000;key=dailyIdentity(scope,'2026-10-27',facts);
globalThis.navigator.locks={request:async(name,options,callback)=>{assert.equal(options.ifAvailable,true);return callback(null);}};
const beforeLock=calls;assert.equal(await requestDaily(key,facts),null);assert.equal(calls,beforeLock);assert.equal(canRequestDaily(key),false,'unavailable Web Lock also waits before retry');
Date.now=originalNow;
console.log('Daily AI: success-only caching, bounded retries, restore after expiry, per-day auto cap, cross-tab lease and topic rotation passed.');
