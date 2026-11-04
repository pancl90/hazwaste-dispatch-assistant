# 企业同步部署、数据迁移与回滚

适用版本：2.0.0，2026-10-31。后端选择**企业自建 Node.js API**，不依赖第三方 AI 或聊天采集服务。现有交付完成代码与本地验收；尚未部署企业域名，尚未完成微信真机发送验收。

## 1. 运行边界和凭证

- Node.js 18+；无 npm 第三方依赖，不需要 `npm install`。
- 当前持久层为单进程加密文件库，适合小团队试点；同一数据目录只允许一个进程，拒绝重复启动。不能横向扩容或放在不保证原子重命名的网络盘上。扩容前应实现数据库适配层并重新验收事务与权限。
- 部署者需要单位批准的服务器、HTTPS 域名及证书、存储卷、独立密钥保管、备份目标、操作账号与数据保留制度。应用代码不会替单位申请或发布这些资源。
- 正式微信能力需要真实 AppID / AppSecret、已获批的一次性订阅模板及其字段、微信后台合法 request 域名、稳定出网和平台要求的 IP 配置。`touristappid` 只用于项目占位，不能发送通知或发布。
- 小程序仍需微信开发者工具编译、体验版与真机验收；Node 语法和 Page 仿真不能替代官方编译器。

本地试用：先双击 `初始化同步服务.cmd` 创建首个管理员账号，再双击 `启动同步工作台.cmd`。初始化脚本使用隐藏密码输入，密码只在启动子进程时暂存环境变量。**无默认账号或密码**。服务本地试用只绑定回环地址，默认端口 8765。

新增业务员：关闭服务后双击 `添加业务员.cmd`。同单位使用同一组织ID，默认成员只能访问自己负责或被明确授权的任务和客户；管理员被授权管理其组织全部业务记录。不同组织完全隔离。

生产环境设置：

| 变量 | 内容 |
|---|---|
| `NODE_ENV` | `production` |
| `DATA_DIR` | 独立持久目录，禁止放在任何静态站点目录或共享公开盘 |
| `DATA_KEY` | 安全生成的32字节随机数的 Base64，交由密钥管理系统注入；不得写进小程序或版本库 |
| `PUBLIC_ORIGIN` | 例如 `https://dispatch.example.com`，不带路径 |
| `HOST` | 建议 `127.0.0.1`，由同机 HTTPS 反向代理转发 |
| `PORT` | 默认 `8765` |
| `TRUST_PROXY` | 仅在受信任代理且内部端口不可公网访问时设 `1`；代理须覆盖外部提交的 `X-Forwarded-Proto` |
| `WX_APP_ID` / `WX_APP_SECRET` | 仅服务端注入 |
| `WX_TEMPLATE_ID` | 微信公众平台实际订阅模板ID |
| `WX_TEMPLATE_DATA` | 模板字段到允许的通用内容映射，如 `{"thing1":"summary","number2":"count"}`，字段名须与真实模板一致 |
| `WX_STATE` | `formal` / `trial` / `developer`，由部署者按验收阶段设置 |
| `WX_WORKER` | `1` 才启动分钟调度；按北京时间09:00以后检查，每用户每天最多一次合并发送 |

`WX_TEMPLATE_DATA` 允许的内容值为 `summary`、`count`、`date`、`title`，不允许客户名、电话、地址和微信原文。上述示例不是可直接使用的真实模板；必须按平台批准字段验证。后端向微信官方端点校验 `wx.login` 的 code，客户端不能直接提交 openid 冒充收件人。AppSecret、access_token、session_key 均不返回前端。

生产服务器必须由管理员设置操作系统目录ACL（Unix mode 无法替代 Windows ACL），只允许服务账号和备份管理员访问数据目录。浏览器与微信本地缓存本身未加密，须在批准的工作设备使用；账号退出会切回本地模式，保留该账号离线草稿以防丢失。若设备移交，须先完成同步和备份，再按单位制度清理该站点/小程序缓存。

## 2. 数据模型和权限

| 集合 | 主要字段 |
|---|---|
| `users` | 用户ID、组织ID、角色、active、scrypt密码派生值与盐、官方校验的openid（仅服务端） |
| `sessions` | token哈希、userId、12小时有效期；前端仅持有短期 bearer |
| `tasks` | 客户ID/名称快照、危废名称/代码、预计重量/单位、实收重量、件数/包装、计划日期/时段、原文与不可覆盖的首次原文、来源、负责人、运输安排、状态、跟进、核实状态、附件保留字段、历史日志 |
| `customers` | 全称、别名、联系人、电话、地址、合同到期、已核实废物信息、负责人 |
| `reminderStates` | 当前用户、taskId、reminderKey、已读/本次已跟进/稍后时间 |
| `audit` | 服务端时间、组织、操作者、对象ID、动作、字段名、前一条日志哈希和本条哈希；不记录原文或电话 |
| `operations` | 用户范围内的幂等操作ID、请求摘要、结果 |
| `migrations` | 用户范围内批次ID、输入摘要、新增/跳过映射、回滚状态 |
| `subscriptions` / `challenges` / `deliveries` | 授权回执、一次性短时挑战、次数保守记账、发送占位和结果 |

