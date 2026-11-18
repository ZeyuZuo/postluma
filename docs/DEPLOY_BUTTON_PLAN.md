# 一键部署按钮与 README 重写：实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 仓库能被 Deploy to Cloudflare 按钮部署成可登录的站点，README 重写成适合宣传的样子。

**Architecture:** 部署要填的密钥只列在 `.dev.vars.example`（值留空），本地开发的默认值另放一个文件。Turnstile Site Key 由 Worker 在 `/api/settings/public` 下发，前端没有拿到时回退到旧的构建变量。README 中英文同步重写，截图在个人邮箱模式下用示例数据重拍。

**Tech Stack:** Cloudflare Workers + Hono、Vue 3、Vitest（workerd）、Playwright。

**Spec:** [DEPLOY_BUTTON_DESIGN.md](DEPLOY_BUTTON_DESIGN.md)

## Global Constraints

- Site Key 长度超过 30 位视为 Secret Key，绝不下发（与 `vite.config.ts` 的 `MAX_SITE_KEY_LENGTH` 相同）。
- `TURNSTILE_DISABLED=true` 时下发 `null`；它只出现在本地开发文件里，永远不进 `.dev.vars.example`。
- `.dev.vars.example` 只有 `ADMIN_INITIAL_PASSWORD`、`TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET_KEY` 三项，值为空。
- 作者现有的部署（只有构建变量 `VITE_TURNSTILE_SITE_KEY`）不改配置也能登录。
- README 不用 emoji，不用“强大”“轻松”“开箱即用”“一站式”；按钮链接 `https://deploy.workers.cloudflare.com/?url=https://github.com/ZeyuZuo/postluma`。
- 每个任务单独提交到本地分支 `feat/deploy-button`，不推送。

## Review Focus

1. Secret Key 被填进 `TURNSTILE_SITE_KEY`：不下发，登录失败而不是公开密钥（Task 2 单元测试）。
2. 只有旧构建变量的部署：登录页仍然显示 Turnstile（Task 2 第 6 步核对构建产物）。
3. 部署时漏填 `TURNSTILE_SITE_KEY`：登录页没有验证组件，登录被拒；README 和部署页说明要把三项都写成必填（Task 1、Task 4）。
4. README 的相对链接和截图路径失效（Task 6 脚本核对）。
5. 部署页面怎么处理空值，本地验证不了：推送后要实际点一次按钮（Task 6 交给你）。

---

### Task 1: 部署密钥模板

**Files:**
- Modify: `.dev.vars.example`、`.gitignore`、`package.json`、`vitest.config.ts`、`worker-configuration.d.ts`（生成）
- Create: `.dev.vars.local.example`
- Delete: `.env.example`

**Interfaces:**
- Produces: `Env.TURNSTILE_SITE_KEY: string`（由 `npm run cf-typegen` 生成）

- [x] **Step 1:** `.dev.vars.example` 改为三项空值，注释说明这是部署要填的密钥、按钮会逐项询问、本地开发用另一个文件。
- [x] **Step 2:** 新建 `.dev.vars.local.example`：`ADMIN_INITIAL_PASSWORD=change-me-locally`、`TURNSTILE_DISABLED=true`、`TURNSTILE_SITE_KEY=`、`TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA`、`MAIL_PROVIDER=log`、`RESEND_API_KEY=`；`.gitignore` 加 `!.dev.vars.local.example`；删除 `.env.example`。
- [x] **Step 3:** `cf-typegen` 改为 `wrangler types --env-file .dev.vars.example --env-file .dev.vars.local.example --strict-vars=false`，运行后 `git diff worker-configuration.d.ts` 只应多出 `TURNSTILE_SITE_KEY` 和改动的生成命令/哈希。
- [x] **Step 4:** `package.json` 加 `description` 和 `cloudflare.bindings` 里三项的中英文说明（Turnstile 链接到 `https://dash.cloudflare.com/?to=/:account/turnstile`）；`vitest.config.ts` 的 bindings 加 `TURNSTILE_SITE_KEY: ''`。
- [x] **Step 5:** `npm run type-check` 和 `npm test` 通过。
- [x] **Step 6:** 提交 `chore(deploy): list only deployment secrets in .dev.vars.example`。

### Task 2: 运行时下发 Site Key

**Files:**
- Modify: `worker/lib/turnstile.ts`、`worker/app.ts`、`shared/api.ts`、`src/stores/mode.ts`、`src/lib/turnstile.ts`、`src/components/TurnstileWidget.vue`、`src/views/auth/LoginView.vue`、`src/views/auth/RegisterView.vue`
- Test: `test/health.test.ts`、`test/personal-mode.test.ts`、`e2e/flows.spec.ts`

**Interfaces:**
- Consumes: `Env.TURNSTILE_SITE_KEY`（Task 1）
- Produces: `turnstileSiteKey(env: Env): string | null`（worker）；`PublicSettings.turnstileSiteKey: string | null`；前端 `turnstileSiteKey(): string` 与 `turnstileEnabled(): boolean`（`src/lib/turnstile.ts`，改为函数）

- [x] **Step 1: 写失败的测试**（`test/health.test.ts` 的 `GET /api/settings/public`）

