'use strict';const crypto=require('node:crypto');
const STATUSES=['待安排','待确认','已安排','运输中','已完成','已取消'];const KINDS=['tasks','customers','reminderStates'];
function fail(status,message,details){const e=Error(message);e.status=status;e.details=details;throw e}
function validId(id){return typeof id==='string'&&/^[a-zA-Z0-9_-]{4,100}$/.test(id)}
function visible(record,user){return record.orgId===user.orgId&&(record.ownerId===user.id||(!record.reminderKey&&(user.role==='admin'||(record.sharedWith||[]).includes(user.id))))}
const taskFields=['client','customerId','pickupDate','timeWindow','wasteName','wasteCode','weight','weightUnit','actualWeight','packaging','packageCount','contactName','phone','address','status','priority','carrier','plate','driver','remindAt','notes','rawMessage','originalMessage','source','dateInterpretation','verificationStatus'];
const customerFields=['name','contactName','phone','address','contractExpiry','wasteNotes','notes'];
function clean(kind,input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'记录格式不正确');const out={};const fields=kind==='tasks'?taskFields:kind==='customers'?customerFields:['taskId','reminderKey','readAt','handledAt','snoozedUntil'];
 for(const field of fields){if(input[field]!==undefined&&typeof input[field]!=='string')fail(400,'字段必须为文字：'+field);const text=input[field]||'';if(text.length>(field==='rawMessage'||field==='originalMessage'?10000:field==='notes'||field==='wasteNotes'?2000:500))fail(400,'字段过长：'+field);out[field]=text.trim()}
 function date(field){if(out[field]&&!/^\d{4}-\d{2}-\d{2}$/.test(out[field]))fail(400,'日期格式错误：'+field);if(out[field]&&(isNaN(Date.parse(out[field]))||new Date(out[field]).toISOString().slice(0,10)!==out[field]))fail(400,'无效日期：'+field)}
 if(kind==='tasks'){
  if(!out.client&&!out.rawMessage)fail(400,'客户与原文不能同时为空');out.client=out.client||'待核实客户';out.status=out.status||'待安排';if(!STATUSES.includes(out.status))fail(400,'任务状态不合法');out.priority=out.priority||'普通';if(!['普通','紧急'].includes(out.priority))fail(400,'优先级不合法');date('pickupDate');
  if(out.remindAt&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(out.remindAt)||isNaN(Date.parse(out.remindAt+'+08:00'))))fail(400,'跟进时间格式错误');out.source=out.source||'manual';out.verificationStatus=out.verificationStatus||'待核实';
  out.attachments=[]; // No binary upload endpoint in this stage; never accept arbitrary external URLs.
 }else if(kind==='customers'){
  if(!out.name)fail(400,'客户全称不能为空');date('contractExpiry');out.aliases=Array.isArray(input.aliases)?[...new Set(input.aliases.filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim().slice(0,100)))].slice(0,30):[];
 }else{if(!validId(out.taskId))fail(400,'提醒必须关联任务');if(out.snoozedUntil&&(isNaN(Date.parse(out.snoozedUntil))||!/(Z|\+08:00)$/.test(out.snoozedUntil)))fail(400,'稍后提醒时间必须包含时区')}
 return out;
}
function fingerprint(t){const normalize=x=>String(x||'').replace(/\s+/g,'').toLowerCase();const data=[t.rawMessage,t.client,t.pickupDate,t.timeWindow,t.wasteName,t.wasteCode,t.weight,t.packaging].map(normalize).join('|');return crypto.createHash('sha256').update(data).digest('hex')}
module.exports={STATUSES,KINDS,fail,validId,visible,clean,fingerprint};