所有业务记录由服务端写入 `orgId/ownerId/revision/createdAt/updatedAt`；不能通过请求体换组织或负责人。客户端时间只用于本地草稿。缺失的危废信息保持空白/待核实；不生成危废分类或合规核验结论。新状态枚举未引入：待安排、待确认、已安排、运输中、已完成、已取消。

附件仅预留模型字段，目前没有附件上传入口。重量保留旧版文字字段，另设 `weightUnit/actualWeight/packageCount` 扩展字段；未对旧重量文字擅自做换算，未覆盖实际称重数据。

## 3. API 契约

业务接口要求 `Authorization: Bearer <session-token>`，组织与用户只取服务端会话。错误响应为 `{error,details?}`；未认证401、无权限/不存在404、格式400、冲突409。登录有尝试限流；无公开注册接口。禁止跨站 Origin，电脑端必须打开同一服务的 `/web/` 页面；离线HTML不发起远端客户同步。

| 接口 | 行为 |
|---|---|
| `POST /api/auth/login` | `{username,password}` → `{token,user,expiresAt}` |
| `POST /api/auth/logout`、`GET /api/me` | 撤销会话、身份/微信配置概况 |
| `GET /api/{tasks,customers,reminderStates}` | 仅授权记录；`q/status/limit/cursor` 服务端筛选分页，limit≤200 |
| `GET /api/{kind}/:id` | 单条授权记录 |
| `PUT /api/{kind}/:id` | `{record,baseRevision,operationId,allowDuplicate?}` → `{record}`；新增baseRevision=0 |
| `DELETE /api/{kind}/:id` | `{baseRevision,operationId}` → 服务端墓碑；有关联任务的客户不能直接删除 |
| `GET /api/sync?kind=tasks&cursor=...` | 含墓碑的授权快照；分页过程中数据变化返回409，客户端保留旧缓存并要求再同步 |
| `GET /api/team` | 同组织可授权的成员最小身份信息 |
| `PUT /api/share/{tasks,customers}/:id` | `{userIds,baseRevision}`，仅负责人/管理员可授权；任务及关联客户须分别授权 |
| `GET /api/audit` | 成员仅自己的操作，管理员本组织操作，最近200条 |
| `POST /api/migrations` | `{batchId,tasks,customers}`，每批总计≤500条、总请求≤2MB |
| `POST /api/migrations/:batchId/rollback` | 整批回滚新增记录，已有后续修改或关联则整批拒绝 |
| `GET /api/reminders` | 同一套北京时间规则计算当前用户提醒 |
| `POST /api/wechat/bind` | `{code}`，仅服务器调用官方 code2Session 校验身份 |
| `POST /api/wechat/subscription/challenge` | 返回短期一次性挑战与服务端实际模板ID |
| `POST /api/wechat/subscription` | `{challengeId,result}`，记录主动订阅回执，防重放；reject/ban撤销本地可用记账 |
| `GET /api/wechat/status` | 配置/任务开关、绑定、客户端上报次数和最近发送状态 |

`allowDuplicate` 只是人工确认业务差异后的新增许可，不能绕过权限或修订号。授权共享接口已具备，当前页面暂未提供团队授权面板，管理员可按API操作。

## 4. 同步、迁移与回滚

1. 离线模式继续读写原 `hazwaste_dispatch_v1`；客户/提醒另用v2键。**不会静默上传旧记录**。
2. 登录后按“服务地址+组织ID+用户ID”使用独立缓存；原浏览器/微信旧数据保留，退出可返回。
3. 新建/修改/删除先原子保存到本机快照与上传队列，再由用户点击“立即同步”。联网不代表已经同步，界面显示待上传数、冲突数和最后完成时间。未保存的消息表单另存本机草稿。
4. 请求有持久化幂等操作ID，服务端成功但响应丢失可原样重试；连续离线修改按序使用修订号提交。全量分页拉取完整成功后才替换缓存；失败不会用空列表覆盖本机记录。
5. 修订号不一致时保留本机草稿与云端记录。核对后选择采用云端，或确认保留本地再按云端当前修订号提交；不按设备时间静默覆盖。云端已删除的记录需另建，不能用冲突按钮复活墓碑。
6. 旧数据迁移：先退出云端并导出完整JSON留存，再登录正确组织，点击“备份并迁移旧数据”。系统再次生成备份；电脑端下载迁移回执，小程序在本机保存回执。迁移接口同时校验原ID及当前负责人范围内标准化消息摘要；跨设备迁移相同消息会返回canonicalId，已有记录不会被覆盖。
7. 本阶段UI单批最多500条，超过时不上传；管理员可拆成多个批次，每批保留独立回执。不要在两个设备上同时迁移和编辑同一批旧数据。
8. 批次幂等：相同batchId与相同输入返回同一回执；相同ID不同内容拒绝。失败事务不会留下半批数据。回滚仅将该批新增且未经修改的记录变为墓碑；跳过的旧云端记录不受影响。回滚后用新batchId重新迁移。
9. 自行保留升级前源码和配置以便恢复程序。恢复程序不等于恢复浏览器数据；导入JSON才恢复本机记录。同一文件路径/浏览器原存储键保持兼容。更换目录、域名或浏览器需主动备份导入；角色版本回退必须保留管理员鉴权。

