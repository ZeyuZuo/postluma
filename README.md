<p align="center">
  <img src="public/favicon.svg" width="56" alt="">
</p>

<h1 align="center">PostLuma</h1>

<p align="center">
  部署在 Cloudflare 上的多用户临时邮箱：生成地址 → 收验证码 → 一键复制。<br>
  Workers + Email Routing + D1（+ 可选 R2），免费版即可运行，不需要服务器。
</p>

<p align="center"><b>简体中文</b> · <a href="README.en.md">English</a></p>

---

| 首页：当前地址、最新验证码和所有地址 | 收件箱：一行一封，详情从右侧滑出 |
|---|---|
| ![首页](docs/screenshots/home.png) | ![收件箱](docs/screenshots/inbox.png) |
| **暗色主题** | **手机** |
| ![暗色主题](docs/screenshots/dark.png) | <img src="docs/screenshots/mobile.png" width="260" alt="手机"> |

## 这是什么

PostLuma 是给自己和信任的人用的私人临时邮箱。主要用途是注册网站、接收验证码：在首页点“随机新地址”，随机地址立即生成并复制到剪贴板，同时成为“当前地址”；网站发来的邮件会直接出现在它下面，验证码会被自动识别并用黄色突出，点一下即可复制，整个过程不用切换页面。

它和其他基于 Cloudflare 的邮箱项目最大的不同，是把**多用户之间的隔离**当作首要目标：每个用户只能看到自己的邮件，管理员也看不到邮件内容；一个地址一旦分配出去，就永远不会再给别人。

## 功能

**收信与验证码**
- 一键生成随机地址，或输入自定义地址；新地址自动复制并成为“当前地址”
- 当前地址由你决定：新建、复制或在列表里点选的地址就是当前地址，刷新后仍会记住；右侧列表显示每个地址的备注，有未读邮件的地址带绿点
- 在首页点开邮件直接弹窗阅读，不用跳转到收件箱
- 新地址生成后的 10 分钟内每 10 秒检查一次新邮件，其余时间每 30 秒，邮件无需刷新即可出现
- 自动识别验证码（中、英、日关键词；排除年份、金额、电话、订单号等误报），一键复制；复制后邮件自动标为已读，黄色高亮只留给还没复制的验证码
- 自动识别验证链接（“验证邮箱”“确认”“登录”等按钮或链接，只认 https），一键在新标签页打开；打开后同样标为已读
- 发件人认证提示（可选）：根据 Cloudflare 收信时的 SPF / DKIM / DMARC 结果，在邮件详情里标出“已验证”或“发件人可疑”；默认关闭，见 `SENDER_AUTH_HINTS`
- 每个地址可单独开启 `+别名`：发到 `name+shop@域名` 的邮件也会进入 `name@域名`，不占用地址配额
- 支持多个收信域名，由管理员在后台维护

**阅读邮件**
- HTML 邮件经过三层防护：DOMPurify 过滤、邮件页面自带 CSP、iframe 沙箱（不允许脚本）；远程图片默认拦截，防止追踪
- 原始邮件保存在 R2（可选）：可以下载附件、显示内嵌图片、查看超出解析范围的完整正文、下载 `.eml`
- 收件箱支持全部 / 未读 / 验证码筛选、按地址筛选、搜索，以及键盘操作（`j` / `k` 切换，`/` 搜索，`Esc` 关闭）

**发信（可选，默认关闭）**
- 管理员打开总开关后，再逐个允许域名和用户；被允许的用户可以用自己的地址回复邮件或写新邮件
- 只发纯文本，每封最多 5 个收件人，每人每天 20 封、全站每天 100 封（都可调）；回复自动带上会话头，对方看到的是同一个会话
- 通过 Resend 发送（免费版每天 100 封）；关闭时界面上看不到任何发信功能

**多用户与管理**
- 开放注册 + 管理员审核（可关闭注册）；通过、拒绝、封禁、解封，封禁立即生效
- 每个用户的地址配额、总数上限、每日新建上限
- 管理后台：用户、收信域名（自动检查 MX 是否指向 Cloudflare Email Routing）、系统设置、使用统计、操作记录
- 邮件保留期（默认 30 天）和定时清理；所有批量删除共用每日额度，不会耗尽免费版写入次数

**界面**
- Vue 3 + Naive UI，桌面使用顶部导航，手机使用底部标签栏
- 亮色 / 暗色主题；简体中文 / English，新增语言只需加一个语言文件

## 安全模型

