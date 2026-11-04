/* Offline-first store; cloud accounts use separate namespaces. No automatic legacy upload. */
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root)root.DispatchRepository=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';const kinds=['tasks','customers','reminderStates'];
 const clone=x=>JSON.parse(JSON.stringify(x));
 const id=()=> 'op_'+Date.now()+'_'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);
 function createRepository(storage){
  let connection=null,busy=false,staged=null;
  const localKey=k=>k==='tasks'?'hazwaste_dispatch_v1':'hazwaste_dispatch_v2_'+k;
  const key=()=> 'hazwaste_cloud_v2:'+connection.scope;
  const read=()=>staged||clone(storage.get(key())||{tasks:[],customers:[],reminderStates:[],queue:[],conflicts:[]});
  const write=s=>{if(staged)staged=s;else storage.set(key(),s)};
  function list(kind){return clone((connection?read()[kind]:storage.get(localKey(kind)))||[]).filter(x=>!x.deleted)}
  function save(kind,next){
   if(!kinds.includes(kind))throw Error('未知数据类型');
   if(!connection){storage.set(localKey(kind),clone(next));return}
   const s=read(),old=s[kind]||[],stamp=new Date().toISOString();
   const wanted=new Map(next.map(x=>[x.id,x]));
   for(const record of next){const before=old.find(x=>x.id===record.id);if(!before||JSON.stringify(before)!==JSON.stringify(record)){
    if(s.conflicts.some(c=>c.kind===kind&&c.id===record.id))throw Error('请先处理该记录的同步冲突');
    s.queue.push({kind,id:record.id,method:'PUT',record:clone(record),baseRevision:s.queue.some(q=>q.kind===kind&&q.id===record.id)?null:(before&&before.revision||0),operationId:id()});
   }}
   for(const before of old){if(!before.deleted&&!wanted.has(before.id)){
    if(s.conflicts.some(c=>c.kind===kind&&c.id===before.id))throw Error('请先处理该记录的同步冲突');
    s.queue.push({kind,id:before.id,method:'DELETE',baseRevision:s.queue.some(q=>q.kind===kind&&q.id===before.id)?null:(before.revision||0),operationId:id()});
   }}
   s[kind]=clone(next).concat(old.filter(x=>!wanted.has(x.id)).map(x=>({...x,deleted:true,updatedAt:stamp})));write(s);
  }
  function status(){const s=connection?read():{queue:[],conflicts:[]};return {connected:!!connection,scope:connection&&connection.scope,pending:s.queue.length,conflicts:clone(s.conflicts),lastSync:s.lastSync||''}}
  async function sync(){
   if(!connection)throw Error('请先登录云端');if(busy)return status();busy=true;const current=connection;
   try{
    let failure=null;
    for(const queued of read().queue.slice()){
     if(current!==connection)throw Error('账户已切换，同步已停止');
     let s=read();if(s.conflicts.some(c=>c.kind===queued.kind&&c.id===queued.id))continue;
     const q=s.queue.find(x=>x.operationId===queued.operationId);if(!q)continue;
     if(q.baseRevision===null){q.baseRevision=(s[q.kind].find(x=>x.id===q.id)||{}).revision||0;write(s)}
     try{
      const result=await current.request('/api/'+q.kind+'/'+encodeURIComponent(q.id),q.method,{record:q.record,baseRevision:q.baseRevision,operationId:q.operationId,allowDuplicate:q.allowDuplicate||false});
      if(current!==connection)throw Error('账户已切换');s=read();s.queue=s.queue.filter(x=>x.operationId!==q.operationId);
      const newer=s.queue.some(x=>x.kind===q.kind&&x.id===q.id),idx=s[q.kind].findIndex(x=>x.id===q.id);
      if(idx>=0)s[q.kind][idx]=newer?{...s[q.kind][idx],revision:result.record.revision}:result.record;else s[q.kind].push(result.record);write(s);
     }catch(e){
      if(current!==connection)throw e;
      if(e.status===409){s=read();s.conflicts.push({kind:q.kind,id:q.id,local:s[q.kind].find(x=>x.id===q.id),remote:e.details&&e.details.remote||null,message:e.message});write(s)}
      else {failure=e;break}
     }
    }
    if(failure)throw failure;
    // Fetch complete snapshots before merging; a partial/failed pull never removes cached data.
    const snapshots={};for(const kind of kinds){const all=[];let cursor='';do{const page=await current.request('/api/sync?kind='+kind+'&cursor='+encodeURIComponent(cursor),'GET');all.push(...page.items);cursor=page.nextCursor||''}while(cursor);snapshots[kind]=all}
    if(current!==connection)throw Error('账户已切换');const s=read();for(const kind of kinds){const protectedIds=new Set(s.queue.filter(x=>x.kind===kind).map(x=>x.id));s[kind]=snapshots[kind].filter(x=>!protectedIds.has(x.id)).concat(s[kind].filter(x=>protectedIds.has(x.id)))}s.lastSync=new Date().toISOString();write(s);return status();
   }finally{busy=false}
  }
  function resolve(kind,recordId,choice){const s=read(),c=s.conflicts.find(x=>x.kind===kind&&x.id===recordId);if(!c)return;
   s.queue=s.queue.filter(q=>!(q.kind===kind&&q.id===recordId));s.conflicts=s.conflicts.filter(x=>x!==c);s[kind]=s[kind].filter(x=>x.id!==recordId);
   if(choice==='remote'){if(c.remote)s[kind].push(c.remote)}
   else{const record=c.local;s[kind].push(record);s.queue.push({kind,id:recordId,method:record.deleted?'DELETE':'PUT',record,baseRevision:c.remote&&c.remote.revision||0,operationId:id(),allowDuplicate:true})}write(s);
  }
  function saveMany(next){if(connection){staged=clone(read());try{for(const kind of ['customers','tasks','reminderStates'])if(next[kind])save(kind,next[kind]);storage.set(key(),staged)}finally{staged=null}}else{const before={};for(const kind of kinds)before[kind]=storage.get(localKey(kind))||[];try{for(const kind of kinds)if(next[kind])save(kind,next[kind])}catch(e){for(const kind of kinds)storage.set(localKey(kind),before[kind]);throw e}}}
  return {list,save,saveMany,status,sync,resolve,connect(c){if(busy)throw Error('请等待当前同步结束');connection=c;const s=read();for(const k of kinds)s[k]=s[k]||[];s.queue=s.queue||[];s.conflicts=s.conflicts||[];write(s)},disconnect(){if(busy)throw Error('请等待同步结束');connection=null},legacy(){return {tasks:clone(storage.get(localKey('tasks'))||[]),customers:clone(storage.get(localKey('customers'))||[])}},id};
 }
 return {createRepository};
});
