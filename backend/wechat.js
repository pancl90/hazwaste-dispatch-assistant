'use strict';
const {fail}=require('./model');
// Only official WeChat endpoints. No chat-reading or third-party AI endpoints.
function createWechat(config,fetchImpl){
 const fetcher=fetchImpl||fetch;let cached=null;
 const ready=()=>!!(config.appId&&config.appSecret&&config.templateId&&config.templateData&&Object.keys(config.templateData).length);
 async function json(url,options){const r=await fetcher(url,{...options,signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('微信服务暂不可用');const b=await r.json();if(b.errcode){const e=Error('微信接口返回错误 '+b.errcode);e.wechatCode=Number(b.errcode);throw e}return b}
 async function token(){if(cached&&cached.until>Date.now())return cached.value;const b=await json('https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid='+encodeURIComponent(config.appId)+'&secret='+encodeURIComponent(config.appSecret));if(!b.access_token)throw Error('微信凭证无效');cached={value:b.access_token,until:Date.now()+Math.max(60,(b.expires_in||7200)-300)*1000};return cached.value}
 return {ready,templateId:config.templateId||'',async exchange(code){if(!ready())fail(503,'微信通知尚未完成服务端配置');const b=await json('https://api.weixin.qq.com/sns/jscode2session?appid='+encodeURIComponent(config.appId)+'&secret='+encodeURIComponent(config.appSecret)+'&js_code='+encodeURIComponent(code)+'&grant_type=authorization_code');if(!b.openid)fail(400,'微信登录校验失败');return b.openid},async send(openid,count,day){
  if(!ready())fail(503,'微信通知未启用');const data={};
  // Explicit template mapping, limited to generic messages. Customer names/phones/raw messages cannot be mapped.
  const values={summary:'有'+count+'条清运待办需跟进',count:String(count),date:day+' 09:00',title:'清运跟进提醒'};
  for(const [field,value] of Object.entries(config.templateData)){if(!/^(thing|number|date|time|character_string)\d+$/.test(field)||!Object.hasOwn(values,value))fail(503,'订阅模板字段映射不合法');data[field]={value:values[value]}}
  const result=await json('https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token='+encodeURIComponent(await token()),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({touser:openid,template_id:config.templateId,page:'pages/operations/operations?tab=reminders',miniprogram_state:config.state||'formal',lang:'zh_CN',data})});return result;
 }};
}
module.exports={createWechat};
