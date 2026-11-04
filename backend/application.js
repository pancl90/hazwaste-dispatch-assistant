'use strict';
const http=require('node:http');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {promisify}=require('node:util');
const scrypt=promisify(crypto.scrypt);const {Store,audit}=require('./store');const {KINDS,fail,validId,visible,clean,fingerprint}=require('./model');const {createWechat}=require('./wechat');const {remindersFor,chinaTime}=require('../miniprogram/utils/reminders');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');const uid=()=>crypto.randomUUID();
function createApplication(options){
 const opts=options||{},store=new Store(opts.dataDir,opts.key),wechat=opts.wechatAdapter||createWechat(opts.wechat||{},opts.fetch),root=path.resolve(__dirname,'..'),attempts=new Map();let port=0,workerBusy=false,timer=null;
 function current(req){const token=(req.headers.authorization||'').replace(/^Bearer /,'');const session=store.state.sessions.find(s=>s.hash===hash(token)&&s.expiresAt>Date.now());if(!token||!session)fail(401,'登录已过期，请重新登录');const user=store.state.users.find(u=>u.id===session.userId&&u.active!==false);if(!user)fail(401,'账号不可用');return user}
 function find(s,kind,id,user,deleted){const r=s[kind].find(x=>x.id===id&&visible(x,user)&&(deleted||!x.deleted));if(!r)fail(404,'记录不存在或无权访问');return r}
 function safeUser(user){return {id:user.id,orgId:user.orgId,username:user.username,role:user.role}}
 async function addUser(input){if(!/^[a-zA-Z0-9_.-]{3,64}$/.test(input.username)||typeof input.password!=='string'||input.password.length<12||input.password.length>128||!validId(input.orgId)||!['admin','member'].includes(input.role||'member'))fail(400,'用户名、组织ID或密码不符合要求（密码至少12位）');const salt=crypto.randomBytes(16).toString('hex'),derived=(await scrypt(input.password,salt,64)).toString('hex');return store.transact(s=>{if(s.users.some(u=>u.username===input.username))fail(409,'用户名已存在');const user={id:uid(),username:input.username,orgId:input.orgId,role:input.role||'member',active:true,salt,passwordHash:derived};s.users.push(user);audit(s,user,'create-user','users',user.id);return safeUser(user)})}
 function json(res,status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body))}
 async function body(req){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)fail(413,'请求超过2MB，请分批迁移');chunks.push(chunk)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch(e){fail(400,'JSON 格式错误')}}
 function page(items,url){const limit=Math.min(200,Math.max(1,Number(url.searchParams.get('limit'))||100));let after='';const cursor=url.searchParams.get('cursor');if(cursor){let c;try{c=JSON.parse(Buffer.from(cursor,'base64url').toString())}catch(e){fail(400,'分页参数错误')}if(c.version!==(store.state.dataVersion||0))fail(409,'同步快照已更新，请再次同步');after=c.lastId}
  const rest=items.slice().sort((a,b)=>a.id.localeCompare(b.id)).filter(x=>!after||x.id.localeCompare(after)>0),result=rest.slice(0,limit);return {items:result,nextCursor:rest.length>limit?Buffer.from(JSON.stringify({lastId:result[result.length-1].id,version:store.state.dataVersion||0})).toString('base64url'):''};}
 function mutate(user,kind,id,method,b){
  if(!validId(id)||!validId(b.operationId)||!Number.isSafeInteger(b.baseRevision)||b.baseRevision<0)fail(400,'ID、操作ID或修订号无效');
  return store.transact(s=>{
   const previous=s.operations.find(x=>x.userId===user.id&&x.orgId===user.orgId&&x.id===b.operationId);const requestHash=hash(JSON.stringify({kind,id,method,b}));if(previous){if(previous.requestHash!==requestHash)fail(409,'操作ID已用于其他请求');return {record:find(s,kind,id,user,true)}}
   const old=s[kind].find(x=>x.id===id);if(old&&!visible(old,user))fail(404,'记录不存在或无权访问');if(old&&old.revision!==b.baseRevision||!old&&b.baseRevision!==0)fail(409,'此记录已在其他设备修改，请核对两个版本',{remote:old||null});
   if(old&&old.deleted)fail(409,'此记录已删除，若要保留请另建记录',{remote:old});if(method==='DELETE'&&!old)fail(404,'记录不存在');
   let record=method==='DELETE'?{}:clean(kind,b.record);
   if(method!=='DELETE'){
    if(kind==='tasks'&&record.customerId)find(s,'customers',record.customerId,user,false);
    if(kind==='reminderStates')find(s,'tasks',record.taskId,user,false);
    if(kind==='tasks'&&!old&&!b.allowDuplicate){const dup=s.tasks.find(t=>!t.deleted&&t.ownerId===user.id&&t.orgId===user.orgId&&fingerprint(t)===fingerprint(record));if(dup)fail(409,'可能重复的清运需求，请核对后选择保留本地版本以确认新建',{remote:null,duplicateId:dup.id})}
   }else if(kind==='customers'&&s.tasks.some(t=>!t.deleted&&t.customerId===id))fail(409,'该客户有关联任务，请先解除关联',{remote:old});
   const stamp=new Date().toISOString();record={...record,id,orgId:user.orgId,ownerId:old?old.ownerId:user.id,sharedWith:old?old.sharedWith||[]:[],createdAt:old?old.createdAt:stamp,updatedAt:stamp,revision:(old?old.revision:0)+1,deleted:method==='DELETE'};
   const action=method==='DELETE'?'删除记录':old?'更新记录':'创建记录';record.history=[...(old&&old.history||[]).slice(-49),{at:stamp,by:user.id,action}];
   if(kind==='tasks'&&method!=='DELETE'){record.legacyHistory=old&&old.legacyHistory||[];record.originalMessage=old?old.originalMessage||old.rawMessage||'':record.originalMessage||record.rawMessage}
   const index=s[kind].findIndex(x=>x.id===id);if(index<0)s[kind].push(record);else s[kind][index]=record;s.dataVersion=(s.dataVersion||0)+1;audit(s,user,method==='DELETE'?'delete':old?'update':'create',kind,id,Object.keys(method==='DELETE'?{}:clean(kind,b.record)));
   const result={record};s.operations.push({id:b.operationId,userId:user.id,orgId:user.orgId,requestHash,kind,recordId:id});return result;
  });
 }
 async function api(req,res,url){
  const route=url.pathname,method=req.method;
  if(route==='/api/health'&&method==='GET')return json(res,200,{ok:true,service:'hazwaste-dispatch'});
  if(route==='/api/auth/login'&&method==='POST'){
   const b=await body(req);if(typeof b.username!=='string'||b.username.length>64||typeof b.password!=='string'||b.password.length>128)fail(400,'登录信息不合法');
   const key=(req.socket.remoteAddress||'')+':'+b.username.toLowerCase(),now=Date.now();const failures=attempts.get(key)||[];const recent=failures.filter(x=>x>now-15*60000);if(recent.length>=8)fail(429,'登录尝试过多，请15分钟后重试');if(attempts.size>2000)attempts.clear();recent.push(now);attempts.set(key,recent);
   const u=store.state.users.find(x=>x.username===b.username&&x.active!==false);const derived=await scrypt(b.password,u?u.salt:'fixed-dummy-salt',64);if(!u||!crypto.timingSafeEqual(derived,Buffer.from(u.passwordHash,'hex')))fail(401,'用户名或密码错误');attempts.delete(key);
   const token=crypto.randomBytes(32).toString('base64url');store.transact(s=>{s.sessions=s.sessions.filter(x=>x.expiresAt>now);s.sessions.push({hash:hash(token),userId:u.id,expiresAt:now+12*3600000});audit(s,u,'login','users',u.id)});return json(res,200,{token,user:safeUser(u),expiresAt:now+12*3600000});
  }
  const user=current(req);
  if(method==='POST'&&(route==='/api/migrations'||/^\/api\/migrations\/[\w-]+\/rollback$/.test(route))&&user.role!=='admin')fail(403,'迁移和回滚仅限管理员');
  if(route==='/api/management/authorize'&&method==='POST'){if(user.role!=='admin')fail(403,'此操作仅限管理员');const b=await body(req);if(!['backup','shareBackup','migration','rollback'].includes(b.action))fail(400,'管理操作无效');store.transact(s=>audit(s,user,'authorize-'+b.action,'users',user.id));return json(res,200,{allowed:true,user:safeUser(user)})}
  if(route==='/api/me'&&method==='GET')return json(res,200,{user:safeUser(user),wechat:{configured:wechat.ready(),workerEnabled:!!opts.worker,bound:!!user.openid,templateId:wechat.ready()?wechat.templateId:''}});
  if(route==='/api/auth/logout'&&method==='POST'){const token=req.headers.authorization.replace(/^Bearer /,'');store.transact(s=>{s.sessions=s.sessions.filter(x=>x.hash!==hash(token));audit(s,user,'logout','users',user.id)});return json(res,200,{ok:true})}
  if(route==='/api/team'&&method==='GET')return json(res,200,{items:store.state.users.filter(u=>u.orgId===user.orgId&&u.active!==false).map(safeUser)});
  if(route==='/api/audit'&&method==='GET')return json(res,200,{items:store.state.audit.filter(x=>x.orgId===user.orgId&&(user.role==='admin'||x.userId===user.id)).slice(-200).reverse()});
  if(route==='/api/sync'&&method==='GET'){const kind=url.searchParams.get('kind');if(!KINDS.includes(kind))fail(400,'同步数据类型错误');return json(res,200,page(store.state[kind].filter(x=>visible(x,user)),url))}
  if(route==='/api/reminders'&&method==='GET'){const tasks=store.state.tasks.filter(x=>visible(x,user)&&!x.deleted),states=store.state.reminderStates.filter(x=>x.ownerId===user.id&&x.orgId===user.orgId&&!x.deleted);return json(res,200,{items:remindersFor(tasks,states,new Date())})}
  const share=route.match(/^\/api\/share\/(tasks|customers)\/([\w-]+)$/);
  if(share&&method==='PUT'){const b=await body(req);return json(res,200,store.transact(s=>{const r=find(s,share[1],share[2],user);if(r.ownerId!==user.id&&user.role!=='admin')fail(403,'只有负责人或管理员可授权');if(r.revision!==b.baseRevision)fail(409,'记录已修改',{remote:r});if(!Array.isArray(b.userIds)||b.userIds.length>50||b.userIds.some(id=>!s.users.some(u=>u.id===id&&u.orgId===user.orgId&&u.active!==false)))fail(400,'授权用户无效');r.sharedWith=[...new Set(b.userIds)];r.revision++;r.updatedAt=new Date().toISOString();s.dataVersion=(s.dataVersion||0)+1;audit(s,user,'share',share[1],r.id,['sharedWith']);return {record:r}}))}
  const crud=route.match(/^\/api\/(tasks|customers|reminderStates)(?:\/([\w-]+))?$/);
  if(crud){const kind=crud[1],id=crud[2];if(method==='GET'){if(id)return json(res,200,{record:find(store.state,kind,id,user,false)});let items=store.state[kind].filter(x=>!x.deleted&&visible(x,user));const q=(url.searchParams.get('q')||'').toLowerCase(),status=url.searchParams.get('status');if(status)items=items.filter(x=>x.status===status);if(q)items=items.filter(x=>[x.client,x.name,x.phone,x.wasteName,x.plate,x.rawMessage].join(' ').toLowerCase().includes(q));return json(res,200,page(items,url))}if(id&&['PUT','DELETE'].includes(method))return json(res,200,mutate(user,kind,id,method,await body(req)));}
  if(route==='/api/migrations'&&method==='POST'){
   const b=await body(req);if(!validId(b.batchId)||!Array.isArray(b.tasks)||!Array.isArray(b.customers)||b.tasks.length+b.customers.length>500)fail(400,'迁移每批最多500条，批次ID必须有效');
   return json(res,200,store.transact(s=>{const existing=s.migrations.find(x=>x.id===b.batchId&&x.userId===user.id&&x.orgId===user.orgId);if(existing){if(existing.rolledBack)fail(409,'此批次已回滚，请使用新的批次ID');if(existing.inputHash!==hash(JSON.stringify(b)))fail(409,'批次ID对应的数据已改变');return {batchId:b.batchId,created:existing.created,skipped:existing.skipped}}
    const created=[],skipped=[],customerMap={};for(const kind of ['customers','tasks'])for(const raw of b[kind]){
     if(!validId(raw.id))fail(400,'迁移记录ID不合法');const record=clean(kind,raw);
     const duplicate=s[kind].find(x=>!x.deleted&&x.ownerId===user.id&&x.orgId===user.orgId&&(x.id===raw.id||(kind==='tasks'?fingerprint(x)===fingerprint(record):x.name.toLowerCase()===record.name.toLowerCase())));
     if(duplicate){skipped.push({kind,id:raw.id,canonicalId:duplicate.id});if(kind==='customers')customerMap[raw.id]=duplicate.id;continue}
     if(s[kind].some(x=>x.id===raw.id))fail(409,'迁移ID冲突，未导入本批次');if(kind==='tasks'&&record.customerId){record.customerId=customerMap[record.customerId]||record.customerId;find(s,'customers',record.customerId,user,false)}
     const stamp=new Date().toISOString();const item={...record,id:raw.id,orgId:user.orgId,ownerId:user.id,sharedWith:[],revision:1,deleted:false,createdAt:stamp,updatedAt:stamp,history:[{at:stamp,by:user.id,action:'从本地备份迁移'}]};
     if(kind==='tasks'){item.originalMessage=record.originalMessage||record.rawMessage;item.legacyHistory=Array.isArray(raw.history)?raw.history.slice(-50).map(x=>({at:String(x.at||'').slice(0,40),action:String(x.action||'').slice(0,150)})):[];}
     s[kind].push(item);created.push({kind,id:raw.id});if(kind==='customers')customerMap[raw.id]=raw.id;audit(s,user,'migrate-create',kind,raw.id);
    }
    s.migrations.push({id:b.batchId,userId:user.id,orgId:user.orgId,created,skipped,inputHash:hash(JSON.stringify(b)),at:new Date().toISOString()});s.dataVersion=(s.dataVersion||0)+1;return {batchId:b.batchId,created,skipped};
   }));
  }
  const rollback=route.match(/^\/api\/migrations\/([\w-]+)\/rollback$/);
  if(rollback&&method==='POST')return json(res,200,store.transact(s=>{const batch=s.migrations.find(x=>x.id===rollback[1]&&x.userId===user.id&&x.orgId===user.orgId);if(!batch)fail(404,'迁移批次不存在');if(batch.rolledBack)return {ok:true,alreadyRolledBack:true};for(const ref of batch.created){const record=find(s,ref.kind,ref.id,user,false);if(record.revision!==1)fail(409,'迁移记录已有后续修改，整批回滚已停止');if(ref.kind==='customers'&&s.tasks.some(t=>!t.deleted&&t.customerId===ref.id&&!batch.created.some(x=>x.kind==='tasks'&&x.id===t.id)))fail(409,'迁移客户已有后续关联任务，回滚已停止')}
   for(const ref of batch.created){const r=find(s,ref.kind,ref.id,user,false);const tombstone={id:r.id,orgId:r.orgId,ownerId:r.ownerId,sharedWith:r.sharedWith||[],createdAt:r.createdAt,updatedAt:new Date().toISOString(),revision:r.revision+1,deleted:true,history:[{at:new Date().toISOString(),by:user.id,action:'回滚迁移记录'}]};s[ref.kind][s[ref.kind].findIndex(x=>x.id===r.id)]=tombstone;audit(s,user,'migration-rollback',ref.kind,ref.id)}batch.rolledBack=true;s.dataVersion=(s.dataVersion||0)+1;return {ok:true}}));
  if(route==='/api/wechat/bind'&&method==='POST'){const b=await body(req);if(typeof b.code!=='string'||b.code.length>256)fail(400,'微信登录凭证无效');const openid=await wechat.exchange(b.code);store.transact(s=>{if(s.users.some(u=>u.openid===openid&&u.id!==user.id))fail(409,'此微信已绑定其他账号');s.users.find(u=>u.id===user.id).openid=openid;audit(s,user,'wechat-bind','users',user.id)});return json(res,200,{bound:true})}
  if(route==='/api/wechat/subscription/challenge'&&method==='POST'){if(!wechat.ready())fail(503,'微信服务通知未配置，不能订阅或发送');if(!user.openid)fail(400,'请先绑定微信身份');const challenge={id:uid(),userId:user.id,templateId:wechat.templateId,expiresAt:Date.now()+5*60000,used:false};store.transact(s=>{s.challenges=s.challenges.filter(x=>x.expiresAt>Date.now());if(s.challenges.filter(x=>x.userId===user.id).length>=10)fail(429,'订阅操作过于频繁');s.challenges.push(challenge)});return json(res,200,{challengeId:challenge.id,templateId:challenge.templateId})}
  if(route==='/api/wechat/subscription'&&method==='POST'){const b=await body(req);return json(res,200,store.transact(s=>{const c=s.challenges.find(x=>x.id===b.challengeId&&x.userId===user.id);if(!c||c.expiresAt<Date.now())fail(400,'订阅操作已过期，请重新点击');if(c.used)return {recorded:true};if(!['accept','reject','ban'].includes(b.result))fail(400,'订阅回执无效');c.used=true;if(b.result==='accept')s.subscriptions.push({id:uid(),userId:user.id,orgId:user.orgId,openid:user.openid,templateId:c.templateId,status:'available',at:new Date().toISOString()});else for(const grant of s.subscriptions.filter(g=>g.userId===user.id&&g.status==='available'))grant.status='revoked';audit(s,user,'subscription-'+b.result,'users',user.id);return {recorded:true,note:'已记录客户端授权回执，真实可发送权限仍以微信官方接口校验为准'};}))}
  if(route==='/api/wechat/status'&&method==='GET')return json(res,200,{configured:wechat.ready(),workerEnabled:!!opts.worker,bound:!!user.openid,templateId:wechat.ready()?wechat.templateId:'',reportedCredits:store.state.subscriptions.filter(g=>g.userId===user.id&&g.status==='available').length,deliveries:store.state.deliveries.filter(d=>d.userId===user.id).slice(-10).map(d=>({day:d.day,status:d.status,code:d.code||null}))});
  fail(404,'接口不存在');
 }
 const server=http.createServer(async(req,res)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  try{
   const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/')){
    if(!opts.allowHttp&&!req.socket.encrypted&&!(opts.trustProxy&&req.headers['x-forwarded-proto']==='https'))fail(426,'云端API必须经HTTPS访问');
    if(req.headers.origin){const expected=opts.publicOrigin||'http://'+req.headers.host;if(req.headers.origin!==expected)fail(403,'禁止跨站请求')}
    if(req.headers['sec-fetch-site']==='cross-site')fail(403,'禁止跨站请求');await api(req,res,url);return;
   }
   if(!['GET','HEAD'].includes(req.method))fail(405,'仅支持读取');let pathname;try{pathname=decodeURIComponent(url.pathname)}catch(e){fail(400,'地址无效')}
   if(pathname==='/')pathname='/web/index.html';if(pathname==='/web/')pathname='/web/index.html';
   const allowed=/^\/web\/[a-zA-Z0-9_.-]+\.(html|css|js)$/.test(pathname)||['/START_HERE.html','/miniprogram/utils/parser.js','/miniprogram/utils/reminders.js','/miniprogram/utils/repository.js','/miniprogram/utils/backup.js'].includes(pathname);
   if(!allowed)fail(404,'文件不存在');const target=path.resolve(root,'.'+pathname);if(!target.startsWith(root+path.sep))fail(404,'文件不存在');let content;try{content=fs.readFileSync(target)}catch(e){fail(404,'文件不存在')}
   res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[path.extname(target)]);res.writeHead(200);res.end(req.method==='HEAD'?undefined:content);
  }catch(e){if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'服务暂不可用，数据未提交，请联系管理员',details:e.details});else res.end()}
 });
 server.requestTimeout=20000;server.headersTimeout=15000;
 async function runNotifications(now){if(workerBusy||!wechat.ready())return {skipped:true};workerBusy=true;now=now||new Date();const day=chinaTime(now).slice(0,10);let sent=0;
  try{for(const user of store.state.users.filter(u=>u.active!==false&&u.openid)){
   const tasks=store.state.tasks.filter(t=>!t.deleted&&visible(t,user)),states=store.state.reminderStates.filter(s=>s.userId===user.id||s.ownerId===user.id),reminders=remindersFor(tasks,states,now);if(!reminders.length)continue;
   const reserved=store.transact(s=>{if(s.deliveries.some(d=>d.userId===user.id&&d.day===day))return null;const grant=s.subscriptions.find(g=>g.userId===user.id&&g.openid===user.openid&&g.templateId===wechat.templateId&&g.status==='available');if(!grant)return null;grant.status='reserved';const delivery={id:uid(),day,userId:user.id,orgId:user.orgId,grantId:grant.id,status:'sending',at:new Date().toISOString()};s.deliveries.push(delivery);return {delivery,grant}});if(!reserved)continue;
   try{await wechat.send(user.openid,new Set(reminders.map(x=>x.taskId)).size,day);store.transact(s=>{s.deliveries.find(d=>d.id===reserved.delivery.id).status='sent';s.subscriptions.find(g=>g.id===reserved.grant.id).status='consumed';audit(s,user,'notification-sent','deliveries',reserved.delivery.id)});sent++}
   catch(e){store.transact(s=>{const delivery=s.deliveries.find(d=>d.id===reserved.delivery.id);delivery.status=e.wechatCode?'failed':'unknown';delivery.code=e.wechatCode||'NETWORK_UNKNOWN';s.subscriptions.find(g=>g.id===reserved.grant.id).status='consumed';if(e.wechatCode===43101)for(const g of s.subscriptions.filter(g=>g.userId===user.id&&g.status==='available'))g.status='revoked';audit(s,user,'notification-'+delivery.status,'deliveries',delivery.id)})}
  }return {sent}}finally{workerBusy=false}
 }
 return {addUser,store,runNotifications,get port(){return port},async listen(p,host){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(p,host||'127.0.0.1',()=>{port=server.address().port;resolve()})});if(opts.worker){timer=setInterval(()=>{if(Number(chinaTime(new Date()).slice(11,13))>=9)runNotifications().catch(()=>{})},60000);timer.unref()}return port},async close(){if(timer)clearInterval(timer);if(server.listening)await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections()});store.close()}};
}
module.exports={createApplication};
