# PostLuma 开发计划

> 依据：[PRD.md](PRD.md) + 2026-10-18 确认的决策。部署目标：Cloudflare **Workers & Pages**（Git 仓库接入 Workers Builds 自动构建部署）。
> 状态标记：`[x]` 完成 · `[ ]` 待办。优先级：P0 必须 · P1 本期应做 · P2 可延后。

## 0. 已确认的决策

### 技术架构

| 决策 | 选择 | 理由 |
|---|---|---|
| 部署形态 | **单个 Worker** + Workers Static Assets 托管 Vue SPA | Email Worker 必须是 Worker；前端、API、收信放在同一个 Worker，共享 D1 绑定和类型，部署一次 |
| 入口 | `fetch`（Hono API + 静态资源）· `email`（收信）· `scheduled`（定时清理） | 见 `worker/index.ts` |
| 前端 | Vue 3 + Vite + vue-router + **Naive UI** + **vue-i18n** | 本地开发直接运行在 workerd 中 |
| 后端 | Hono + zod；邮件解析使用 postal-mime | 体积小，原生支持 Workers |
| 存储 | D1；R2 可选（存放原始 .eml 和附件） | D1 单行上限约 2 MB，超大正文需截断或转存 R2 |
| 认证 | PBKDF2-SHA256（WebCrypto）+ HttpOnly Cookie Session，D1 只存 token 的哈希 | 无需额外服务 |
| 防护 | Workers Rate Limiting（`AUTH_LIMITER`）+ Turnstile + Origin 校验 | PRD §6 |

### 产品决策

| # | 问题 | 结论 |
|---|---|---|
| 1 | 归档状态 | **不设置**，以 PRD §3 为准 |
| 2 | 邮箱状态 | 只有 **使用中（active）** 和 **已停用（disabled）** 两种，停用后可重新启用 |
| 3 | 停用邮箱的历史邮件 | 在专门的“已停用邮箱”页面查看；全局收件箱和主邮箱列表只显示使用中的邮箱 |
| 4 | 删除邮箱 | **不提供删除邮箱功能**，只有 使用中 ⇄ 已停用。地址永不复用；删除用户账户时，其地址写入 `retired_addresses` 永久保留 |
| 5 | 多域名 | 支持。管理员在后台维护 `domains` 表，用户创建邮箱时选择域名 |
| 6 | 注册 | 不需要邀请码；管理员可通过 `registration_open` 开关关闭注册 |
| 7 | 多语言 | 初版提供 `zh-CN` 和 `en`；新增语言（如日语）只需增加一个语言文件 |
| 8 | 安全重点 | **用户间数据隔离**为最高优先级，见 §1 |
| 9 | 管理员权限 | 管理员只看聚合统计，**不能查看用户的邮件内容** |
| 10 | 配额 | 只统计使用中的邮箱；停用的邮箱不占配额，重新启用时需要重新检查配额 |

> 全局收件箱默认**不包含**已停用邮箱的邮件，这些邮件在“已停用邮箱”页面查看。

## 1. 安全与隔离设计（贯穿所有阶段）

用户数据隔离分五层，每一层都有对应的测试：

1. **身份层**：每次请求都从 Cookie 解析 session，并重新查询 `users.status='active'`。封禁、拒绝、改密码时删除该用户的全部 session，立即生效。
2. **路由层**：`requireUser` 和 `requireAdmin` 中间件；除 `/api/auth/*` 和 `/api/health` 外，所有路由默认需要登录（未登录返回 401）。
3. **数据访问层**：路由不直接调用 `env.DB`。所有用户数据只能通过 `worker/repo/*` 访问，函数签名强制传入 `userId`，SQL 一律带 `user_id = ?`。访问他人资源时返回 **404**，防止通过 id 探测。
4. **收信层**：只按小写收件地址精确匹配邮箱，`user_id` 只取自邮箱记录，不信任任何邮件头；不支持 `+tag` 子地址。
5. **渲染层**：HTML 邮件放在 sandbox iframe 中渲染，并加 CSP 和 DOMPurify 过滤；远程资源默认不加载。

