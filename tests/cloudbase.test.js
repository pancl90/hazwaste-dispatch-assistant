'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHandler}=require('../cloudfunctions/dispatch/service');
const {createStore}=require('../cloudfunctions/dispatch/store');
const {createRepository}=require('../miniprogram/utils/repository');
const APPID='wx0000000000000000';
const {fakeDb}=require('./helpers/cloud-db');
function setup(options){const db=fakeDb(),handle=createHandler({store:createStore(db,options),appid:APPID});return {db,handle,async account(openid){const ctx={APPID,OPENID:openid,SOURCE:'wx_client'},login=await handle({route:'/api/cloud/login',method:'POST'},ctx);assert.equal(login.ok,true);const user=login.data.user;return {user,async call(route,method='GET',body){const r=await handle({route,method,body,expectedUserId:user.id},ctx);if(!r.ok){const e=Error(r.error);e.status=r.status;e.details=r.details;throw e}return r.data}}}}}
const task=(client='虚构测试工厂')=>({client,pickupDate:'2026-11-05',timeWindow:'上午',wasteName:'废液',weight:'2吨',packaging:'10桶',rawMessage:client+'清运废液2吨10桶',status:'待安排'});
test('CloudBase authenticates official context, ignores forged ownership and isolates two WeChat accounts',async()=>{
 const s=setup(),a=await s.account('openid-a'),b=await s.account('openid-b');
 const unauth=await s.handle({route:'/api/cloud/login',method:'POST',OPENID:'openid-a'},{APPID,OPENID:'',SOURCE:'wx_client'});assert.equal(unauth.status,401);
 const http=await s.handle({route:'/api/cloud/login',method:'POST'},{APPID,OPENID:'openid-a',SOURCE:'http'});assert.equal(http.status,401);
 const wrongApp=await s.handle({route:'/api/cloud/login',method:'POST'},{APPID:'other',OPENID:'openid-a',SOURCE:'wx_client'});assert.equal(wrongApp.status,401);
 const one=await a.call('/api/tasks/task-1','PUT',{record:{...task(),ownerId:b.user.id,orgId:'forged'},baseRevision:0,operationId:'create-1'});assert.equal(one.record.ownerId,a.user.id);
 assert.equal((await b.call('/api/sync?kind=tasks')).items.length,0);await assert.rejects(b.call('/api/tasks/task-1'),e=>e.status===404);
 const mismatch=await s.handle({route:'/api/sync?kind=tasks',expectedUserId:a.user.id},{APPID,OPENID:'openid-b',SOURCE:'wx_client'});assert.equal(mismatch.status,401);
});
test('CloudBase reuses the offline queue, deduplicates lost responses and preserves conflicting edits',async()=>{
 const s=setup(),a=await s.account('openid-a');let lost=false;const make=()=>{const m=new Map(),r=createRepository({get:k=>m.get(k),set:(k,v)=>m.set(k,structuredClone(v))});r.connect({scope:'test:'+a.user.id,request:async(...args)=>{const v=await a.call(...args);if(lost&&args[1]==='PUT'){lost=false;throw Error('response lost')}return v}});return r};const r1=make(),r2=make();r1.save('tasks',[{id:'task-1',...task()}]);lost=true;await assert.rejects(r1.sync());assert.equal(r1.status().pending,1);await r1.sync();await r2.sync();assert.equal(r2.list('tasks').length,1);r1.save('tasks',[{...r1.list('tasks')[0],plate:'甲'}]);r2.save('tasks',[{...r2.list('tasks')[0],plate:'乙'}]);await r1.sync();await r2.sync();assert.equal(r2.status().conflicts.length,1);assert.equal(r2.list('tasks')[0].plate,'乙');r2.resolve('tasks','task-1','remote');await r2.sync();assert.equal(r2.list('tasks')[0].plate,'甲');
});
test('CloudBase migration is atomic, repeatable and rolls back only unchanged records',async()=>{
 const s=setup(),a=await s.account('openid-a'),input={batchId:'batch-1',customers:[{id:'customer-1',name:'虚构客户',aliases:[]}],tasks:[{id:'task-1',...task(),customerId:'customer-1'}]};
 const result=await a.call('/api/migrations','POST',input);assert.equal(result.created.length,2);assert.deepEqual(await a.call('/api/migrations','POST',input),result);
 await assert.rejects(a.call('/api/migrations','POST',{...input,tasks:[]}),e=>e.status===409);
 await a.call('/api/migrations/batch-1/rollback','POST',{});assert.equal((await a.call('/api/tasks')).items.length,0);assert.equal((await a.call('/api/customers')).items.length,0);
 await assert.rejects(a.call('/api/migrations','POST',{batchId:'bad-batch',customers:[{id:'new-customer',name:'应当回滚'}],tasks:[{id:'bad-task',...task(),customerId:'not-found'}]}),e=>e.status===404);assert.equal((await a.call('/api/customers')).items.length,0);
 const next={batchId:'batch-2',customers:[],tasks:[{id:'task-2',...task('另一虚构工厂')}]};await a.call('/api/migrations','POST',next);await a.call('/api/tasks/task-2','PUT',{record:task('已经修改'),baseRevision:1,operationId:'modify-2'});await assert.rejects(a.call('/api/migrations/batch-2/rollback','POST',{}),e=>e.status===409);assert.equal((await a.call('/api/tasks/task-2')).record.client,'已经修改');
});
test('CloudBase freezes first original text, validates links, rejects stale snapshot cursors and retains audit metadata',async()=>{
 const s=setup(),a=await s.account('openid-a');await a.call('/api/tasks/task-1','PUT',{record:task(),baseRevision:0,operationId:'original-1'});await a.call('/api/tasks/task-1','PUT',{record:{...task(),rawMessage:'更正通知',originalMessage:'尝试覆盖'},baseRevision:1,operationId:'original-2'});assert.equal((await a.call('/api/tasks/task-1')).record.originalMessage,task().rawMessage);
 await assert.rejects(a.call('/api/reminderStates/state-1','PUT',{record:{taskId:'missing-task',reminderKey:'test'},baseRevision:0,operationId:'bad-ref-1'}),e=>e.status===404);
 await a.call('/api/tasks/task-2','PUT',{record:task('其他工厂'),baseRevision:0,operationId:'original-3'});const p=await a.call('/api/sync?kind=tasks&limit=1');assert.ok(p.nextCursor);await a.call('/api/tasks/task-3','PUT',{record:task('第三工厂'),baseRevision:0,operationId:'original-4'});await assert.rejects(a.call('/api/sync?kind=tasks&cursor='+encodeURIComponent(p.nextCursor)),e=>e.status===409);
 const receipts=[...s.db.docs.entries()].filter(([k])=>k.startsWith('dispatch_operations_v1')).map(([,v])=>v);assert.ok(receipts.length>=4);assert.equal(JSON.stringify(receipts).includes(task().rawMessage),false);
});
test('CloudBase capacity and database failures never replace committed data or report false success',async()=>{
 const s=setup({maxBytes:4000}),a=await s.account('openid-a');await a.call('/api/tasks/task-1','PUT',{record:task(),baseRevision:0,operationId:'capacity-1'});await assert.rejects(a.call('/api/tasks/task-2','PUT',{record:{...task('容量测试'),rawMessage:'仅测试'.repeat(1500)},baseRevision:0,operationId:'capacity-2'}),e=>e.status===413);assert.equal((await a.call('/api/tasks')).items.length,1);s.db.breakWrites();await assert.rejects(a.call('/api/tasks/task-1','DELETE',{baseRevision:1,operationId:'failure-1'}),e=>e.status===503);assert.equal((await a.call('/api/tasks/task-1')).record.deleted,false);
});
