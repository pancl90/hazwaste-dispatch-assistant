'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
function loadPage(file){let page;global.Page=p=>{page=p};delete require.cache[require.resolve(file)];require(file);page.data=structuredClone(page.data);page.setData=function(values){for(const [k,v] of Object.entries(values)){const parts=k.split('.');if(parts.length===1)this.data[k]=v;else this.data[parts[0]][parts[1]]=v}};return page}
test('customer editor opens explicitly, edits existing records and closes only after a successful save',()=>{
 const memory=new Map();global.wx={getStorageSync:k=>memory.get(k),setStorageSync:(k,v)=>memory.set(k,structuredClone(v)),removeStorageSync:k=>memory.delete(k),showModal:()=>{}};
 const root=path.resolve(__dirname,'../miniprogram');delete require.cache[require.resolve(root+'/utils/data.js')];const page=loadPage(root+'/pages/operations/operations.js');assert.equal(page.data.showCustomerForm,false);
 page.newCustomer();assert.equal(page.data.showCustomerForm,true);page.customerInput({currentTarget:{dataset:{field:'name'}},detail:{value:'界面测试客户'}});page.saveCustomer();assert.equal(page.data.showCustomerForm,false);assert.equal(page.data.customers.length,1);
 page.editCustomer({currentTarget:{dataset:{id:page.data.customers[0].id}}});assert.equal(page.data.showCustomerForm,true);assert.equal(page.data.customer.name,'界面测试客户');page.customerInput({currentTarget:{dataset:{field:'name'}},detail:{value:''}});page.saveCustomer();assert.equal(page.data.showCustomerForm,true,'invalid form must remain open');delete global.wx;delete global.Page;
});
test('bottom navigation retains an unfinished capture and returns to the top',()=>{
 const memory=new Map(),scrolls=[];global.wx={getStorageSync:k=>memory.get(k),setStorageSync:(k,v)=>memory.set(k,structuredClone(v)),removeStorageSync:k=>memory.delete(k),pageScrollTo:v=>scrolls.push(v),showToast:()=>{}};
 const root=path.resolve(__dirname,'../miniprogram');delete require.cache[require.resolve(root+'/utils/data.js')];const page=loadPage(root+'/pages/index/index.js');page.onShow();page.rawInput({detail:{value:'人工核对中的原始清运通知'}});page.chooseTab({currentTarget:{dataset:{tab:'all'}}});page.chooseTab({currentTarget:{dataset:{tab:'new'}}});assert.equal(page.data.raw,'人工核对中的原始清运通知');assert.equal(scrolls.length,2);assert.equal(scrolls[0].scrollTop,0);assert.ok(page.data.dateLabel);delete global.wx;delete global.Page;
});