其他措施：

- CSRF：Cookie 设置 `SameSite=Lax`，写操作还要校验 `Origin` 与站点同源。
- 安全响应头：通过 `public/_headers` 给 SPA 设置 CSP、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`。
- 管理操作和登录失败写入 `audit_logs`。
- 测试矩阵 `test/isolation/*.test.ts`：每个接口都用“用户 A 的资源 × 用户 B 的会话”测试，断言返回 404 且数据未被修改；新接口不带这类测试不合并。

## Phase 0 · 项目初始化 ✅

- [x] 搭建 Vue + Worker 脚手架，配置 wrangler.jsonc（D1、限流、Cron、SPA 回退、`/api/*` 优先进入 Worker）
- [x] D1 schema：`migrations/0001_init.sql`（users / sessions / domains / mailboxes / retired_addresses / messages / attachments / audit_logs / settings）
- [x] `/api/health` + Workers 运行时测试；type-check、build、本地 dev 冒烟验证通过

## Phase 1 · 认证、鉴权骨架与前端框架（P0）✅

后端：
- [x] `worker/lib/password.ts`：PBKDF2 哈希与校验（随机盐、常量时间比较）
- [x] `worker/lib/session.ts`：生成 token，SHA-256 后写入 D1；Cookie 设置 `HttpOnly; Secure; SameSite=Lax`；登录时轮换 token
- [x] `worker/middleware/`：`requireUser`、`requireAdmin`、`checkOrigin`、统一错误码响应 `{ error: '<code>' }`
- [x] 管理员初始化：数据库中没有 admin 时，用 `ADMIN_INITIAL_PASSWORD` 创建 `admin`（幂等，首次以 admin 登录时触发）
- [x] 安全复审加固：去掉按用户名限流（防止恶意锁号）、Turnstile 默认拒绝、管理员只初始化一次、会话写入与密码/状态校验原子绑定、请求体上限 64 KB、HSTS；均有回归测试
- [x] 默认拒绝：`worker/app.ts` 中 `PUBLIC_ROUTES` 白名单以外的 `/api/*` 全部要求登录
- [x] API：`POST /api/auth/register`（遵守 `registration_open`，新用户状态为 pending）、`login`、`logout`、`GET/PATCH /api/auth/me`（语言偏好）、`POST /api/auth/password`、`GET /api/settings/public`
- [x] 登录和注册接入 `AUTH_LIMITER`（按 IP + 用户名）、Turnstile 校验，失败时写审计日志

前端：
- [x] 安装 Naive UI 和 vue-i18n；建立 `src/locales/{zh-CN,en}.ts`；Naive UI 的 locale 和日期 locale 随语言切换；语言优先取用户设置，其次 localStorage，最后浏览器语言
- [x] 应用布局：侧边栏（首页 / 收件箱 / 邮箱 / 已停用邮箱 / 管理后台）+ 顶栏（语言切换、亮暗主题、用户菜单），适配移动端
- [x] 登录页和注册页（显示 Turnstile；提交后提示“等待审核”）；路由守卫；`src/api/client.ts` 把错误码映射为 i18n 文案

测试：
- [x] 状态为 pending、rejected、banned 的用户无法登录；封禁后已有 session 立即失效；跨站 Origin 的写请求被拒绝；超出限流返回 429

## Phase 2 · 邮箱管理（P0）✅

- [x] 邮箱 repo：所有函数的第一个参数都是 `userId`
- [x] 随机前缀生成（易读字符集）；自定义前缀规则：小写字母、数字及 `.`、`-`、`_`，长度 3–32，不允许 `+`，保留词黑名单
- [x] 创建邮箱时依次校验：域名已启用 → 地址不在 `mailboxes` 和 `retired_addresses` 中 → 使用中的邮箱数未超出配额
- [x] API：`GET/POST /api/mailboxes?status=active|disabled&q=`、`PATCH /api/mailboxes/:id`（备注、停用/启用；启用时重新检查配额）、`GET /api/domains`（只返回已启用的域名）；**不提供 DELETE**
- [x] 前端“邮箱”页：域名选择器 + 一键生成并自动复制 + 自定义前缀、备注、搜索、停用
- [x] 前端“已停用邮箱”页：列表、查看历史邮件、重新启用（超出配额时提示）
- [x] 隔离测试：无法读取或修改他人邮箱；已存在或已退役的地址无法被任何用户再次创建；停用不占配额，启用超额时被拒绝
- [x] （从 Phase 5 提前）管理员域名管理：`/api/admin/domains` 增删改 + 后台“收信域名”页；只能删除从未使用过的域名
- [x] 首页：问候 + 一键创建 + 最近 5 个地址
- [x] 安全复审加固（migration `0002`）：地址总数上限（含停用，默认 100）与 24 小时新建上限（默认 30）；数据库触发器强制地址和域名小写；过滤备注中的控制字符和双向覆盖字符；未读部分索引
- [x] 待确认事项记录在 `docs/QUESTIONS.md`

## Phase 3 · 邮件接收 Email Worker（P0）✅

- [x] `email` handler：收件地址必须是 ASCII，转小写后精确匹配；邮箱不存在、已停用、所属用户非 active 时统一用 `Mailbox unavailable` 拒收（不泄露地址状态）；停用域名下已有地址照常收信（Q3）
- [x] 只读取并解析邮件的前 256 KB（免费版 CPU 预算；实测最坏约 5 ms），超出部分丢弃并标记 `is_truncated`；解析失败（畸形 MIME）明确退信，不抛异常
- [x] 存储上限：HTML 256 KB、纯文本 64 KB；附件只存元数据（JSON 字段 `attachments_json`，内嵌图片不算附件）；单独记录信封发件人 `envelope_from`；主题、发件人名、文件名过滤控制字符和双向覆盖字符
- [x] 验证码提取 `worker/lib/otp.ts`：中英日强/弱关键词，数字（含 `482 913`、`482-913`、`48 29 13`、全角数字）和 5–8 位大写字母数字；排除年份、日期、金额（多币种）、电话、卡号尾号、包裹号、时间、时长、URL，以及 promo/zip/error/QR code 等；46 条表驱动测试
- [x] 防刷与全站额度（migration `0003`，均为可调的 `settings`）：每邮箱每小时 60 封、每用户每小时 120 封、全站每天 5000 封 / 50 MB；所有限制都在条件 INSERT 中原子校验，并发不会超额；超出时退信
- [x] 写入放大：每封邮件约 7 次 D1 行写入（不再逐个写附件行、不再更新邮箱行；“最后收信时间”改为查询时计算）
- [x] 测试：接收、各种拒收路径、大小写、`+tag`、Kelvin 符号、伪造邮件头（`test/isolation/email.test.ts`）、截断窗口、附件、并发限流、每用户与全站额度；本地端到端冒烟通过
- [x] 可调参数改为环境变量（`wrangler.jsonc#vars`，`worker/lib/config.ts` 校验并回退默认值）；注册开关、默认配额、保留天数由环境变量给默认值，管理员可在后台覆盖（migration `0004`）
- [x] 收信限流调整（Q13）：每邮箱每小时 10 封、每用户每小时 100 封，admin 不受这两项限制；全站每天 5000 封 / 12 MB（30 天 × 12 MB 放得进 500 MB 数据库）
- [x] 定时清理（Q14，从 Phase 5 提前）：默认保留 30 天，每天分批删除过期邮件，同时清理过期会话和旧计数
- ~~启用 R2~~：不做（Q12）

## Phase 4 · 收件箱与邮件渲染（P0）

> Phase 3 复审提前记下的注意事项：
> - `subject`、`from_name`、`from_address`、`snippet`、附件的文件名和类型都是攻击者可控的纯文本，只能用文本插值渲染，绝不能用 `v-html`（snippet 中可能出现解码后的 `<script>` 字面量）。
> - 所有 `html_body` 都要按恶意内容处理，包括来自纯文本邮件的（postal-mime 会把混合邮件和转发的 `message/rfc822` 转成 HTML）。`cid:` 引用要在消毒**之前**改写。
> - 以后提供附件下载时，**绝不能**用存储的 `content_type` 作为响应类型（`text/html` 附件会在本站域名下变成存储型 XSS）：一律 `Content-Disposition: attachment` + RFC 5987 编码的文件名 + `nosniff` + `application/octet-stream`。
> - From 头没有经过认证（见本节最后一项 P2）。

- [x] API：`GET /api/messages`（默认只含使用中地址的邮件；`mailbox`、`q`、`unread`、`code`、`since`、`cursor`、`limit`）、`GET /api/messages/:id`（只读，不改状态）、`PATCH`（已读/未读）、`DELETE`、`POST /api/messages/mark-read`、`GET /api/messages/summary`（轮询用）
- [x] 安全渲染（`src/lib/mail-html.ts` + `MailFrame.vue`）：DOMPurify 清洗 + srcdoc 自带 CSP + iframe sandbox（无 `allow-scripts`、无 `allow-same-origin`）；远程图片（含 CSS 背景）默认屏蔽，可对单封邮件“加载图片”；链接新标签页打开且不带来源；纯文本邮件自动识别链接
- [x] 首页：一键创建、最近验证码卡片（一键复制）、最新邮件、最近地址
- [x] 收件箱：未读蓝点加粗、按地址筛选（含已停用地址的历史）、搜索、全部已读、详情（桌面左右分栏，手机列表→详情）、验证码大号卡片、截断与附件信息
- [x] 页面可见时每 30 秒轮询 `summary`（带上已知的最新时间，无新邮件时服务端只读 1 行；每 5 分钟重算一次），有新邮件时按当前筛选条件增量拉取；侧栏未读角标（最多显示 99+）
- [x] 安全复审加固（D1 读写额度）：`CROSS JOIN` 固定查询顺序 + 查询计划回归测试；游标改为行值比较；未读数最多统计 100；搜索至少 2 个字符、只搜最近 2000 封；“全部已读”每次最多 500 封并限频；首页验证码只看 24 小时内（migration `0005`：验证码部分索引）；禁用 `<map>`/`<area>` 并在 iframe 中加 `<base target="_blank">`
- [x] 测试：功能 + 隔离（普通用户和 admin 都读不到别人的邮件）；生产构建下用 Chromium 实测恶意邮件：脚本、事件、`javascript:`、表单、iframe、svg 全部失效，点“加载图片”前追踪域名收不到任何请求
- [ ] （P2）发件人认证提示：入信时记录 SPF/DKIM/DMARC 结果，在界面上提示“发件人未通过验证”。原计划的“信封发件人与 From 域名不一致”方案误报太多（经 SendGrid、SES 等代发的正规邮件都会触发），已放弃；现在只在详情里如实显示“投递来源”

## Phase 5 · 管理后台与清理（P0/P1）

- [ ] `/api/admin/*`：用户列表（按状态筛选）、通过/拒绝/封禁/解封、单用户配额、系统设置（默认配额、保留天数、注册开关）（域名管理已在 Phase 2 完成）
- [ ] 统计：各状态用户数、邮箱数、邮件总数、近 7 天收信量（只返回聚合数字）
- [ ] 审计日志查看页（P1）
- [x] `scheduled` 清理任务已在 Phase 3 完成（`worker/jobs/cleanup.ts`）
- [ ] 管理员删除邮件的权力（Q14）：在后台修改保留天数、手动“立即清理 N 天前的邮件”、清空某个用户的全部邮件——都不需要也不允许查看邮件内容
- [ ] 删除用户账户（管理员操作，PRD §6 数据清理）：把该用户的地址写入 `retired_addresses`，级联删除 D1 数据，并清理 R2 前缀
- [ ] 测试：非管理员访问 `/api/admin/*` 返回 403；管理员接口不返回邮件内容；清理任务只删除过期邮件

## Phase 6 · 部署上线（P0）

一次性准备（在本机执行）：

1. 把代码推送到 GitHub 或 GitLab 仓库。
2. ~~运行 `npx wrangler d1 create postluma`，把 `database_id` 填入 `wrangler.jsonc`~~ ✅ 已完成（2026-10-19）。

控制台接入：

3. 进入 **Workers & Pages → Create → Import a repository**，选择仓库。
   - Project name：`postluma`（必须与 `wrangler.jsonc#name` 一致）
   - Build command：`npm run build`
   - Deploy command：`npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`
4. 在 Settings → Variables and Secrets 中添加 Secret：`ADMIN_INITIAL_PASSWORD`、`TURNSTILE_SECRET_KEY`；添加构建变量 `VITE_TURNSTILE_SITE_KEY`。
   - **别填反**：Site Key（24 位，公开，会打包进前端）→ 构建变量 `VITE_TURNSTILE_SITE_KEY`；Secret Key（35 位，保密）→ Worker Secret `TURNSTILE_SECRET_KEY`。填反时前端报 Turnstile 错误 `400020`，且 Secret 会被公开，必须在 Turnstile 控制台轮换。`vite.config.ts` 会拒绝构建长度像 Secret 的 Site Key。
   - Turnstile 组件的 Hostname 里要包含实际访问的域名（如 `postluma.<子域>.workers.dev`），否则报错 `110200`。**不要**设置 `TURNSTILE_DISABLED`（只用于本地开发）；缺少 Turnstile 密钥时，登录和注册会直接拒绝。
5. 对每个收信域名：进入 **Email → Email Routing** 启用路由，添加 **Catch-all → Send to a Worker → postluma**。
6. 以 admin 身份首次登录后，立即在“账户设置”中修改密码，再删除 Secret `ADMIN_INITIAL_PASSWORD`（admin 账户只会创建一次，之后不再需要它）。
7. 在后台添加相同的收信域名；（可选）为 Worker 绑定自定义域名作为访问入口。

调整参数：限流、额度、保留天数等都在 `wrangler.jsonc` 的 `vars` 中（每项有注释和允许范围）。修改后提交并推送，Workers Builds 会自动重新部署。**不要在 Cloudflare 控制台里改这些变量**，下次部署时会被文件中的值覆盖。数值超出范围时会自动回退到默认值，并在 Workers 日志中给出警告。

上线验证：

- [ ] `/api/health` 返回 `db: true`
- [ ] admin 登录 → 添加域名 → 注册测试用户 A 和 B → 审核通过 → A 创建邮箱 → 从外部邮箱发信 → A 能看到邮件和验证码，B 看不到
- [ ] 向不存在的地址和已停用的邮箱发信时，发件方收到退信

## 已知风险

- **Workers 免费版 CPU 限制（每请求 10 ms）**：已确认使用免费版，新密码的 PBKDF2 迭代次数降到 20,000（实测约 2.3 ms/次）。上线后如果出现错误 1102，继续调低；升级付费版后可调回 100,000（见 `docs/QUESTIONS.md` Q9）。
- **注册时会暴露用户名是否已存在**（409 `username_taken`）：这是开放注册的固有代价，已有按 IP 限流和 Turnstile 防护，接受此风险。
- **首屏体积**：主包约 468 KB（gzip 后 134 KB），主要来自 Naive UI。Phase 4 之后再按路由拆分。

## 本期不做

- 发信和回复（PRD 未要求）
- 实时推送（WebSocket / Durable Objects），先用轮询
- 全文检索（D1 FTS5）：邮件量增长后再加，归入 P2
- 日语等其他语言：保留扩展点，本期不翻译