- **租户隔离**：所有邮箱、邮件查询都在 SQL 里带 `user_id`；访问别人的资源返回 404（和不存在一样），无法通过 ID 探测。每个接口都有“用户 B 访问用户 A 的资源”的测试。
- **收信只认信封收件人**：邮件归属只由收件地址精确匹配的地址记录决定，不信任任何邮件头；不做模糊匹配。
- **地址永不复用**：地址只能停用、不能删除；删除用户时，他的地址进入永久保留表，避免新主人收到前主人的验证码和重置密码邮件。
- **管理员看不到邮件**：管理接口只返回聚合数字，不返回邮件内容或用户的地址。
- **认证**：PBKDF2 密码哈希、HttpOnly Cookie + 数据库 Session（可随时作废）、登录和注册使用 Turnstile + 按 IP 限流、写请求校验同源 `Origin`。
- **附件下载**：一律以 `application/octet-stream` 下载，不在本站域名下渲染任何邮件内容。

## 不做什么

- **不开放发信**。发信默认关闭，只有管理员逐个允许的用户才能发，并且有每日额度，避免域名被滥用、信誉受损（收信也会受影响）。
- **不删除地址**。停用的地址仍可查看历史邮件，也可以重新启用；旧邮件由保留期自动清理。
- **管理员不能查看用户邮件**。这是产品决定，不是待办事项。

## 架构

```
                    ┌─────────────────────── 一个 Worker ───────────────────────┐
 浏览器 ──HTTPS──▶  │ 静态资源（Vue SPA）                                        │
                    │ fetch     → Hono API  /api/*   ──▶ D1（用户、地址、邮件）  │
 发件方 ──SMTP──▶   │ email     → 收信流水线           ──▶ R2（原始 .eml，可选） │
 Email Routing      │ scheduled → 定时清理（保留期、过期会话）                   │
                    └────────────────────────────────────────────────────────────┘
```

- 收信时只解析邮件的前 256 KB（免费版每次调用只有 10 ms CPU），解析结果写入 D1，用于列表、搜索和验证码；完整原件同时流式写入 R2，Worker 不解码附件，由浏览器按需解析。
- 每封邮件约 7 次 D1 行写入；所有按请求或轮询执行的查询都走索引，并有查询计划回归测试。
- 项目按 Cloudflare **Free 计划**的限额设计（每次调用 10 ms CPU、D1 每天约 10 万行写入、单库 500 MB、R2 10 GB）；收信量、删除量、保留天数都有可调上限。具体额度以 Cloudflare 当前文档为准。

## 部署

**前置条件**：Cloudflare 账号；收信域名托管在 Cloudflare（Email Routing 的要求）；Node.js `^22.18` 或 `>=24.12`。

1. **获取代码并安装依赖**

   ```bash
   git clone https://github.com/ZeyuZuo/postluma.git && cd postluma
   npm install
   ```

2. **创建 D1 数据库**，把输出的 `database_id` 填进 `wrangler.jsonc`（替换文件里现有的值）：

   ```bash
   npx wrangler d1 create postluma
   ```

3. **（可选）创建 R2 存储桶**，用于保存原始邮件和附件。开通 R2 需要在 Cloudflare 账户里绑定付款方式，免费额度内不扣费。不需要的话，删掉 `wrangler.jsonc` 里的 `r2_buckets` 即可，系统会只保存解析后的内容。

   ```bash
   npx wrangler r2 bucket create postluma-mail
   ```

4. **创建 Turnstile 组件**（Cloudflare 控制台 → Turnstile），主机名填你的访问域名。
   - Site Key（公开）→ 构建变量 `VITE_TURNSTILE_SITE_KEY`
   - Secret Key（保密）→ Worker Secret `TURNSTILE_SECRET_KEY`
   - 不要填反：构建时如果 Site Key 长得像 Secret Key，会直接报错。

5. **部署**，二选一：
   - **Workers Builds（推荐）**：控制台 → Workers & Pages → Create → Import a repository。项目名填 `postluma`（与 `wrangler.jsonc#name` 一致）；Build command 填 `npm run build`；Deploy command 填 `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`；在构建变量里添加 `VITE_TURNSTILE_SITE_KEY`。之后每次推送都会自动部署。
   - **本地部署**：把 `VITE_TURNSTILE_SITE_KEY` 写入 `.env.production.local`，然后执行 `npm run deploy`。

   然后设置 Secret：

   ```bash
   npx wrangler secret put ADMIN_INITIAL_PASSWORD
   npx wrangler secret put TURNSTILE_SECRET_KEY
   ```

6. **配置收信**：对每个收信域名，进入 Email → Email Routing 启用路由，添加 **Catch-all → Send to a Worker → postluma**。Catch-all 只负责转发，是否接收由 PostLuma 判断：不存在或已停用的地址会被退信。

7. **首次登录**：用户名 `admin`，密码为 `ADMIN_INITIAL_PASSWORD`。登录后立即修改密码，然后删除这个 Secret（管理员账号只会初始化一次）。在后台“收信域名”中添加第 6 步配置过的域名，之后就可以审核用户注册了。

