'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fakeDb,APPID,userId}=require('./helpers/cloud-db'),{createHandler}=require('../cloudfunctions/dispatch/service'),{createStore}=require('../cloudfunctions/dispatch/store');
async function setup(openid){
 const config=require('../miniprogram/cloud.config'),previousConfig={...config};Object.assign(config,{enabled:true,env:'test-environment'});
 const db=fakeDb(),handle=createHandler({store:createStore(db),appid:APPID}),storage=new Map([['hazwaste_dispatch_v1',[{id:'legacy-task',client:'本机虚构记录'}]]]);let page,writes=0,shares=0,offline=false;
 global.wx={env:{USER_DATA_PATH:'/fake'},getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,structuredClone(v)),removeStorageSync:k=>storage.delete(k),showModal:()=>{},getFileSystemManager:()=>({writeFileSync(){writes++}}),shareFileMessage(){shares++},cloud:{init(){},callFunction(a){if(offline)return a.fail();handle(a.data,{APPID,OPENID:openid,SOURCE:'wx_client'}).then(result=>a.success({result})).catch(a.fail)}}};
 for(const f of ['../miniprogram/utils/data','../miniprogram/utils/cloud','../miniprogram/pages/operations/operations'])delete require.cache[require.resolve(f)];const Data=require('../miniprogram/utils/data');await Data.loginCloud();global.Page=p=>{page=p};require('../miniprogram/pages/operations/operations');page.data=structuredClone(page.data);page.setData=function(v){Object.assign(this.data,v)};
 return {Data,page,handle,db,get writes(){return writes},get shares(){return shares},goOffline(){offline=true},cleanup(){Object.assign(config,previousConfig);delete global.wx;delete global.Page}};
}
test('staff management tools stay unavailable even when cached roles or page flags are forged',async()=>{
 const s=await setup('openid-b');try{s.Data.getSession().user.role='admin';await s.page.refreshAccess();assert.equal(s.page.data.roleLabel,'普通员工');assert.equal(s.page.data.canManage,false);s.page.data.canManage=true;await s.page.backup();await s.page.migrate();await s.page.rollback();assert.equal(s.writes,0);assert.equal(s.page.data.canManage,false);assert.equal(s.Data.repo.legacy().tasks.length,1)}finally{s.cleanup()}
});
test('a previously generated administrator backup cannot be shared after role revocation',async()=>{
 const s=await setup('openid-a');try{await s.page.refreshAccess();assert.equal(s.page.data.canManage,true);await s.page.backup();assert.equal(s.writes,1);const call=(who,route,method,body)=>s.handle({route,method,body,expectedUserId:userId(who)},{APPID,OPENID:who,SOURCE:'wx_client'});await call('openid-b','/api/cloud/login','POST',{});let b=(await call('openid-a','/api/admin/members','GET',{})).data.items.find(x=>x.id===userId('openid-b'));await call('openid-a','/api/admin/members/'+b.id,'PUT',{role:'admin',active:true,baseRevision:b.revision,operationId:'ui-promote-b'});const a=(await call('openid-b','/api/admin/members','GET',{})).data.items.find(x=>x.id===userId('openid-a'));await call('openid-b','/api/admin/members/'+a.id,'PUT',{role:'member',active:true,baseRevision:a.revision,operationId:'ui-demote-a'});await s.page.shareBackup();assert.equal(s.shares,0);assert.equal(s.page.data.canManage,false)}finally{s.cleanup()}
});
test('offline role validation fails closed for management without removing cached business records',async()=>{
 const s=await setup('openid-a');try{await s.page.refreshAccess();assert.equal(s.page.data.canManage,true);s.goOffline();await s.page.refreshAccess();assert.equal(s.page.data.canManage,false);assert.equal(s.page.data.roleVerified,false);await s.page.backup();assert.equal(s.writes,0);assert.equal(s.Data.repo.legacy().tasks[0].id,'legacy-task')}finally{s.cleanup()}
});
