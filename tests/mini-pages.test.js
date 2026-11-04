'use strict';const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
test('mini-program Page handlers preserve legacy capture/detail and use the shared repository',()=>{
 const storage=new Map(),toasts=[];let page;
 global.wx={getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,structuredClone(v)),removeStorageSync:k=>storage.delete(k),showToast:x=>toasts.push(x),showModal:()=>{},navigateTo:()=>{},navigateBack:()=>{}};global.Page=x=>{page=x};
 const base=path.resolve(__dirname,'../miniprogram');for(const f of ['utils/data.js','pages/index/index.js','pages/detail/detail.js'])delete require.cache[path.join(base,f)];require(path.join(base,'pages/index/index.js'));
 page.data=structuredClone(page.data);page.setData=function(values){for(const [key,value] of Object.entries(values)){const names=key.split('.');if(names.length===1)this.data[key]=value;else this.data[names[0]][names[1]]=value}};page.onShow();page.rawInput({detail:{value:'客户：演示工厂；明天上午清运废液5吨20桶'}});page.parse();page.save();assert.equal(storage.get('hazwaste_dispatch_v1').length,1);assert.equal(storage.get('hazwaste_dispatch_v1')[0].weight,'5吨');const id=storage.get('hazwaste_dispatch_v1')[0].id;
 require(path.join(base,'pages/detail/detail.js'));page.data=structuredClone(page.data);page.setData=function(v){Object.assign(this.data,v)};page.onLoad({id});assert.equal(page.data.form.client,'演示工厂');page.data.form.plate='测试车牌';page.save();assert.equal(storage.get('hazwaste_dispatch_v1')[0].plate,'测试车牌');delete global.wx;delete global.Page;
});
