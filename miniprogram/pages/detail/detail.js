const Data=require('../../utils/data');
const STATUSES=['待安排','待确认','已安排','运输中','已完成','已取消'];
const NEXT={'待安排':'待确认','待确认':'已安排','已安排':'运输中','运输中':'已完成'};
const EDITABLE=['client','pickupDate','timeWindow','wasteName','wasteCode','weight','packaging','contactName','phone','address','carrier','plate','driver','notes'];
function read(){try{const t=Data.repo.list('tasks');return Array.isArray(t)?t:[]}catch(e){return []}}
Page({
 data:{id:'',form:{},statuses:STATUSES,statusIndex:0,nextStatus:'',history:[],remindDate:'',remindTime:'09:00',createdLabel:''},
 onLoad(options){this.setData({id:decodeURIComponent(options.id||'')});this.loadTask()},
 loadTask(){const t=read().find(x=>x.id===this.data.id);if(!t){wx.showToast({title:'任务不存在',icon:'none'});setTimeout(()=>wx.navigateBack(),900);return}this.setData({form:{...t},history:[...(t.legacyHistory||[]),...(t.history||[])].reverse(),statusIndex:Math.max(0,STATUSES.indexOf(t.status)),nextStatus:NEXT[t.status]||'',remindDate:t.remindAt?t.remindAt.slice(0,10):'',remindTime:t.remindAt?t.remindAt.slice(11,16):'09:00',createdLabel:String(t.createdAt||'').slice(0,10)})},
 editField(e){const k=e.currentTarget.dataset.field;if(!EDITABLE.includes(k))return;this.setData({['form.'+k]:e.detail.value})},
 dateChange(e){this.setData({'form.pickupDate':e.detail.value})},
 statusChange(e){const status=STATUSES[Number(e.detail.value)];this.setData({'form.status':status,statusIndex:Number(e.detail.value),nextStatus:NEXT[status]||''})},
 remindDateChange(e){this.setData({remindDate:e.detail.value})},
 remindTimeChange(e){this.setData({remindTime:e.detail.value})},
 next(){const next=NEXT[this.data.form.status];if(!next)return;this.setData({'form.status':next,statusIndex:STATUSES.indexOf(next),nextStatus:NEXT[next]||''});this.save()},
 save(){const tasks=read(),i=tasks.findIndex(x=>x.id===this.data.id);if(i===-1){wx.showToast({title:'任务不存在',icon:'none'});return}const t=tasks[i];const now=new Date().toISOString();const changedStatus=t.status!==this.data.form.status;const form={...this.data.form,client:this.data.form.client||'待核实客户',remindAt:this.data.remindDate?this.data.remindDate+'T'+this.data.remindTime:''};const updated={...t,...form,updatedAt:now,history:[...(t.history||[]).slice(-49),{at:now,action:changedStatus?'状态变更：'+t.status+' → '+form.status:'修改清运资料'}]};tasks[i]=updated;try{Data.repo.save('tasks',tasks.map(Data.taskCustomer));wx.showToast({title:'更新成功',icon:'success'});this.loadTask()}catch(e){wx.showToast({title:'保存失败，请检查存储空间',icon:'none'})}},
 remove(){wx.showModal({title:'确认删除',content:'删除后无法从本设备找回。请确认是否已备份重要信息。',success:r=>{if(r.confirm){try{Data.repo.save('tasks',read().filter(t=>t.id!==this.data.id));wx.navigateBack()}catch(e){wx.showToast({title:'删除失败',icon:'none'})}}}})}
});