8. **（可选）开启发信**：在 [Resend](https://resend.com) 添加并验证你的发信域名（按提示在 Cloudflare DNS 里加 DKIM / SPF 记录，通常在 `send.` 子域，不影响收信的 MX），创建 API Key 后执行 `npx wrangler secret put RESEND_API_KEY`。然后在后台：系统设置 → 发信 打开总开关并发一封测试信；收信域名 → 打开“可发信”；用户 → 逐个允许发信。

## 配置

可调参数都在 `wrangler.jsonc` 的 `vars` 中，每一项都有注释和允许范围；超出范围会回退到默认值并在日志中警告。请修改文件后重新部署：在控制台里修改的值会在下次部署时被覆盖。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `REGISTRATION_OPEN` | `true` | 是否开放注册（管理员可在后台覆盖） |
| `DEFAULT_MAILBOX_QUOTA` | `10` | 每个用户同时使用中的地址数（可在后台按用户调整） |
| `MAX_TOTAL_MAILBOXES` / `MAX_DAILY_MAILBOX_CREATIONS` | `100` / `30` | 地址总数（含已停用）和 24 小时新建上限 |
| `INGEST_MAX_PER_MAILBOX_PER_HOUR` / `INGEST_MAX_PER_USER_PER_HOUR` | `10` / `100` | 防刷信限流（管理员不受限） |
| `INGEST_MAX_MESSAGES_PER_DAY` / `INGEST_MAX_MB_PER_DAY` | `5000` / `12` | 全站每日收信额度 |
| `RAW_MAIL_MAX_MB_PER_DAY` | `250` | 每天写入 R2 的原始邮件上限，`0` 表示不保存原件 |
| `MESSAGE_RETENTION_DAYS` | `30` | 邮件保留天数（管理员可覆盖，受存储容量限制） |
| `MAX_DELETES_PER_DAY` | `5000` | 定时清理与批量删除共用的每日额度 |
| `SENDER_AUTH_HINTS` | `false` | 显示发件人认证结果；先确认真实来信最上面的 ARC 头来自 `mx.cloudflare.net` 再开启 |
| `PASSWORD_PBKDF2_ITERATIONS` | `20000` | 免费版 CPU 限制下的取舍；升级付费版后可调高 |
| `SENDING_ENABLED` | `false` | 发信总开关的默认值（管理员可在后台覆盖） |
| `MAIL_PROVIDER` | `resend` | 发信服务商；`log` 只记录不发送，用于本地开发 |
| `SEND_MAX_PER_USER_PER_DAY` / `SEND_MAX_PER_DAY` | `20` / `100` | 每人 / 全站每 24 小时发信上限 |
| `SEND_MAX_RECIPIENTS` | `5` | 每封邮件的收件人上限 |

## 本地开发

```bash
cp .dev.vars.example .dev.vars          # 本地密钥（默认关闭 Turnstile）
npm run db:migrate:local                # 初始化本地 D1
npm run dev                             # Vite + workerd，前端、API、收信在同一个服务里
```

模拟收信（`+` 需写成 `%2B`）：

```bash
curl -X POST --data-binary @mail.eml \
  "http://localhost:5173/cdn-cgi/handler/email?from=a@example.org&to=name@your.domain"
```

## 测试

```bash
npm test             # Vitest，运行在 workerd 中：接口、收信、跨用户隔离矩阵、查询计划
npm run test:e2e     # Playwright：恶意 HTML 渲染、主要操作流程、手机宽度布局
npm run type-check
```

浏览器测试使用独立的临时数据（`.wrangler/e2e`），不会影响本地开发数据；首次运行前执行 `npx playwright install chromium`。

## 目录结构

```
worker/        Cloudflare Worker：API 路由、收信、定时任务、所有 SQL（repo/）
src/           Vue 3 前端
shared/        前后端共用的类型、校验和错误码
migrations/    D1 数据库迁移
test/          Vitest（workerd）测试，跨用户隔离测试在 test/isolation/
e2e/           Playwright 浏览器测试
docs/          产品需求、开发计划、决策记录
```

## 文档

- [产品需求（PRD）](docs/PRD.md)
- [开发计划与路线图](docs/DEV_PLAN.md)
- [待确认问题与决策记录](docs/QUESTIONS.md)
- [代码约定与架构说明](CLAUDE.md)（面向开发者）

## 常见问题

- **`npm install` 提示 workerd / esbuild 的安装脚本被阻止**：npm 12 默认阻止安装脚本。执行 `npm install-scripts approve workerd esbuild && npm rebuild workerd esbuild`。
- **本地查询报 `no such table`**：修改 `database_id` 后需要重新执行 `npm run db:migrate:local`。
- **登录报错 1102（CPU 超限）**：调低 `PASSWORD_PBKDF2_ITERATIONS`。
- **发到某个地址的邮件被退信**：确认地址处于“使用中”、所属用户已通过审核、域名已配置 Catch-all。
