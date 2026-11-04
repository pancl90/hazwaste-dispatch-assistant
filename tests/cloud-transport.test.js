'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHandler}=require('../cloudfunctions/dispatch/service');
const {createStore}=require('../cloudfunctions/dispatch/store');const {fakeDb}=require('./helpers/cloud-db');
const copy=v=>structuredClone(v);
test('native cloud transport retains local records, isolates caches, and stops uploads after a WeChat identity switch',async()=>{
 let who='openid-a';const store=createStore(fakeDb());
 const handle=createHandler({store,appid:'wx0000000000000000'}),memory=new Map([['hazwaste_dispatch_v1',[{id:'local-only',client:'仅在本机的虚构客户'}]]]);let requests=0;
 global.wx={getStorageSync:k=>memory.get(k),setStorageSync:(k,v)=>memory.set(k,copy(v)),removeStorageSync:k=>memory.delete(k),request:()=>{throw Error('must use official cloud transport')},cloud:{init:config=>assert.equal(config.traceUser,false),callFunction:args=>{requests++;handle(args.data,{APPID:'wx0000000000000000',OPENID:who,SOURCE:'wx_client'}).then(result=>args.success({result})).catch(args.fail)}}};
 for(const file of ['../miniprogram/utils/data','../miniprogram/utils/cloud'])delete require.cache[require.resolve(file)];const Data=require('../miniprogram/utils/data');
 assert.equal(requests,0,'opening the app must not upload or login automatically');const Cloud=require('../miniprogram/utils/cloud'),wasEnabled=Cloud.config.enabled;Cloud.config.enabled=false;await assert.rejects(Data.loginCloud(),/云开发未启用/);assert.equal(requests,0);Cloud.config.enabled=true;await Data.loginCloud();await Data.repo.sync();assert.equal(Data.repo.list('tasks').length,0);assert.equal(Data.repo.legacy().tasks.length,1);assert.equal(memory.get('dispatch_session_v2').token,undefined);
 const firstScope=Data.repo.status().scope;Data.repo.save('tasks',[{id:'cloud-task',client:'虚构云客户',rawMessage:'测试',status:'待安排'}]);await Data.repo.sync();assert.equal(Data.repo.list('tasks')[0].revision,1);
 Data.repo.save('tasks',[{...Data.repo.list('tasks')[0],plate:'未同步修改'}]);who='openid-b';await assert.rejects(Data.repo.sync(),e=>e.status===401);assert.equal(Data.repo.status().pending,1);
 await Data.logout();assert.equal(Data.repo.list('tasks')[0].id,'local-only');await Data.loginCloud();assert.notEqual(Data.repo.status().scope,firstScope);await Data.repo.sync();assert.equal(Data.repo.list('tasks').length,0);await Data.logout();who='openid-a';await Data.loginCloud();assert.equal(Data.repo.status().scope,firstScope);assert.equal(Data.repo.list('tasks')[0].plate,'未同步修改');assert.equal(Data.repo.status().pending,1);
 Cloud.config.enabled=wasEnabled;delete global.wx;
});