JSON备份仍使用原格式version=1并带extensionVersion=2，含客户、提醒与首次原文，可导入旧版仅含任务的备份。导入只合并新ID，不覆盖当前同ID记录。云端模式导入后进入上传队列；客户先于关联任务提交。

## 5. 微信通知实际行为

- 用户先登录单位账号、点击绑定微信，再通过**点击按钮**调用 `wx.requestSubscribeMessage`。程序不在启动或定时器里自动请求订阅。
- 客户端回执只能用于保守记账，不能独立证明微信仍有剩余次数；最终以官方发送API校验为准。代码不声称可以查询平台全部真实剩余授权次数。正式验收必须测试拒绝、授权耗尽、撤销、模板错误、超时及后台账号绑定。
- 后台任务预先持久化“sending”占位并保留一次授权；成功才记“sent”。微信明确拒绝记“failed”；网络断开/结果不明记“unknown”，不自动重发，人工检查后通过后续新订阅和次日提醒继续跟进。进程在发送期间退出也不会重发同一天的占位。
- 已读只影响未读标记，已跟进与稍后提醒会影响后续应用内列表与待发送汇总。任务完成/取消后不再生成提醒。服务停止、未配worker、未绑定或没有授权次数时不会自动发送。
- 未实现长期订阅、发送事件回调对账及客户端上报次数与官方事件的自动核对。不得把客户端上报当作服务通知已送达。

参考： [腾讯官方订阅消息实践](https://cloud.tencent.com/document/product/1301/103770)、[主动订阅接口](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/subscribe-message/wx.requestSubscribeMessage.html)、[发送接口](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/mp-message-management/subscribe-message/sendMessage.html)、[登录凭证校验](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html)。发布前请按当前微信后台与官方文档复核模板适用场景和审核要求。

## 6. 备份、恢复、保留与账号停用

- 每次提交前保留上一份加密快照，自动轮换最近30份；此机制用于快速回退，不能替代异机每日备份。AES-256-GCM对业务数据、会话、审计、回执整体加密；写入使用临时文件、fsync与原子替换，错误密钥/损坏数据会停止启动，不静默重建。
- 停止服务，运行 `node scripts/admin.js backup` 生成带时间戳的手工加密快照。部署方将其备份至单位批准的独立位置，密钥另行托管。丢失密钥无法恢复。
- 恢复前停止服务、核对目标路径和备份日期，再设置环境变量 `CONFIRM_RESTORE=RESTORE`，执行 `node scripts/admin.js restore <备份绝对路径>`。恢复会先保留当前加密库备份，并撤销所有旧会话；恢复后须重新登录。不要只复制密文而丢失密钥。
- 本地试用的 `data/local.key` 与数据同机，主要降低误公开密文风险；企业环境必须用外部密钥和操作系统ACL，不允许把整个data目录打包公开。
- 默认不自动删除业务资料。管理员按单位制度设 `RETENTION_DAYS`（至少30天），运行 `node scripts/retention.js` 预览符合期限的完成/取消任务数量；审核并备份后，设 `CONFIRM_RETENTION=APPLY` 执行。清理保留ID墓碑，移除任务业务内容，审计仅保留动作元数据。备份与离线缓存需另行按同一制度清理。
- 停用业务员：停止服务后 `node scripts/disable-user.js <username>`；会撤销会话/订阅，不能停用组织最后一位管理员。停用不擅自删除单位客户资料。

## 7. 验收与尚未实现

执行 `npm.cmd run build`、`npm.cmd test`。测试仅使用虚构记录：解析≥30模板、权限隔离、CRUD、分页、幂等、冲突、迁移/回滚、离线重试、备份、加密/锁/损坏拒绝、微信授权门控与官方接口适配。前端经过浏览器交互验证；小程序Page逻辑经过仿真，仍需官方开发者工具和真机测试。

尚未完成：实际云服务器部署及运维、真实微信推送联调、图片OCR/语音识别、附件上传、企业微信合法会话存档、日历授权、运输资源冲突日历、正式联单接口、团队授权页面、大规模数据库、MFA与企业SSO、自动外部备份与微信事件回调对账。没有个人微信Hook、注入、逆向抓取、自动浏览聊天或外部AI客户内容上传功能。
