'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fakeDb,APPID,userId}=require('./helpers/cloud-db');
const {createHandler}=require('../cloudfunctions/dispatch/service'),{createStore}=require('../cloudfunctions/dispatch/store');
function setup(options){const db=fakeDb(options),store=createStore(db),handle=createHandler({store,appid:APPID});const call=async(openid,route,method='GET',body={},extra={})=>handle({route,method,body,expectedUserId:userId(openid),...extra},{APPID,OPENID:openid,SOURCE:'wx_client'});return {db,store,handle,call}}
async function member(s,openid){const r=await s.call(openid,'/api/cloud/login','POST');assert.equal(r.ok,true);return r.data.user}
async function change(s,actor,target,patch,op){return s.call(actor,'/api/admin/members/'+target.id,'PUT',{...patch,baseRevision:target.revision,operationId:op})}
test('roles require an out-of-band initialized roster; new WeChat users never bootstrap themselves as admin',async()=>{
 const empty=setup({seed:false}),denied=await empty.call('openid-a','/api/cloud/login','POST',{}, {role:'admin'});assert.equal(denied.status,503);assert.equal(empty.db.docs.size,0);
 const s=setup();assert.equal((await member(s,'openid-a')).role,'admin');const b=await member(s,'openid-b');assert.equal(b.role,'member');assert.equal((await s.call('openid-b','/api/admin/members','GET',{}, {role:'admin'})).status,403);
 assert.equal((await s.call('openid-b','/api/tasks/member-task','PUT',{record:{client:'员工自己的虚构任务'},baseRevision:0,operationId:'member-create'})).ok,true);
 assert.equal((await s.call('openid-b','/api/profile','PUT',{displayName:'员工',role:'admin'})).status,400);
});
test('ordinary staff cannot authorize exports or invoke migration/rollback directly, and denial is atomic',async()=>{
 const s=setup();await member(s,'openid-b');const before=structuredClone(s.db.docs);
 for(const [route,method,body] of [['/api/management/authorize','POST',{action:'backup'}],['/api/management/authorize','POST',{action:'shareBackup'}],['/api/migrations','POST',{batchId:'staff-batch',customers:[],tasks:[]}],['/api/migrations/staff-batch/rollback','POST',{}]])assert.equal((await s.call('openid-b',route,method,body)).status,403,route);
 assert.deepEqual(s.db.docs,before);assert.equal((await s.call('openid-a','/api/management/authorize','POST',{action:'backup'})).ok,true);
});
test('server role changes take effect on the next request, including stale cached admin claims and replays',async()=>{
 const s=setup(),b=await member(s,'openid-b');const grant=await change(s,'openid-a',b,{role:'admin',active:true},'grant-member');assert.equal(grant.ok,true);assert.equal((await s.call('openid-b','/api/management/authorize','POST',{action:'backup'})).ok,true);
 const demote=await change(s,'openid-a',grant.data.member,{role:'member',active:true},'revoke-member');assert.equal(demote.ok,true);assert.equal((await s.call('openid-b','/api/migrations','POST',{batchId:'stale-role',customers:[],tasks:[]},{role:'admin'})).status,403);
 assert.equal((await s.call('openid-b','/api/admin/members')).status,403);assert.equal((await change(s,'openid-a',b,{role:'admin',active:true},'stale-grant')).status,409);
 const replay=await change(s,'openid-a',b,{role:'admin',active:true},'grant-member');assert.equal(replay.ok,true);assert.equal(replay.data.member.role,'member','replaying an old grant must not restore privileges');
});
test('the final active administrator cannot be demoted or disabled, including concurrent admin changes',async()=>{
 const s=setup(),a=await member(s,'openid-a'),b=await member(s,'openid-b');assert.equal((await change(s,'openid-a',a,{role:'member',active:true},'demote-last')).status,409);assert.equal((await change(s,'openid-a',a,{role:'admin',active:false},'disable-last')).status,409);
 const promoted=await change(s,'openid-a',b,{role:'admin',active:true},'promote-second');const results=await Promise.all([change(s,'openid-a',promoted.data.member,{role:'member',active:true},'parallel-b'),change(s,'openid-b',a,{role:'member',active:true},'parallel-a')]);assert.equal(results.filter(r=>r.ok).length,1);const roster=s.db.docs.get('dispatch_members_v1dispatch_team_roles_v1');assert.equal(roster.members.filter(m=>m.active&&m.role==='admin').length,1);
});
test('disabling staff stops cloud reads and writes but reactivation preserves their existing business data',async()=>{
 const s=setup(),b=await member(s,'openid-b');await s.call('openid-b','/api/tasks/member-task','PUT',{record:{client:'保留的虚构客户'},baseRevision:0,operationId:'keep-own-task'});const off=await change(s,'openid-a',b,{role:'member',active:false},'disable-user');assert.equal(off.ok,true);assert.equal((await s.call('openid-b','/api/cloud/login','POST')).status,403);assert.equal((await s.call('openid-b','/api/sync?kind=tasks')).status,403);assert.equal((await s.call('openid-b','/api/tasks/member-task','DELETE',{baseRevision:1,operationId:'stopped-delete'})).status,403);await change(s,'openid-a',off.data.member,{role:'member',active:true},'enable-user');assert.equal((await s.call('openid-b','/api/tasks/member-task')).data.record.client,'保留的虚构客户');assert.equal((await s.call('openid-a','/api/tasks/member-task')).status,404,'admin role does not silently share employee business records');
});
