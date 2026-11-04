'use strict';
const cloud=require('wx-server-sdk');
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV});
const {createStore}=require('./store');
const {createHandler}=require('./service');
// This function is exclusively a wx.cloud.callFunction entry point. No HTTP/timer triggers.
const appid=process.env.DISPATCH_APP_ID;
if(!/^wx[a-f0-9]{16}$/.test(appid||''))throw Error('Set DISPATCH_APP_ID to your own WeChat AppID before deploying dispatch');
const handle=createHandler({store:createStore(cloud.database({throwOnNotFound:false})),appid});
exports.main=async event=>handle(event,cloud.getWXContext());
