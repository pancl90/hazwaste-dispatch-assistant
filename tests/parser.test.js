const assert = require('node:assert/strict');
const {parseMessage} = require('../miniprogram/utils/parser');
const d = new Date(2026,9,30,12,0,0); // 2026-10-30 Friday
const a = parseMessage('张经理，上海某某电子公司这周五要清运废液，大概5吨，20个桶，尽量上午安排车辆。',d);
assert.equal(a.client,'上海某某电子公司');
assert.equal(a.pickupDate,'2026-10-30');
assert.equal(a.wasteName,'废液');
assert.equal(a.weight,'5吨');
assert.equal(a.packaging,'20桶');
assert.equal(a.timeWindow,'上午');
const b=parseMessage('客户：上海华欣环保有限公司；明天上午10:30安排废活性炭500公斤，12袋，危废代码HW49，联系人：张三，联系电话13800138000',d);
assert.equal(b.client,'上海华欣环保有限公司');
assert.equal(b.pickupDate,'2026-10-31');
assert.equal(b.wasteName,'废活性炭');
assert.equal(b.weight,'500公斤');
assert.equal(b.packaging,'12袋');
assert.equal(b.wasteCode,'HW49');
assert.equal(b.exactTime,'10:30');
assert.equal(b.phone,'13800138000');
assert.equal(parseMessage('下周一安排清运',d).pickupDate,'2026-11-02');
assert.equal(parseMessage('11月2日运输废油2.5吨',d).pickupDate,'2026-11-02');
assert.equal(parseMessage('2026年11月31日运输',d).pickupDate,'');
assert.equal(parseMessage('请处理',d).pickupDate,'');
assert.equal(parseMessage('后天15:30废油1.2吨',d).exactTime,'15:30');
assert.equal(parseMessage('约5吨左右请安排车辆',d).weight,'5吨');
assert.equal(parseMessage('20个吨桶的废液',d).weight,'');
assert.equal(parseMessage('11月31日',d).pickupDate,'');
// 30 distinct synthetic customer messages; no real customer information is used.
const messages=Array.from({length:30},(_,i)=>{
 const names=['废液','废油','污泥','废酸','废活性炭'];const dates=[['明天','2026-10-31'],['后天','2026-11-01'],['下周一','2026-11-02'],['11月3日','2026-11-03'],['2026年11月4日','2026-11-04']];
 const [date,expected]=dates[i%5],waste=names[i%5],quantity=i+1;return {text:'客户：演示'+(i+1)+'号环保有限公司；'+date+'下午3:30清运'+waste+quantity+'公斤，'+quantity+'袋，HW49',client:'演示'+(i+1)+'号环保有限公司',date:expected,waste,quantity};
});
for(const item of messages){const result=parseMessage(item.text,d);assert.equal(result.client,item.client,item.text);assert.equal(result.pickupDate,item.date,item.text);assert.equal(result.wasteName,item.waste,item.text);assert.equal(result.weight,item.quantity+'公斤',item.text);assert.equal(result.packaging,item.quantity+'袋',item.text);assert.equal(result.exactTime,'15:30',item.text);assert.equal(result.wasteCode,'HW49',item.text)}
assert.ok(parseMessage('下周一安排清运',d).warnings.some(w=>w.includes('周次')));
console.log('PASS: existing scenarios + 30 synthetic customer message templates');
