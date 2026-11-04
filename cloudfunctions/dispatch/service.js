'use strict';
const crypto=require('node:crypto');
const {KINDS,clean,validId,fingerprint,fail}=require('./model');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
function createHandler({store,appid}){
 return async function handle(event,identity){
  try{
   if(!identity||identity.APPID!==appid||!identity.OPENID||!['wx_client','wx_devtools'].includes(identity.SOURCE))fail(401,'请从当前微信小程序连接云开发');
   const owner=hash(appid+':'+identity.OPENID);
   if(!event||typeof event.route!=='string'||!event.route.startsWith('/api/')||event.route.length>2048)fail(400,'请求地址无效');
   const route=new URL(event.route,'https://dispatch.invalid'),path=route.pathname,method=event.method||'GET',b=event.body||{};
   if(!['GET','POST','PUT','DELETE'].includes(method))fail(405,'操作不支持');
   if(Buffer.byteLength(JSON.stringify(b),'utf8')>750*1024)fail(413,'单次请求过大，请拆分备份后再迁移');
   const account=await store.identity(owner),user={...account,orgId:owner,username:account.displayName};
   const capabilities={manageData:user.role==='admin',manageMembers:user.role==='admin'};
   const reply=data=>({ok:true,data});
   if(path==='/api/cloud/login'&&method==='POST')return reply({user,capabilities,mode:'cloudbase',schemaVersion:2});
   if(event.expectedUserId!==owner)fail(401,'当前微信身份已变化，请返回本地后重新连接；原账号草稿已保留');
   if(path==='/api/me'&&method==='GET')return reply({user,capabilities});
   if(path==='/api/profile'&&method==='PUT'){if(Object.keys(b).some(k=>k!=='displayName')||typeof b.displayName!=='string'||!b.displayName.trim()||b.displayName.trim().length>40)fail(400,'姓名或工号需为1至40个字，不可修改角色');return reply({user:{...await store.profile(owner,b.displayName.trim()),orgId:owner}})}
   if(path==='/api/admin/members'&&method==='GET')return reply({items:await store.members(owner)});
   const membership=path.match(/^\/api\/admin\/members\/([a-f0-9]{64})$/);
   if(membership&&method==='PUT'){
    if(user.role!=='admin')fail(403,'此操作仅限管理员');if(!['admin','member'].includes(b.role)||typeof b.active!=='boolean'||!validId(b.operationId)||!Number.isSafeInteger(b.baseRevision)||b.baseRevision<1||Object.keys(b).some(k=>!['role','active','operationId','baseRevision'].includes(k)))fail(400,'成员权限参数无效');
    return reply({member:await store.changeMember(owner,membership[1],b)});
   }
   if(path==='/api/management/authorize'&&method==='POST')return reply(await store.run(owner,[],async ctx=>{
    if(!['backup','shareBackup','migration','rollback'].includes(b.action))fail(400,'管理操作无效');const id=crypto.randomUUID();await ctx.saveReceipt('op',id,{action:'authorize-'+b.action,at:new Date().toISOString()});return {allowed:true,user:{...ctx.actor,orgId:owner},capabilities:{manageData:true,manageMembers:true}};
   },{admin:true}));
   if(path==='/api/auth/logout'&&method==='POST')return reply({ok:true});
   if(path==='/api/team'&&method==='GET')return reply({items:[user]});
   if(path==='/api/wechat/status'&&method==='GET')return reply({configured:false,bound:true,workerEnabled:false,reportedCredits:0,deliveries:[]});
   if(path.startsWith('/api/wechat/'))fail(503,'云开发订阅通知尚未配置真实模板与发送任务');
   const sync=path==='/api/sync',crud=path.match(/^\/api\/(tasks|customers|reminderStates)(?:\/([\w-]+))?$/),rollback=path.match(/^\/api\/migrations\/([\w-]+)\/rollback$/);
   const kind=sync?route.searchParams.get('kind'):crud&&crud[1];
   if((path==='/api/migrations'||rollback)&&user.role!=='admin')fail(403,'迁移和回滚仅限管理员');
   if((sync||crud)&&!KINDS.includes(kind))fail(400,'数据类型无效');
   if(sync||crud&&method==='GET'){
    const data=await store.run(owner,[kind],async({state})=>{
     const items=state[kind];if(crud&&crud[2]){const record=items.find(x=>x.id===crud[2]&&!x.deleted);if(!record)fail(404,'记录不存在或无权访问');return {record}}
     let filtered=sync?items:items.filter(x=>!x.deleted);const q=(route.searchParams.get('q')||'').toLowerCase(),status=route.searchParams.get('status');
     if(status)filtered=filtered.filter(x=>x.status===status);if(q)filtered=filtered.filter(x=>[x.client,x.name,x.phone,x.wasteName,x.plate,x.rawMessage].join(' ').toLowerCase().includes(q));
     let after='';const encoded=route.searchParams.get('cursor');if(encoded){let c;try{c=JSON.parse(Buffer.from(encoded,'base64url').toString())}catch(e){fail(400,'分页参数错误')}if(c.version!==state.version||c.kind!==kind||typeof c.lastId!=='string')fail(409,'同步快照已变化，请再次同步');after=c.lastId}
     const limit=Math.min(100,Math.max(1,Number(route.searchParams.get('limit'))||50)),remaining=filtered.slice().sort((a,b)=>a.id.localeCompare(b.id)).filter(x=>!after||x.id.localeCompare(after)>0),page=[];let bytes=0;
     for(const record of remaining){const size=Buffer.byteLength(JSON.stringify(record));if(page.length&&(page.length>=limit||bytes+size>192*1024))break;page.push(record);bytes+=size}
     return {items:page,nextCursor:remaining.length>page.length?Buffer.from(JSON.stringify({version:state.version,kind,lastId:page[page.length-1].id})).toString('base64url'):''};
    });return reply(data);
   }
   if(crud&&crud[2]&&['PUT','DELETE'].includes(method)){
    const id=crud[2];if(!validId(id)||!validId(b.operationId)||!Number.isSafeInteger(b.baseRevision)||b.baseRevision<0)fail(400,'ID、操作ID或修订号无效');
    return reply(await store.run(owner,KINDS,async ctx=>{
     const {state}=ctx,old=state[kind].find(x=>x.id===id),requestHash=hash(JSON.stringify({kind,id,method,b})),prior=await ctx.receipt('op',b.operationId);
     if(prior){if(prior.requestHash!==requestHash)fail(409,'操作ID已用于其他请求');if(!old)fail(409,'记录已变化，请重新同步');return {record:old}}
     if(old&&old.revision!==b.baseRevision||!old&&b.baseRevision!==0)fail(409,'此记录已在其他设备修改，请核对两个版本',{remote:old||null});
     if(old&&old.deleted)fail(409,'此记录已删除，若要保留请另建记录',{remote:old});if(method==='DELETE'&&!old)fail(404,'记录不存在');
     let record=method==='DELETE'?{}:clean(kind,b.record);
     const find=(k,key)=>{const r=state[k].find(x=>x.id===key&&!x.deleted);if(!r)fail(404,'关联记录不存在或无权访问');return r};
     if(method!=='DELETE'){
      if(kind==='tasks'&&record.customerId)find('customers',record.customerId);if(kind==='reminderStates')find('tasks',record.taskId);
      if(kind==='tasks'&&!old&&!b.allowDuplicate&&state.tasks.some(x=>!x.deleted&&fingerprint(x)===fingerprint(record)))fail(409,'可能重复的清运需求，请人工核对后确认新建',{remote:null});
     }else if(kind==='customers'&&state.tasks.some(x=>!x.deleted&&x.customerId===id))fail(409,'该客户有关联任务，请先解除关联',{remote:old});
     const at=new Date().toISOString();record={...record,id,orgId:owner,ownerId:owner,sharedWith:[],createdAt:old?old.createdAt:at,updatedAt:at,revision:(old?old.revision:0)+1,deleted:method==='DELETE',history:[...(old&&old.history||[]).slice(-49),{at,by:owner,action:method==='DELETE'?'删除记录':old?'更新记录':'创建记录'}]};
     if(kind==='tasks'&&method!=='DELETE'){record.originalMessage=old?old.originalMessage||old.rawMessage||'':record.originalMessage||record.rawMessage;record.legacyHistory=old&&old.legacyHistory||[]}
     const i=state[kind].findIndex(x=>x.id===id);if(i<0)state[kind].push(record);else state[kind][i]=record;ctx.changed(kind);
     await ctx.saveReceipt('op',b.operationId,{requestHash,kind,recordId:id,action:method,at});return {record};
    }));
   }
   if(path==='/api/migrations'&&method==='POST'){
    if(!validId(b.batchId)||!Array.isArray(b.tasks)||!Array.isArray(b.customers)||b.tasks.length+b.customers.length>500)fail(400,'迁移每批最多500条，批次ID必须有效');
    return reply(await store.run(owner,KINDS,async ctx=>{
     const {state}=ctx,inputHash=hash(JSON.stringify(b)),prior=await ctx.receipt('batch',b.batchId);
     if(prior){if(prior.rolledBack)fail(409,'此批次已回滚，请使用新的批次ID');if(prior.inputHash!==inputHash)fail(409,'批次ID对应的数据已改变');return {batchId:b.batchId,created:prior.created,skipped:prior.skipped}}
     const created=[],skipped=[],customerMap={};
     for(const k of ['customers','tasks'])for(const raw of b[k]){
      if(!validId(raw.id))fail(400,'迁移记录ID不合法');const record=clean(k,raw),dup=state[k].find(x=>!x.deleted&&(x.id===raw.id||(k==='tasks'?fingerprint(x)===fingerprint(record):x.name.toLowerCase()===record.name.toLowerCase())));
      if(dup){skipped.push({kind:k,id:raw.id,canonicalId:dup.id});if(k==='customers')customerMap[raw.id]=dup.id;continue}
      if(state[k].some(x=>x.id===raw.id))fail(409,'迁移ID冲突，本批次未提交');if(k==='tasks'&&record.customerId){record.customerId=customerMap[record.customerId]||record.customerId;if(!state.customers.some(x=>x.id===record.customerId&&!x.deleted))fail(404,'关联客户不存在')}
      const at=new Date().toISOString(),item={...record,id:raw.id,orgId:owner,ownerId:owner,sharedWith:[],revision:1,deleted:false,createdAt:at,updatedAt:at,history:[{at,by:owner,action:'从本地备份迁移'}]};
      if(k==='tasks'){item.originalMessage=record.originalMessage||record.rawMessage;item.legacyHistory=Array.isArray(raw.history)?raw.history.slice(-50).map(x=>({at:String(x.at||'').slice(0,40),action:String(x.action||'').slice(0,150)})):[]}
      state[k].push(item);ctx.changed(k);created.push({kind:k,id:raw.id});if(k==='customers')customerMap[raw.id]=raw.id;
     }
     await ctx.saveReceipt('batch',b.batchId,{inputHash,created,skipped,at:new Date().toISOString(),rolledBack:false});return {batchId:b.batchId,created,skipped};
    },{admin:true}));
   }
   if(rollback&&method==='POST')return reply(await store.run(owner,KINDS,async ctx=>{
    const batch=await ctx.receipt('batch',rollback[1]);if(!batch)fail(404,'迁移批次不存在');if(batch.rolledBack)return {ok:true,alreadyRolledBack:true};
    for(const ref of batch.created){const r=ctx.state[ref.kind].find(x=>x.id===ref.id&&!x.deleted);if(!r||r.revision!==1)fail(409,'迁移记录已有后续修改，整批回滚已停止');if(ref.kind==='customers'&&ctx.state.tasks.some(x=>!x.deleted&&x.customerId===ref.id&&!batch.created.some(y=>y.kind==='tasks'&&y.id===x.id)))fail(409,'迁移客户已有后续关联任务，整批回滚已停止')}
    for(const ref of batch.created){const list=ctx.state[ref.kind],i=list.findIndex(x=>x.id===ref.id),r=list[i],at=new Date().toISOString();list[i]={id:r.id,orgId:owner,ownerId:owner,sharedWith:[],createdAt:r.createdAt,updatedAt:at,revision:r.revision+1,deleted:true,history:[{at,by:owner,action:'回滚迁移记录'}]};ctx.changed(ref.kind)}
    const {_id,...receipt}=batch;await ctx.saveReceipt('batch',rollback[1],{...receipt,rolledBack:true});return {ok:true};
   },{admin:true}));
   fail(404,'接口不存在');
  }catch(e){return {ok:false,status:e.status||503,error:e.status?e.message:'云端暂不可用，本次未提交，请稍后重试',...(e.status&&e.details?{details:e.details}:{})}}
 };
}
module.exports={createHandler};
