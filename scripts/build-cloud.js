'use strict';
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
for(const file of ['model.js'])fs.copyFileSync(path.join(root,'backend',file),path.join(root,'cloudfunctions/dispatch',file));
console.log('云函数共享校验模块已更新');
