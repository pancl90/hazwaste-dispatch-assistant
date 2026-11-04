'use strict';
const crypto=require('node:crypto');
const APPID='wx0000000000000000';
const userId=openid=>crypto.createHash('sha256').update(APPID+':'+openid).digest('hex');
function fakeDb({seed=true}={}){
 let docs=new Map(),tail=Promise.resolve(),failWrite=false;
 if(seed)docs.set('dispatch_members_v1dispatch_team_roles_v1',{schemaVersion:1,revision:1,accessEpoch:0,members:[{id:userId('openid-a'),displayName:'测试管理员',role:'admin',active:true,revision:1,createdAt:'2026-11-03T00:00:00Z',updatedAt:'2026-11-03T00:00:00Z'}]});
 const api=map=>({collection:name=>({doc:id=>({async get(){return {data:map.has(name+id)?structuredClone(map.get(name+id)):null}},async set({data}){if(failWrite)throw Error('storage unavailable');map.set(name+id,structuredClone(data));return {}}})})});
 return {runTransaction(fn){const run=tail.then(async()=>{const next=structuredClone(docs),result=await fn(api(next));docs=next;return {result}});tail=run.catch(()=>{});return run},breakWrites(){failWrite=true},get docs(){return docs}};
}
module.exports={fakeDb,APPID,userId};
