'use strict';
const crypto=require('node:crypto');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const DATA='dispatch_data_v1',OPS='dispatch_operations_v1',BATCHES='dispatch_migrations_v1',MEMBERS='dispatch_members_v1',ROSTER='dispatch_team_roles_v1';
function problem(status,message){const e=Error(message);e.status=status;throw e}
function createStore(db,options={}){
 const maxBytes=options.maxBytes||750*1024;
 const safe=m=>({id:m.id,displayName:m.displayName,role:m.role,active:m.active,revision:m.revision,createdAt:m.createdAt,updatedAt:m.updatedAt});
 async function transact(fn){const r=await db.runTransaction(fn);return r&&Object.prototype.hasOwnProperty.call(r,'result')?r.result:r}
 async function roster(tx){const r=await tx.collection(MEMBERS).doc(ROSTER).get(),d=Array.isArray(r.data)?r.data[0]:r.data;if(!d||d.schemaVersion!==1||!Array.isArray(d.members)||!d.members.some(m=>m.role==='admin'&&m.active===true))problem(503,'角色配置尚未初始化，请联系管理员');return d}
 function account(team,owner,admin){const m=team.members.find(m=>m.id===owner);if(!m)problem(401,'请重新连接以验证成员身份');if(m.active!==true)problem(403,'此账号已停用，请联系管理员');if(!['admin','member'].includes(m.role))problem(503,'账号角色配置异常');if(admin&&m.role!=='admin')problem(403,'此操作仅限管理员');return m}
 async function saveRoster(tx,team){const {_id,...data}=team;await tx.collection(MEMBERS).doc(ROSTER).set({data})}
 return {
 async identity(owner){return transact(async tx=>{const team=await roster(tx);let m=team.members.find(x=>x.id===owner);if(!m){if(team.members.length>=500)problem(503,'成员数量已达试点上限，请联系管理员');const at=new Date().toISOString();m={id:owner,displayName:'员工 '+owner.slice(-6),role:'member',active:true,revision:1,createdAt:at,updatedAt:at};team.members.push(m);team.revision++;await saveRoster(tx,team)}return safe(account(team,owner,false))})},
 async profile(owner,displayName){return transact(async tx=>{const team=await roster(tx),m=account(team,owner,false);m.displayName=displayName;m.revision++;m.updatedAt=new Date().toISOString();team.revision++;await saveRoster(tx,team);return safe(m)})},
 async members(owner){return transact(async tx=>{const team=await roster(tx);account(team,owner,true);return team.members.map(safe).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))})},
 async changeMember(owner,id,b){return transact(async tx=>{
  const team=await roster(tx);account(team,owner,true);const target=team.members.find(m=>m.id===id);if(!target)problem(404,'成员不存在');
  const ref=tx.collection(OPS).doc(hash(owner+':'+b.operationId)),res=await ref.get(),previous=Array.isArray(res.data)?res.data[0]:res.data,requestHash=hash(JSON.stringify({action:'member-permission-update',id,b}));
  if(previous){if(previous.ownerId!==owner||previous.requestHash!==requestHash)problem(409,'操作ID已用于其他请求');return safe(target)}
  if(target.revision!==b.baseRevision)problem(409,'成员权限已变化，请刷新后再操作');
  if(target.role==='admin'&&target.active&&(!b.active||b.role!=='admin')&&team.members.filter(m=>m.role==='admin'&&m.active).length<=1)problem(409,'必须保留至少一位启用的管理员');
  const at=new Date().toISOString(),before={role:target.role,active:target.active};target.role=b.role;target.active=b.active;target.revision++;target.updatedAt=at;team.revision++;team.accessEpoch=(team.accessEpoch||0)+1;
  await ref.set({data:{ownerId:owner,requestHash,action:'member-permission-update',targetId:id,before,after:{role:b.role,active:b.active},at}});await saveRoster(tx,team);return safe(target);
 })},
 async run(owner,kinds,fn,access={}){
  return transact(async tx=>{
   const team=await roster(tx),actor=account(team,owner,access.admin);
   const ref=(collection,id)=>tx.collection(collection).doc(id);
   async function get(collection,id){const r=await ref(collection,id).get();const d=Array.isArray(r.data)?r.data[0]:r.data;if(!d)return null;if(d.ownerId!==owner)problem(503,'云端数据归属异常，请联系管理员');return d}
   const metaId=hash(owner+':meta'),meta=await get(DATA,metaId),state={version:meta?meta.version:0},dirty=new Set();
   for(const kind of kinds){const d=await get(DATA,hash(owner+':'+kind));if(d&&!Array.isArray(d.records))problem(503,'云端数据格式异常，请联系管理员');state[kind]=d?d.records:[]}
   const ctx={state,actor:safe(actor),changed:kind=>dirty.add(kind),
    async receipt(type,id){return get(type==='batch'?BATCHES:OPS,hash(owner+':'+id))},
    async saveReceipt(type,id,data){await ref(type==='batch'?BATCHES:OPS,hash(owner+':'+id)).set({data:{...data,ownerId:owner}})}
   };
   const value=await fn(ctx);
   if(dirty.size){
    for(const kind of dirty){const data={ownerId:owner,records:state[kind],updatedAt:new Date().toISOString()};if(Buffer.byteLength(JSON.stringify(data),'utf8')>maxBytes)problem(413,'当前数据类型已达到试点容量，请先备份并联系管理员扩容；本次未提交');await ref(DATA,hash(owner+':'+kind)).set({data})}
    await ref(DATA,metaId).set({data:{ownerId:owner,version:state.version+1,updatedAt:new Date().toISOString()}});
   }
   // Serialize writes with permission changes, so a stale client role cannot authorize a commit.
   if(dirty.size||access.admin){team.accessEpoch=(team.accessEpoch||0)+1;await saveRoster(tx,team)}
   return value;
  });
 }};
}
module.exports={createStore};
