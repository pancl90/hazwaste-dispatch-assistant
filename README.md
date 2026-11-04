# 危废清运智能待办助手

将主动提供的清运通知整理为 **人工核对 → 清运待办 → 车辆安排 → 提醒跟进 → 完成归档**。

[![Tests](https://github.com/pancl90/hazwaste-dispatch-assistant/actions/workflows/test.yml/badge.svg)](https://github.com/pancl90/hazwaste-dispatch-assistant/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

提供微信原生小程序、浏览器工作台和免安装离线 HTML。支持腾讯云开发和自建 Node.js API 两种同步通道，保留离线使用及现有数据格式。当前版本 **2.3.0**。

## 快速开始

### 离线电脑端：无需安装

下载并完整解压源码，双击 `START_HERE.html`，或双击 `启动电脑预览.bat`。使用固定浏览器和目录；更换设备、浏览器或站点前，先导出 JSON 备份。

录入消息、核对解析结果后保存，再安排车辆和推进任务。所有解析在设备上使用本地规则完成；离线版不需要联网。

### 自建同步服务

需要 Node.js 18 或更高版本，根项目没有第三方 npm 运行依赖。

1. Windows 双击 `初始化同步服务.cmd`，设置组织、管理员和密码；没有默认密码。
2. 双击 `启动同步工作台.cmd`，在打开的工作台登录。
3. 需要新增成员时停止服务，再运行 `添加业务员.cmd`。

跨设备使用需自行部署 HTTPS 服务。加密密钥、目录权限、备份、账号和通知配置见 [DEPLOYMENT.md](DEPLOYMENT.md)。

### 微信小程序与云开发

1. 微信开发者工具导入项目根目录，使用**自己的**小程序 AppID 替换 `project.config.json` 的 `touristappid`。
2. 离线功能可先编译体验。云同步默认关闭，不连接原作者的环境。
3. 按 [CLOUDBASE_DEPLOYMENT.md](CLOUDBASE_DEPLOYMENT.md) 创建自己的环境、四个受保护集合和 `dispatch` 云函数，设置 `DISPATCH_APP_ID`，在受保护后台初始化首位管理员。
4. 验证权限后，在 `miniprogram/cloud.config.js` 填写自己的环境并启用，再用真机验收。

上传代码不等于审核或发布成功。请根据实际接口填写微信隐私指引，并在发布前完成真机、权限和恢复验收。

## 功能与边界

| 功能 | 状态 |
|---|---|
| 主动粘贴消息、本地解析、歧义提示、人工核对 | 已实现 |
| 六种任务状态、原文追溯、运输安排、搜索筛选 | 已实现 |
| 客户全称与别名、联系人、地址、合同日期、清运历史 | 已实现 |
| D-2 / D-1 / 当天 / 逾期提醒、已读、跟进、稍后提醒 | 已实现 |
| 离线草稿、同步队列、账号隔离、幂等与修订冲突 | 已实现 |
| 管理员与员工、成员启停、管理员迁移及回滚 | 已实现，见 [权限说明](ROLE_PERMISSIONS.md) |
| 电脑端 CSV 导出、JSON 备份恢复 | 已实现 |
| 微信官方订阅通知 | 自建 API 有适配代码，需真实模板、主动授权与发送验收；云开发通道未接入发送任务 |
| 云开发多人共享客户与任务 | 尚未实现，各微信账号业务数据独立 |
| OCR、语音、附件、车辆冲突日历、正式联单接口 | 尚未实现 |

这是一套清运协调和提醒工具。危废类别、代码、数量等缺失时保持待核实；不自动生成许可证、联单或合规核验结论。

不提供个人微信聊天的静默抓取、Hook、注入或逆向接口。消息由用户主动提供；客户原文不发送给外部 AI。小程序的剪贴板读取由用户点击触发。

云开发管理员可管理成员角色，但不会自动获得其他微信账号的客户或任务。停用账号不能远程收回已缓存、已导出或已展示的数据。

## 开发与测试

```sh
npm run build
npm test
node server.js
```

Windows PowerShell 可使用 `npm.cmd`。云函数依赖单独安装，优先采用开发者工具“上传并部署：云端安装依赖”；根项目不需要 `npm install`。

自动化测试覆盖 30 项场景，包含解析、权限隔离、角色撤销、最后管理员保护、同步、冲突、迁移回滚、备份、加密存储和订阅通知门控。测试使用虚构记录；测试通过不代表已配置生产环境或完成微信真机通知验收。

```text
backend/                     自建 API、加密文件库和官方微信适配
cloudfunctions/dispatch/     云开发身份、业务 API、事务和角色校验
miniprogram/                 原生小程序与共享业务模块
web/                         浏览器工作台
scripts/                     构建、账号、备份、恢复和保留期工具
tests/                       虚构数据自动化测试
START_HERE.html              生成的免安装离线工作台
```

界面采用大标题、分组卡片、浅灰背景与蓝色操作，说明见 [UI_UPDATE.md](UI_UPDATE.md)。开发计划见 [CODEX_NEXT_STEPS.md](CODEX_NEXT_STEPS.md)，开源配置与发布范围见 [OPEN_SOURCE.md](OPEN_SOURCE.md)。

## 参与与许可

欢迎通过 Issues 报告问题、通过 Pull Request 改进代码。请只提交虚构或彻底脱敏的示例，遵循 [贡献指南](CONTRIBUTING.md) 和 [安全说明](SECURITY.md)。

本项目按 [MIT License](LICENSE) 开源，允许使用、修改与商业使用，分发时保留许可声明。微信及云服务 SDK 等第三方组件仍按各自许可和服务条款使用。
