'use strict';const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');const {createApplication}=require('../backend/application');const {createWechat}=require('../backend/wechat');
test('notifications require official identity + active consent; replay/daily dedupe and unknown result stop retry',async t=>{
 const sent=[],adapter={ready:()=>true,templateId:'real-template-configured',exchange:async code=>{assert.equal(code,'wx-official-test-code');return 'test-openid'},send:async(...args)=>sent.push(args)};
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dispatch-notice-')),app=createApplication({dataDir:dir,key:Buffer.alloc(32,9),allowHttp:true,wechatAdapter:adapter});t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true})});
 await app.addUser({username:'notifier',password:'Test-notification-123!',orgId:'test-org'});await app.listen(0);const base='http://127.0.0.1:'+app.port;
 let token='';async function call(route,body,method='POST'){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()}}
 token=(await call('/api/auth/login',{username:'notifier',password:'Test-notification-123!'})).body.token;
 await call('/api/tasks/notice-task',{record:{client:'不能泄露的测试客户',status:'待安排',pickupDate:'2026-10-01',rawMessage:'不应发送到微信模板的原文'},baseRevision:0,operationId:'notice-create'},'PUT');
 await app.runNotifications(new Date('2026-10-31T09:00:00+08:00'));assert.equal(sent.length,0);
 assert.equal((await call('/api/wechat/subscription',{challengeId:'fake',result:'accept'})).status,400);
 await call('/api/wechat/bind',{code:'wx-official-test-code'});
 const rejected=(await call('/api/wechat/subscription/challenge',{})).body;await call('/api/wechat/subscription',{challengeId:rejected.challengeId,result:'reject'});await app.runNotifications(new Date('2026-10-31T09:00:00+08:00'));assert.equal(sent.length,0);
 const challenge=(await call('/api/wechat/subscription/challenge',{})).body;const consent={challengeId:challenge.challengeId,result:'accept'};await call('/api/wechat/subscription',consent);await call('/api/wechat/subscription',consent);assert.equal(app.store.state.subscriptions.length,1);
 await app.runNotifications(new Date('2026-10-31T09:00:00+08:00'));await app.runNotifications(new Date('2026-10-31T10:00:00+08:00'));assert.equal(sent.length,1);assert.deepEqual(sent[0],['test-openid',1,'2026-10-31']);
 await app.runNotifications(new Date('2026-11-01T09:00:00+08:00'));assert.equal(sent.length,1);
 const second=(await call('/api/wechat/subscription/challenge',{})).body;await call('/api/wechat/subscription',{challengeId:second.challengeId,result:'accept'});adapter.send=async()=>{throw Error('timeout after send')};await app.runNotifications(new Date('2026-11-01T09:00:00+08:00'));assert.equal(app.store.state.deliveries.at(-1).status,'unknown');await app.runNotifications(new Date('2026-11-01T10:00:00+08:00'));assert.equal(app.store.state.deliveries.length,2);
});
test('official adapter sends only mapped generic data and never claims success on WeChat errors',async()=>{
 const calls=[],config={appId:'test-app',appSecret:'test-secret',templateId:'test-template',templateData:{thing1:'summary',number2:'count'}};
 const adapter=createWechat(config,async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.includes('/token?')?{access_token:'fake-access-token',expires_in:7200}:url.includes('jscode2session')?{openid:'test-openid'}:{errcode:43101,errmsg:'rejected'}}});
 assert.equal(await adapter.exchange('official-code'),'test-openid');await assert.rejects(adapter.send('test-openid',3,'2026-10-31'),e=>e.wechatCode===43101);assert.ok(calls.every(c=>c.url.startsWith('https://api.weixin.qq.com/')));const payload=JSON.parse(calls.at(-1).options.body);assert.deepEqual(payload.data,{thing1:{value:'有3条清运待办需跟进'},number2:{value:'3'}});
});