```ts
const on = { TURNSTILE_DISABLED: 'false' }
it('publishes the Turnstile site key', async () => {
  const res = await api('/api/settings/public', { env: { ...on, TURNSTILE_SITE_KEY: ' 1x00000000000000000000AA ' } })
  expect(await json(res)).toMatchObject({ turnstileSiteKey: '1x00000000000000000000AA' })
})
it('publishes no key when Turnstile is off or the key is missing', async () => {
  expect(await json(await api('/api/settings/public', { env: { TURNSTILE_SITE_KEY: '1x00000000000000000000AA' } }))).toMatchObject({ turnstileSiteKey: null })
  expect(await json(await api('/api/settings/public', { env: on }))).toMatchObject({ turnstileSiteKey: null })
})
it('never publishes a key as long as a secret key', async () => {
  const res = await api('/api/settings/public', { env: { ...on, TURNSTILE_SITE_KEY: '1x0000000000000000000000000000000AA' } })
  expect(await json(res)).toMatchObject({ turnstileSiteKey: null })
})
```

`test/personal-mode.test.ts` 第 24 行的 `toEqual` 加上 `turnstileSiteKey: null`。

- [x] **Step 2:** `npx vitest run test/health.test.ts`，新测试失败（没有 `turnstileSiteKey`）。
- [x] **Step 3:** `worker/lib/turnstile.ts` 实现 `turnstileSiteKey(env)`：关闭时 `null`；去掉首尾空白后为空时 `null`；超过 30 位时 `console.error` 并返回 `null`。`/api/settings/public` 和 `PublicSettings` 加上 `turnstileSiteKey`。
- [x] **Step 4:** 测试通过。
- [x] **Step 5:** 前端：`src/stores/mode.ts` 从同一个公开设置里记下 Site Key；`src/lib/turnstile.ts` 的 `turnstileSiteKey()` 返回下发的值，否则返回 `import.meta.env.VITE_TURNSTILE_SITE_KEY ?? ''`；三个组件改用函数。e2e 加一条：拦截 `/api/settings/public` 加上 Site Key、拦截 `challenges.cloudflare.com`，登录页出现 `.turnstile` 且登录按钮不可点。
- [x] **Step 6:** `npm run type-check`、`npm test`、`npx playwright test e2e/flows.spec.ts --project=temporary` 通过；`VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA npx vite build` 后，构建产物里能找到这个 Key（回退仍在）。
- [x] **Step 7:** 提交 `feat(auth): serve the Turnstile site key at runtime`。

### Task 3: 重拍截图

**Files:**
- Modify: `docs/screenshots/{home,inbox,dark,mobile}.png`
- Create: `docs/screenshots/en/{home,inbox,dark,mobile}.png`
- 脚本放在会话的临时目录，不进仓库。

- [x] **Step 1:** 按 e2e 的方式起个人模式开发服务器（`POSTLUMA_E2E=1 POSTLUMA_E2E_MODE=personal`，独立端口），用 SQL 建 `admin` 账号和域名 `example.com`（打开 catch-all 和发信），通过 API 建地址和备注，通过 `/cdn-cgi/handler/email` 投递示例邮件（验证码、验证链接、带附件、中文、周报），用 SQL 调整收信时间，收藏一封。
- [x] **Step 2:** Playwright 截图：桌面 1360×900 首页、收件箱（打开一封邮件）、暗色；手机 390×844 首页。中文、英文各一套。
- [x] **Step 3:** 逐张查看：没有真实个人信息，没有报错和加载中的状态。
- [x] **Step 4:** 提交 `docs(readme): new screenshots in personal mode`。

### Task 4: 重写 README

**Files:**
- Modify: `README.md`、`README.en.md`

- [x] **Step 1:** 核对 cloud-mail、cloudflare_temp_email 的 README（只写能在它们 README 里找到的功能），核对 Turnstile 组件的主机名规则。
- [x] **Step 2:** 按设计第 5 节的结构和写法重写 `README.md`；部署部分先列按钮做不了的准备（域名在 Cloudflare、开通 R2、建 Turnstile 组件），再是按钮，然后是部署后的步骤（Email Routing、登录改密码、删除 `ADMIN_INITIAL_PASSWORD`、添加域名），手动部署和配置表放进 `<details>`。
- [x] **Step 3:** `README.en.md` 同步，英文截图用 `docs/screenshots/en/`。
- [x] **Step 4:** 提交 `docs(readme): rewrite for newcomers, with a Deploy to Cloudflare button`。

### Task 5: 开发文档

**Files:**
- Modify: `CLAUDE.md`、`docs/DEV_PLAN.md`、`docs/DEPLOY_BUTTON_DESIGN.md`

- [x] **Step 1:** `CLAUDE.md`：两个密钥模板各自的用途和“不要把开发开关放进 `.dev.vars.example`”；Secrets 一节加 `TURNSTILE_SITE_KEY`；安全不变量里写明 Site Key 由 `/api/settings/public` 下发、超长不下发、旧构建变量仍可用。
- [x] **Step 2:** `DEV_PLAN.md`：Phase 6 的部署步骤改成新的 Site Key 用法；新增一节记录本次改动并打勾。设计文档状态改为已完成。
- [x] **Step 3:** 提交 `docs: deploy button conventions and plan status`。

### Task 6: 全量验证

- [x] **Step 1:** `npm test`、`npm run type-check`、`npm run build`、`npm run test:e2e` 全部通过。
- [x] **Step 2:** 脚本检查两份 README 里的相对链接和图片路径都存在。
- [x] **Step 3:** 告诉你：按钮要等合并到 GitHub 的 main 后才生效，生效后用一个测试账号实际点一次。
