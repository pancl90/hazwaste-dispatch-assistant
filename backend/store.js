'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const empty=()=>({schema:2,users:[],sessions:[],tasks:[],customers:[],reminderStates:[],audit:[],operations:[],migrations:[],subscriptions:[],challenges:[],deliveries:[]});
class Store{
 constructor(dir,key){if(!Buffer.isBuffer(key)||key.length!==32)throw Error('DATA_KEY 必须为 32 字节密钥');this.dir=dir;this.key=key;fs.mkdirSync(dir,{recursive:true,mode:0o700});this.file=path.join(dir,'store.enc');this.lock=path.join(dir,'server.lock');
  // A live second process must never write this store. Remove stale locks only after PID verification.
  try{this.fd=fs.openSync(this.lock,'wx',0o600);fs.writeFileSync(this.fd,String(process.pid))}catch(e){if(e.code!=='EEXIST')throw e;const pid=Number(fs.readFileSync(this.lock,'utf8'));let alive=true;try{process.kill(pid,0)}catch(err){if(err.code==='ESRCH')alive=false}if(alive)throw Error('数据目录正在使用，请先关闭原服务');fs.unlinkSync(this.lock);this.fd=fs.openSync(this.lock,'wx',0o600);fs.writeFileSync(this.fd,String(process.pid))}
  try{this.state=fs.existsSync(this.file)?this.decode(fs.readFileSync(this.file)):empty()}catch(e){this.close();throw Error('无法解密数据，已停止启动；请核对密钥或恢复备份')}
 }
 encode(data){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',this.key,iv),body=Buffer.concat([c.update(JSON.stringify(data),'utf8'),c.final()]);return Buffer.from(JSON.stringify({v:1,iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),body:body.toString('base64')}))}
 decode(data){const p=JSON.parse(data.toString('utf8'));if(p.v!==1)throw Error('版本不支持');const c=crypto.createDecipheriv('aes-256-gcm',this.key,Buffer.from(p.iv,'base64'));c.setAuthTag(Buffer.from(p.tag,'base64'));return JSON.parse(Buffer.concat([c.update(Buffer.from(p.body,'base64')),c.final()]).toString('utf8'))}
 transact(fn){const next=JSON.parse(JSON.stringify(this.state));const result=fn(next);if(result&&typeof result.then==='function')throw Error('事务必须同步');const data=this.encode(next),temp=this.file+'.tmp';
  const fd=fs.openSync(temp,'w',0o600);try{fs.writeFileSync(fd,data);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
  if(fs.existsSync(this.file)){const backups=path.join(this.dir,'backups');fs.mkdirSync(backups,{recursive:true,mode:0o700});fs.copyFileSync(this.file,path.join(backups,Date.now()+'-'+crypto.randomBytes(4).toString('hex')+'.enc'));const files=fs.readdirSync(backups).sort();for(const name of files.slice(0,-30))fs.unlinkSync(path.join(backups,name))}
  fs.renameSync(temp,this.file);this.state=next;return result;
 }
 close(){if(this.fd!==undefined){fs.closeSync(this.fd);this.fd=undefined;fs.unlinkSync(this.lock)}}
}
function audit(s,user,action,kind,id,fields){const entry={at:new Date().toISOString(),orgId:user.orgId,userId:user.id,action,kind,id,fields:fields||[],previous:s.audit.length?s.audit[s.audit.length-1].hash:''};entry.hash=crypto.createHash('sha256').update(JSON.stringify(entry)).digest('hex');s.audit.push(entry)}
module.exports={Store,audit};
