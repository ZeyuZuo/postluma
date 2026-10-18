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

## Phase 2 · 邮箱管理（P0）

- [ ] 邮箱 repo：所有函数的第一个参数都是 `userId`
- [ ] 随机前缀生成（易读字符集）；自定义前缀规则：小写字母、数字及 `.`、`-`、`_`，长度 3–32，不允许 `+`，保留词黑名单
- [ ] 创建邮箱时依次校验：域名已启用 → 地址不在 `mailboxes` 和 `retired_addresses` 中 → 使用中的邮箱数未超出配额
- [ ] API：`GET/POST /api/mailboxes?status=active|disabled&q=`、`PATCH /api/mailboxes/:id`（备注、停用/启用；启用时重新检查配额）、`GET /api/domains`（只返回已启用的域名）；**不提供 DELETE**
- [ ] 前端“邮箱”页：域名选择器 + 一键生成并自动复制 + 自定义前缀、备注、搜索、停用
- [ ] 前端“已停用邮箱”页：列表、查看历史邮件、重新启用（超出配额时提示）
- [ ] 隔离测试：无法读取或修改他人邮箱；已存在或已退役的地址无法被任何用户再次创建；停用不占配额，启用超额时被拒绝

## Phase 3 · 邮件接收 Email Worker（P0）

- [ ] `email` handler：小写地址精确匹配邮箱；邮箱不存在、已停用，或所属用户非 active 时调用 `setReject()`
- [ ] 用 postal-mime 解析，生成 snippet；正文超过阈值时截断（启用 R2 时转存）
- [ ] 验证码提取 `worker/lib/otp.ts`：匹配中英文关键词附近的 4–8 位数字或字母数字组合，排除年份和电话号码；配套表驱动测试（需覆盖中、英、日样例）
- [ ] 写入 `messages`，`user_id` 取自邮箱记录；更新 `last_received_at`
- [ ] （P1）启用 R2：存储原始 .eml 和附件；附件下载 API 走 repo 层的归属校验
- [ ] 测试：拒收和接收两条路径；邮件头里伪造的地址不影响邮件归属

## Phase 4 · 收件箱与邮件渲染（P0）

- [ ] API：`GET /api/messages?mailbox=&q=&cursor=`（默认只返回使用中邮箱的邮件）、`GET /api/messages/:id`（读取时标记已读）、`PATCH`（已读/未读）、`DELETE`
- [ ] 安全渲染组件 `MailBody.vue`：sandbox iframe（不加 `allow-scripts` 和 `allow-same-origin`）+ `srcdoc` 中注入 CSP + DOMPurify；远程图片可对单封邮件手动“加载图片”
- [ ] 首页：一键创建邮箱、最新邮件、最近验证码卡片（一键复制）
- [ ] 收件箱：邮件列表（未读加粗）、按邮箱筛选、搜索、详情面板（桌面端左右分栏，移动端上下堆叠）、验证码高亮
- [ ] （P1）列表每 10–15 秒轮询刷新
- [ ] 隔离测试 + 渲染测试（`<script>`、事件属性、远程跟踪像素都不会执行或发起请求）

## Phase 5 · 管理后台与清理（P0/P1）

- [ ] `/api/admin/*`：用户列表（按状态筛选）、通过/拒绝/封禁/解封、单用户配额、域名增删和启停、系统设置（默认配额、保留天数、注册开关）
- [ ] 统计：各状态用户数、邮箱数、邮件总数、近 7 天收信量（只返回聚合数字）
- [ ] 审计日志查看页（P1）
- [ ] `scheduled`：分批删除超过 `retention_days` 的邮件及其 R2 对象；清理过期 session
- [ ] 删除用户账户（管理员操作，PRD §6 数据清理）：把该用户的地址写入 `retired_addresses`，级联删除 D1 数据，并清理 R2 前缀
- [ ] 测试：非管理员访问 `/api/admin/*` 返回 403；管理员接口不返回邮件内容；清理任务只删除过期邮件

## Phase 6 · 部署上线（P0）

一次性准备（在本机执行）：

1. 把代码推送到 GitHub 或 GitLab 仓库。
2. 运行 `npx wrangler d1 create postluma`，把输出的 `database_id` 填入 `wrangler.jsonc` 并提交。

控制台接入：

3. 进入 **Workers & Pages → Create → Import a repository**，选择仓库。
   - Project name：`postluma`（必须与 `wrangler.jsonc#name` 一致）
   - Build command：`npm run build`
   - Deploy command：`npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`
4. 在 Settings → Variables and Secrets 中添加 Secret：`ADMIN_INITIAL_PASSWORD`、`TURNSTILE_SECRET_KEY`；添加构建变量 `VITE_TURNSTILE_SITE_KEY`。**不要**设置 `TURNSTILE_DISABLED`（只用于本地开发）；缺少 Turnstile 密钥时，登录和注册会直接拒绝。
5. 对每个收信域名：进入 **Email → Email Routing** 启用路由，添加 **Catch-all → Send to a Worker → postluma**。
6. 以 admin 身份首次登录后，立即在“账户设置”中修改密码，再删除 Secret `ADMIN_INITIAL_PASSWORD`（admin 账户只会创建一次，之后不再需要它）。
7. 在后台添加相同的收信域名；（可选）为 Worker 绑定自定义域名作为访问入口。

上线验证：

- [ ] `/api/health` 返回 `db: true`
- [ ] admin 登录 → 添加域名 → 注册测试用户 A 和 B → 审核通过 → A 创建邮箱 → 从外部邮箱发信 → A 能看到邮件和验证码，B 看不到
- [ ] 向不存在的地址和已停用的邮箱发信时，发件方收到退信

## 已知风险

- **Workers 免费版 CPU 限制（每请求 10 ms）**：PBKDF2 100k 次迭代约需几十毫秒 CPU，登录和注册在免费版上可能超出限制。上线前需要实测；若超限，可改用付费版（每请求默认 30 s CPU），或降低迭代次数（哈希串中记录了迭代次数，旧密码可平滑迁移）。
- **注册时会暴露用户名是否已存在**（409 `username_taken`）：这是开放注册的固有代价，已有按 IP 限流和 Turnstile 防护，接受此风险。
- **首屏体积**：主包约 468 KB（gzip 后 134 KB），主要来自 Naive UI。Phase 4 之后再按路由拆分。

## 本期不做

- 发信和回复（PRD 未要求）
- 实时推送（WebSocket / Durable Objects），先用轮询
- 全文检索（D1 FTS5）：邮件量增长后再加，归入 P2
- 日语等其他语言：保留扩展点，本期不翻译
