'use strict';
// Local-only helper. Never deploy an administrator bootstrap HTTP/cloud endpoint.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function main(){
 const input=process.argv[2];
 if(!input||!input.endsWith('.local.json'))throw Error('Usage: node scripts/cloud-admin-seed.js identity.local.json (trusted official context only)');
 const identity=JSON.parse(fs.readFileSync(path.resolve(input),'utf8').replace(/^\uFEFF/,''));
 if(!/^wx[a-f0-9]{16}$/.test(identity.APPID||'')||typeof identity.OPENID!=='string'||!identity.OPENID.trim()||identity.OPENID.length>128)throw Error('A valid APPID and trusted official OPENID are required');
 const now=new Date().toISOString(),id=crypto.createHash('sha256').update(identity.APPID+':'+identity.OPENID).digest('hex');
 const target=path.resolve(__dirname,'../output/admin-seed.local.json');
 const doc={_id:'dispatch_team_roles_v1',schemaVersion:1,revision:1,accessEpoch:0,initializedAt:now,members:[{id,displayName:'管理员',role:'admin',active:true,revision:1,createdAt:now,updatedAt:now}]};
 fs.mkdirSync(path.dirname(target),{recursive:true});
 fs.writeFileSync(target,JSON.stringify([doc],null,2)+'\n',{flag:'wx',mode:0o600});
 console.log('Created output/admin-seed.local.json. Import ONCE into an EMPTY protected dispatch_members_v1 collection; do not commit this file.');
}
try{main()}catch(error){console.error(error.message);process.exitCode=1}
