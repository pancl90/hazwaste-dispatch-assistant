'use strict';
const config=require('../cloud.config');let initialized=false;
function init(){if(!config.enabled)throw Error('云开发未启用');if(!wx.cloud||!wx.cloud.init||!wx.cloud.callFunction)throw Error('当前微信版本不支持云开发，请升级微信');if(!initialized){wx.cloud.init({env:config.env,traceUser:false});initialized=true}}
function request(route,method,body,session){
 try{init();if(session.env!==config.env)throw Error('云环境已调整，请返回本地后重新连接')}catch(e){return Promise.reject(e)}
 return new Promise((resolve,reject)=>wx.cloud.callFunction({name:config.functionName,config:{env:config.env},data:{route,method:method||'GET',body,expectedUserId:session.user&&session.user.id},success(response){const result=response.result;if(!result||typeof result.ok!=='boolean')return reject(Error('云函数版本不匹配，请联系管理员'));if(result.ok)return resolve(result.data);const e=Error(result.error||'云端操作失败');e.status=result.status;e.details=result.details;reject(e)},fail(){reject(Error('云开发连接失败，草稿与同步队列仍在本机；请检查网络或环境状态'))}}));
}
module.exports={config,init,request};
