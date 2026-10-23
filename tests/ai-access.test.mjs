import assert from 'node:assert/strict';
import { validAccessToken } from '../js/ai-access.js';
import { saveAISettings, readAISettings, aiEnabled, unlockAISession, aiSessionStatus, logoutAISession, restoreAISession } from '../js/ai-client.js';
const session=new Map(),persistent=new Map();
globalThis.sessionStorage={getItem:key=>session.get(key)??null,setItem:(key,value)=>session.set(key,value),removeItem:key=>session.delete(key)};
globalThis.localStorage={getItem:key=>persistent.get(key)??null,setItem:(key,value)=>persistent.set(key,value),removeItem:key=>persistent.delete(key)};
globalThis.window=new EventTarget();
let authenticated=false, remembered=false, droppedCookie=false, statusCalls=0, postCalls=0;
globalThis.fetch=async(url,options)=>{
  assert.equal(url,'/api/ai-session');assert.equal(options.credentials,'same-origin');
  if(options.method==='POST'){
    postCalls++;const body=JSON.parse(options.body);
    if(body.action==='unlock'){
      if(body.token!=='012345')return Response.json({error:'incorrect',code:'unauthorized'},{status:401});
      authenticated=!droppedCookie;remembered=body.remember;
    }else authenticated=false;
  }else statusCalls++;
  return Response.json({authenticated,remembered,expiresAt:authenticated?new Date(Date.now()+86400000).toISOString():null});
};
assert.equal(validAccessToken('012345'),true);
assert.equal(validAccessToken('test-long-token-with-24-characters'),true);
for(const value of ['12345','1234567','abcdef','123456\n',' 123456','１２３４５６',123456,null])assert.equal(validAccessToken(value),false,String(value));
saveAISettings({enabled:true,notice:true,daily:true,rememberDevice:true});
assert.equal(aiEnabled('notice'),false,'settings alone never claim unlocked');
await Promise.all([restoreAISession(true),restoreAISession(true)]);
assert.equal(statusCalls,1,'concurrent restore is deduplicated');
await assert.rejects(()=>unlockAISession('12345',true),/6位数字/);assert.equal(postCalls,0);
await unlockAISession('012345',true);
assert.equal(aiEnabled('notice'),true);assert.equal(aiSessionStatus().remembered,true);
assert.equal(readAISettings().rememberDevice,true);
assert.doesNotMatch(JSON.stringify([...persistent,...session]),/012345/,'neither local nor session storage keeps a new PIN');
await assert.rejects(()=>unlockAISession('999999'),/incorrect/);
assert.equal(aiEnabled('notice'),true,'a failed new PIN does not falsely discard a valid session');
await logoutAISession();assert.equal(aiEnabled('notice'),false);
droppedCookie=true;
await assert.rejects(()=>unlockAISession('012345',true),/未保留授权/,'blocked cookies cannot yield false unlock success');
assert.equal(aiSessionStatus().status,'locked');
console.log('Access client: PIN validation, restore dedup, cookie confirmation, remember preference, no PIN storage and logout passed.');
