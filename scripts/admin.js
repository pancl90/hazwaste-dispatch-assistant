'use strict';const fs=require('node:fs');const path=require('node:path');const readline=require('node:readline/promises');const crypto=require('node:crypto');const {createApplication}=require('../backend/application');const {config}=require('../backend/config');
(async()=>{let app,rl;try{
 const command=process.argv[2];if(!['init','user','backup','restore'].includes(command))throw Error('用法：node scripts/admin.js init | user | backup | restore <encrypted-backup.enc>');
 const dataDir=path.resolve(process.env.DATA_DIR||path.join(__dirname,'../data'));fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
 if(command==='init'&&!process.env.DATA_KEY&&!fs.existsSync(path.join(dataDir,'local.key'))){if(fs.existsSync(path.join(dataDir,'store.enc')))throw Error('现有数据缺少密钥，请恢复原密钥；禁止创建替代密钥');fs.writeFileSync(path.join(dataDir,'local.key'),crypto.randomBytes(32),{mode:0o600,flag:'wx'})}
 app=createApplication(config());
 if(command==='backup'){const target=path.join(dataDir,'manual-backup-'+Date.now()+'.enc');fs.writeFileSync(target,app.store.encode(app.store.state),{mode:0o600,flag:'wx'});console.log('加密备份：'+target);return}
 if(command==='restore'){const target=process.argv[3];if(!target)throw Error('请指定加密备份路径');const restored=app.store.decode(fs.readFileSync(path.resolve(target)));if(restored.schema!==2||!Array.isArray(restored.users))throw Error('备份格式不匹配');if(process.env.CONFIRM_RESTORE!=='RESTORE')throw Error('恢复会覆盖当前云端数据；核对备份后设置 CONFIRM_RESTORE=RESTORE 再运行。现有数据会自动留存加密备份。');app.store.transact(s=>{for(const k of Object.keys(s))delete s[k];Object.assign(s,restored);s.sessions=[];s.dataVersion=(s.dataVersion||0)+1});console.log('已恢复；所有用户须重新登录。');return}
 if(command==='init'&&app.store.state.users.length){console.log('服务已初始化；新增账号请使用 node scripts/admin.js user');return}
 rl=readline.createInterface({input:process.stdin,output:process.stdout});const username=process.env.SETUP_USERNAME||await rl.question('业务员账号（英文/数字，至少3位）：');const orgId=process.env.SETUP_ORG||await rl.question('组织ID（英文/数字/横线，至少4位）：');
 const password=process.env.SETUP_PASSWORD;if(!password)throw Error('请使用“初始化同步服务.cmd”安全输入密码，或由部署系统注入 SETUP_PASSWORD（至少12位），不要把密码写入命令参数。');
 const user=await app.addUser({username,orgId,password,role:command==='init'?'admin':process.env.SETUP_ROLE||'member'});delete process.env.SETUP_PASSWORD;console.log('已创建账号 '+user.username+' / '+user.orgId+'（'+user.role+'）');
 }catch(e){console.error(e.message);process.exitCode=1}finally{if(rl)rl.close();if(app)await app.close()}})();
