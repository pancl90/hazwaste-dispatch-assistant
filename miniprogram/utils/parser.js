/* 危废清运智能待办助手 - 纯本地规则解析器。
 * 不向第三方上传信息。识别结果只能作为草稿，必须由业务员核对。
 * Node: require(); Browser: window.DispatchParser; 微信小程序: require('../../utils/parser')
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DispatchParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function pad(n) { return String(n).padStart(2, '0'); }
  function toISO(date) { return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()); }
  function atDay(base, delta) { var d = new Date(base.getFullYear(),base.getMonth(),base.getDate()); d.setDate(d.getDate() + delta); return d; }
  function validYMD(y,m,d) { var t=new Date(y,m-1,d); return t.getFullYear()===y && t.getMonth()+1===m && t.getDate()===d; }
  function pickupDate(text, now) {
    var warnings=[], date='', source='';
    var m=text.match(/(20\d{2})[年\/.\-](\d{1,2})[月\/.\-](\d{1,2})日?/);
    if (m) {
      var y=+m[1], mm=+m[2], dd=+m[3];
      if (validYMD(y,mm,dd)) date=toISO(new Date(y,mm-1,dd));
      else warnings.push('消息中的具体日期无效，请人工填写。');
      source='明确日期';
    }
    if (!date) {
      m=text.match(/(?:^|\D)(\d{1,2})月(\d{1,2})[日号]?/);
      if (m) {
        var year=now.getFullYear(), month=+m[1], day=+m[2];
        if (validYMD(year,month,day)) {
          var found=new Date(year,month-1,day), diff=(found-atDay(now,0))/86400000;
          if (diff < -60) {year++; warnings.push('未注明年份，按下一年推测，请核对。');}
          else warnings.push('原消息未注明年份，请确认。');
          if(validYMD(year,month,day)) date=toISO(new Date(year,month-1,day));
        } else warnings.push('消息中的月日不合法，请核对。');
        source='月日（无年份）';
      }
    }
    if (!date) {
      var d=null;
      if (/大后天/.test(text)) { d=atDay(now,3);source='相对日期'; }
      else if (/后天/.test(text)) { d=atDay(now,2);source='相对日期'; }
      else if (/明天|明日/.test(text)) { d=atDay(now,1);source='相对日期'; }
      else if (/今天|今日/.test(text)) { d=atDay(now,0);source='相对日期'; }
      if(d){ date=toISO(d);warnings.push('相对日期按当前录入日计算；如消息较早，请核对。'); }
    }
    if (!date) {
      m=text.match(/(下下周|下周|本周|这周|周|星期)([一二三四五六日天])/);
      if(m) {
        var n={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'日':7,'天':7}[m[2]], dayOfWeek=now.getDay() || 7;
        var monday=atDay(now,1-dayOfWeek), shift= m[1]==='下下周'?14:(m[1]==='下周'?7:0);
        var candidate=atDay(monday,shift+n-1);
        if(m[1]==='周'||m[1]==='星期') {
          if(candidate<atDay(now,0)) candidate=atDay(candidate,7);
          warnings.push('仅写“周几”未指明哪周，已推测最近的对应日期，请核对。');
        } else if(candidate<atDay(now,0)) warnings.push('消息指定的本周日期已过，请核对。');
        date=toISO(candidate);source='星期描述';warnings.push('星期描述按当前录入日推算；消息发送日或约定的周次可能不同，请核对。');
      }
    }
    if(!date) warnings.push('未识别到明确清运日期，请人工确认。');
    return {date:date,source:source,warnings:warnings};
  }
  function clean(s) {return String(s||'').replace(/^[\s：:,，；;。]+|[\s：:,，；;。]+$/g,'').trim();}
  function findClient(text) {
    var m=text.match(/(?:客户|产废单位|产废企业|单位名称|公司名称|企业)[：:\s]+([^，。；;\n]{2,48})/);
    if(m) return clean(m[1].replace(/(?:需要|计划|希望|要求|预计|要)?(?:清运|转运|安排|本周|下周|明天|今天).*$/,''));
    var segments=text.split(/[，,。；;\n]/);
    for(var i=0;i<segments.length;i++){
      var part=segments[i].trim();
      m=part.match(/([^，。；;\n\s]{2,42}?(?:有限责任公司|有限公司|股份公司|电子公司|科技公司|工厂|分厂|公司))(?=需|要|计|预|本|这|下|明|今|的|周|\s|$)/);
      if(m) return clean(m[1].replace(/^(?:张经理|李经理|王经理|您好|你好|麻烦)[：:,，\s]*/,''));
    }
    return '';
  }
  function parseMessage(input, referenceDate) {
    var raw=String(input||'').trim(), now=referenceDate instanceof Date?referenceDate:new Date(referenceDate||Date.now());
    if(isNaN(now.getTime())) now=new Date();
    var d=pickupDate(raw,now), warnings=d.warnings.slice();
    var client=findClient(raw), weight='', packaging='', wasteName='', wasteCode='', timeWindow='', contactName='', phone='', address='';
    var m=raw.match(/(?:约|大约|大概|预计|合计|共|总计)?\s*(\d+(?:\.\d+)?)\s*(吨|公斤|千克|kg|KG|t)(?!桶)/);
    if(m) weight=m[1]+(m[2]==='KG'||m[2]==='kg'?'公斤':m[2]==='t'?'吨':m[2]==='千克'?'公斤':m[2]);
    m=raw.match(/(\d+(?:\.\d+)?)\s*(?:个|只|袋装)?\s*(吨桶|铁桶|塑料桶|桶|袋|箱|托盘|包)/);
    if(m) packaging=m[1]+m[2];
    m=raw.match(/(HW\d{2})\b/i);if(m) wasteCode=m[1].toUpperCase();
    m=raw.match(/\b(\d{3}-\d{3}-\d{2})\b/);if(m) wasteCode=wasteCode? wasteCode+' / '+m[1]:m[1];
    var known=['废活性炭','废乳化液','废有机溶剂','废包装桶','废切削液','废油漆渣','废溶剂','废油泥','废酸液','废碱液','废电池','废油','废液','污泥','油泥','废酸','废碱','漆渣','废渣'];
    for(var i=0;i<known.length;i++) if(raw.indexOf(known[i])!==-1){wasteName=known[i];break;}
    m=raw.match(/(?:危废|危险废物|废物名称|废物品名)[：:\s]+([^，。；;\n\s]{2,24})/);
    if(m) wasteName=clean(m[1]);
    m=raw.match(/(上午|下午|中午|早上|晚上|凌晨|全天|夜间)/);if(m) timeWindow=m[1];
    m=raw.match(/(?:联系人|对接人)[：:\s]+([\u4e00-\u9fa5]{2,5})/);if(m) contactName=m[1];
    m=raw.match(/\b1[3-9]\d{9}\b/);if(m) phone=m[0];
    m=raw.match(/(?:地址|地点|装货地点|清运地址)[：:\s]+([^，。；;\n]{3,60})/);if(m) address=clean(m[1]);
    if (!client) warnings.push('未识别到客户全称，需要手动填写。');
    if (!weight) warnings.push('未识别到重量（未必代表客户未提供），请核对。');
    if (!wasteName) warnings.push('未识别到废物名称，请核对。');
    if (!wasteCode) warnings.push('未识别危废类别/代码，不能据此直接安排合规运输。');
    if (timeWindow && !/\d{1,2}[：:]\d{2}/.test(raw)) warnings.push('只识别到时段，未明确具体时间。');
    var priority=/紧急|加急|尽快|马上|急需|务必/.test(raw)?'紧急':'普通';
    var exactTime='';m=raw.match(/(?:上午|下午|中午|早上|晚上)?\s*(\d{1,2})[:：](\d{2})/);
    if(m && +m[1]<24 && +m[2]<60) {
      var hh=+m[1], mm=+m[2];
      var leading=raw.slice(Math.max(0,m.index-5),m.index)+m[0];
      if((/下午|晚上/.test(leading)) && hh<12) hh+=12;
      if(/中午/.test(leading) && hh<11) hh+=12;
      exactTime=pad(hh)+':'+pad(mm);
    }
    return {
      client:client, pickupDate:d.date, timeWindow:timeWindow, exactTime:exactTime,
      weight:weight, packaging:packaging, wasteName:wasteName, wasteCode:wasteCode,
      contactName:contactName, phone:phone, address:address,
      priority:priority, rawMessage:raw, warnings:warnings, dateInterpretation:d.source
    };
  }
  return { parseMessage:parseMessage, pickupDate:pickupDate, toISO:toISO };
});
