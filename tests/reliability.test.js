'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { remindersFor } = require('../miniprogram/utils/reminders');
const { createRepository } = require('../miniprogram/utils/repository');
test('D-2/D-1/today, overdue daily, read, snooze and completed rules', () => {
  const task={id:'task-1',client:'测试客户',status:'待确认',pickupDate:'2026-11-02'};
  assert.equal(remindersFor([task],[],new Date('2026-10-31T09:00:00+08:00'))[0].rule,'D-2');
  assert.equal(remindersFor([task],[],new Date('2026-11-01T09:00:00+08:00'))[0].rule,'D-1');
  assert.equal(remindersFor([task],[],new Date('2026-11-02T09:00:00+08:00'))[0].rule,'当天');
  const due=remindersFor([task],[],new Date('2026-11-03T09:00:00+08:00'))[0];
  assert.equal(due.rule,'逾期');
  assert.equal(remindersFor([task],[{reminderKey:due.id,readAt:'now'}],new Date('2026-11-03T09:00:00+08:00'))[0].unread,false);
  assert.equal(remindersFor([task],[{taskId:task.id,snoozedUntil:'2026-11-03T10:00:00+08:00'}],new Date('2026-11-03T09:00:00+08:00')).length,0);
  assert.equal(remindersFor([{...task,status:'已完成'}],[],new Date('2026-11-03T09:00:00+08:00')).length,0);
  assert.notEqual(due.id,remindersFor([task],[],new Date('2026-11-04T09:00:00+08:00'))[0].id);
});
function memory(){const map=new Map();return {get:k=>map.get(k),set:(k,v)=>map.set(k,v)}}
test('legacy records stay local; failed sync retains queue and draft',async()=>{
  const storage=memory();storage.set('hazwaste_dispatch_v1',[{id:'old-task',client:'旧客户'}]);
  const repo=createRepository(storage);assert.equal(repo.list('tasks').length,1);
  repo.connect({scope:'org:user:https://example.test',request:async()=>{throw Error('offline')}});
  assert.equal(repo.list('tasks').length,0);
  repo.save('tasks',[{id:'new-task',client:'新客户',status:'待安排'}]);
  await assert.rejects(repo.sync(),/offline/);
  assert.equal(repo.status().pending,1);assert.equal(repo.list('tasks')[0].client,'新客户');
  repo.disconnect();assert.equal(repo.list('tasks')[0].id,'old-task');
});
test('optimistic conflict keeps local and server versions until explicit resolution',async()=>{
  const repo=createRepository(memory());repo.connect({scope:'a',request:async(route,method)=>{if(method==='GET')return {items:[],nextCursor:''};const e=Error('冲突');e.status=409;e.details={remote:{id:'task-1',client:'服务端',revision:3}};throw e}});
  repo.save('tasks',[{id:'task-1',client:'离线草稿',status:'待安排'}]);await repo.sync();
  assert.equal(repo.status().conflicts.length,1);assert.equal(repo.list('tasks')[0].client,'离线草稿');
  repo.resolve('tasks','task-1','remote');assert.equal(repo.list('tasks')[0].client,'服务端');
});
