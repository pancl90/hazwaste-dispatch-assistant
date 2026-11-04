/* Shared reminder rules. All business dates use Asia/Shanghai (UTC+8). */
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root)root.DispatchReminders=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function chinaTime(date){return new Date((date||new Date()).getTime()+8*3600000).toISOString().slice(0,16)}
 function remindersFor(tasks,states,now){
  now=now||new Date();const local=chinaTime(now),day=local.slice(0,10),out=[];states=states||[];
  for(const t of tasks){
   if(t.deleted||['已完成','已取消'].includes(t.status))continue;
   if(states.some(s=>!s.deleted&&s.taskId===t.id&&s.snoozedUntil&&new Date(s.snoozedUntil).getTime()>now.getTime()))continue;
   const rules=[];
   if(t.remindAt&&t.remindAt<=local)rules.push({rule:'跟进',level:3,key:t.remindAt});
   if(t.pickupDate&&t.pickupDate<day)rules.push({rule:'逾期',level:3,key:t.pickupDate+':'+day});
   else if(!t.pickupDate)rules.push({rule:'待核实日期',level:2,key:'undated'});
   else if(['待安排','待确认'].includes(t.status)){
    const d=Math.round((Date.parse(t.pickupDate+'T00:00:00Z')-Date.parse(day+'T00:00:00Z'))/86400000);
    if(d>=0&&d<=2)rules.push({rule:d===2?'D-2':d===1?'D-1':'当天',level:t.status==='待确认'?3:2,key:t.pickupDate});
   }
   for(const r of rules){const id=t.id+'|'+r.rule+'|'+r.key;const s=states.find(x=>!x.deleted&&x.reminderKey===id)||{};
    if(s.handledAt)continue;
    out.push({id,taskId:t.id,client:t.client||'待核实客户',pickupDate:t.pickupDate||'',status:t.status,rule:r.rule,level:r.level,unread:!s.readAt,label:r.rule==='逾期'?'计划已过期，请核实进展':r.rule==='跟进'?'自定义跟进时间已到':r.rule==='待核实日期'?'请确认清运日期':r.rule+' · '+(t.status==='待确认'?'请确认安排':'尚待安排')});
   }
  }
  return out.sort((a,b)=>b.level-a.level||String(a.pickupDate).localeCompare(String(b.pickupDate)));
 }
 function stateId(key){let a=2166136261,b=5381;for(let i=0;i<key.length;i++){a=Math.imul(a^key.charCodeAt(i),16777619);b=Math.imul(b,33)^key.charCodeAt(i)}return 'state_'+(a>>>0).toString(16)+'_'+(b>>>0).toString(16)+'_'+key.length}
 return {chinaTime,remindersFor,stateId};
});
