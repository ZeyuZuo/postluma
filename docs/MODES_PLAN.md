# 部署模式实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 部署时用 `SERVICE_MODE` 选择"个人邮箱"或"临时邮箱"。个人模式只有管理员，并新增收藏和 catch-all；临时模式去掉发信。

**Architecture:** 模式是部署变量，只经 `getConfig(env).mode` 读取。后端只在几个入口判断模式：登录与会话、注册开关、收信、发信开关、收藏和 catch-all 的路由。前端只有一个 mode 状态，来自 `/api/settings/public`。两个新功能各用一个只追加的迁移；所有上限都放进条件 INSERT/UPDATE 里检查。

**Tech Stack:** Cloudflare Workers + Hono + D1（+ R2）、Vue 3 + Naive UI + vue-i18n、zod、Vitest（workerd）、Playwright。

**Spec:** [docs/MODES_DESIGN.md](MODES_DESIGN.md)（下文"设计 §5 #3"指设计文档第 5 节第 3 条）

## Global Constraints

- `SERVICE_MODE` 只取 `personal` / `temporary`；未设置或无效时按 `temporary`，并 `warnOnce`。
- 新部署变量的默认值：`MAX_STARRED_MESSAGES=500`、`CATCH_ALL_MAX_PER_DAY=10`、`CATCH_ALL_MAX_PER_ADDRESS_PER_HOUR=10`。后两个可以在后台"系统设置"里覆盖。
- 自动建的地址合计每天最多用掉全站每日收信额度的一半，条数（`INGEST_MAX_MESSAGES_PER_DAY`）和字节（`INGEST_MAX_MB_PER_DAY`）分别计算。
- catch-all 拒绝建地址时，退信理由一律用 `REJECT_UNAVAILABLE`（`Mailbox unavailable`）。
- 个人模式手动建地址：1–32 位，符合 `LOCAL_PART_PATTERN`，可以用保留前缀；catch-all 和临时模式仍是 3–32 位，不能用保留前缀。任何情况下地址都不能含 `+`。
- 临时模式下，发信、收藏、catch-all 的接口都返回 404 `not_found`。`/api/outbox/status` 例外，照常返回"不能发信"。
- 迁移只追加：`0012_starred.sql`、`0013_catch_all.sql`。不改已应用的迁移。
- 每封信仍约 7 次 D1 写入。按请求或轮询执行的新查询都要走索引，并加进 `test/query-plans.test.ts`。
- 新增的变量要写进 `INT_VARS`/`getConfig`，在 `wrangler.jsonc` 里带注释，然后运行 `npm run cf-typegen`。
- 界面文案只放在 `src/locales/{zh-CN,en}.ts`，两份同步。文案里不能出现 `@ { } |`（vue-i18n 的语法字符）。
- 每个新接口都要有跨用户测试：B 拿不到、也改不了 A 的东西，返回 404。
- 每个任务结束时提交一次（Conventional Commits）。提交前运行 `npm test`、`npm run type-check`、`npm run build`；界面任务还要跑 `npm run test:e2e`，并用桌面和 390 px 截图核对。只在本地提交，推送前先问。

## Review Focus

1. **垃圾邮件短时间打到大量随机地址**：先撞上每日建地址上限和"一半额度"，发到手动建的地址的信照常收下。→ Task 8 `catch-all spam burst leaves room for manual addresses`
2. **切到个人模式时已经登录的非管理员**：下一次请求返回 401 并清掉 cookie，发给他们地址的信被退回。→ Task 2
3. **catch-all 域名上大小写不同或带 `+` 的收件人**：`Shop@D` 建成 `shop@d`；没有 `shop@d` 时，`shop+x@d` 退信且不建地址。→ Task 8
4. **收藏上限附近的并发**：上限只剩 1 个名额时同时收藏两封，恰好成功一封。→ Task 6
5. **新控件在 390 px 下溢出**：星标列、catch-all 开关、"自动创建"标签。→ Task 7、Task 9 的 e2e

---

## 开始前

- [ ] 新建分支：`git switch -c feat/service-modes`（不直接提交到 main）。
- [ ] 提交设计和计划：`git add docs/MODES_DESIGN.md docs/MODES_PLAN.md && git commit -m "docs(modes): design and implementation plan"`
- [ ] e2e 需要浏览器：`npx playwright install chromium`

## 设计步骤与任务的对应

| 设计 §8 | 任务 |
|---|---|
| 1 模式配置 | Task 1 |
| 2 个人模式 = 只有管理员 | Task 2、3、4（Task 4 结束时，仓库配置切到 `personal`） |
| 3 临时模式去掉发信 | Task 5 |
| 4 收藏 | Task 6、7 |
| 5 catch-all | Task 8、9 |
| 6 文档 | Task 10 |

> 与设计 §5 #2 的差别：仓库配置在 Task 4 就切到 `personal`，不再等到最后一步。原因：Task 5 之后临时模式没有发信；如果那时文件里还是 `temporary`，中途推送会让你的部署丢掉发信。个人模式的核心在 Task 2–4 已经完整，之后的收藏和 catch-all 都是新增功能，提前切换没有风险。

---

### Task 1: 模式配置（不改行为）

**Files:**
- Modify: `shared/api.ts`（`PublicSettings`，新增模式类型）
- Modify: `worker/lib/config.ts`
- Modify: `wrangler.jsonc`、`worker-configuration.d.ts`（`npm run cf-typegen` 生成）
- Modify: `vitest.config.ts`
- Modify: `worker/app.ts`（`/settings/public`）
- Create: `src/stores/mode.ts`
- Modify: `src/router/index.ts`
- Test: `test/config.test.ts`、`test/health.test.ts`

**Interfaces:**
- Produces:
  - `shared/api.ts`：`export const SERVICE_MODES = ['personal', 'temporary'] as const`，`export type ServiceMode`，`PublicSettings { registrationOpen: boolean; mode: ServiceMode }`
  - `AppConfig.mode: ServiceMode`
  - `src/stores/mode.ts`：`loadServiceMode(): Promise<ServiceMode>`（只请求一次并缓存；请求失败时按 `temporary`）、`isPersonal(): boolean`

- [ ] **Step 1: 写失败的测试**

```ts
// test/config.test.ts
it('defaults SERVICE_MODE to temporary', () => {
  expect(getConfig({ ...env, SERVICE_MODE: '' } as Env).mode).toBe('temporary')
})
it('reads SERVICE_MODE=personal', () => {
  expect(getConfig({ ...env, SERVICE_MODE: 'personal' } as Env).mode).toBe('personal')
})
it('falls back to temporary on an invalid SERVICE_MODE', () => {
  expect(getConfig({ ...env, SERVICE_MODE: 'Personal' } as Env).mode).toBe('temporary')
})
// test/health.test.ts
it('public settings report the service mode', async () => {
  expect(await json(await api('/api/settings/public'))).toMatchObject({ mode: 'temporary' })
  expect(await json(await api('/api/settings/public', { env: { SERVICE_MODE: 'personal' } }))).toMatchObject({ mode: 'personal' })
})
```

- [ ] **Step 2:** 运行 `npx vitest run test/config.test.ts test/health.test.ts`。预期：4 个新测试失败。
- [ ] **Step 3: 实现**
  - `config.ts`：新增 `readMode(env)`，写法参照 `readProvider`。
  - `wrangler.jsonc#vars`：加 `"SERVICE_MODE": "temporary"`，注释写明取值和设计文档的链接。然后运行 `npm run cf-typegen`。
  - `vitest.config.ts`：在 `miniflare.bindings` 里固定 `SERVICE_MODE: 'temporary'`，注释说明个人模式的测试要单独覆盖这个变量。
  - `app.ts`：`/settings/public` 返回 `mode`。
  - `router/index.ts`：`beforeEach` 一开始先 `await loadServiceMode()`。
- [ ] **Step 4:** 运行 `npm test && npm run type-check && npm run build`。预期：全部通过。
- [ ] **Step 5: 提交** `feat(modes): SERVICE_MODE setting, read everywhere through getConfig (no behaviour yet)`

### Task 2: 个人模式只允许管理员（后端）

**Files:**
- Modify: `shared/api.ts`（`ERROR_CODES` 加 `'admin_only'`）
- Modify: `worker/lib/config.ts`（`AppConfig.ingest.adminOwnersOnly`）
- Modify: `worker/repo/settings.ts`、`worker/middleware/auth.ts`、`worker/routes/auth.ts`、`worker/repo/ingest.ts`、`worker/email.ts`
- Modify: `src/locales/{zh-CN,en}.ts`（`errors.admin_only`：中文"这个站点是个人邮箱，只有管理员能登录"，英文 "This is a personal mailbox. Only the administrator can sign in."）
- Test: `test/personal-mode.test.ts`（新建）

**Interfaces:**
- Consumes: `AppConfig.mode`（Task 1）
- Produces:
  - `AppConfig.ingest.adminOwnersOnly: boolean`（等于 `mode === 'personal'`）
  - `IngestLimits.adminOwnersOnly: boolean`
  - `findDeliveryTarget(db, recipient, opts: Pick<IngestLimits, 'adminOwnersOnly'>)`

- [ ] **Step 1: 写失败的测试**（`const personal = { SERVICE_MODE: 'personal' }`）

```ts
it('registration is closed in personal mode, whatever the setting says', async () => {
  await setSetting('registration_open', 'true')
  expect((await api('/api/auth/register', { body: { username: 'alice', password: DEFAULT_PASSWORD }, env: personal })).status).toBe(403)
  expect(await json(await api('/api/settings/public', { env: personal }))).toEqual({ registrationOpen: false, mode: 'personal' })
})
it('only admins can sign in', async () => {
  const alice = await createUser('alice')
  const res = await api('/api/auth/login', { body: { username: 'alice', password: DEFAULT_PASSWORD }, env: personal })
  expect(res.status).toBe(403)
  expect(await json(res)).toEqual({ error: 'admin_only' })
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').bind(alice).first())?.n).toBe(0)
  await createUser('root', { role: 'admin' })
  expect((await api('/api/auth/login', { body: { username: 'root', password: DEFAULT_PASSWORD }, env: personal })).status).toBe(200)
})
it('a non-admin session stops working once the mode is personal', async () => {
  await createUser('alice')
  const cookie = await login('alice') // signed in while temporary
  const res = await api('/api/mailboxes', { cookie, env: personal })
  expect(res.status).toBe(401)
  expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
  expect((await api('/api/mailboxes', { cookie })).status).toBe(200)
})
it("mail to a non-admin's address bounces in personal mode", async () => {
  // alice's active mailbox, root's active mailbox, on the same domain
  // handleEmail(..., { ...env, SERVICE_MODE: 'personal' }): alice → stub.rejected === REJECT_UNAVAILABLE, no messages row; root → stored
})
it('storeMessage re-checks the owner role', async () => {
  // findDeliveryTarget(db, aliceAddress, { adminOwnersOnly: false }) finds the target;
  // storeMessage(..., { ...limits, adminOwnersOnly: true }) → { stored: false, reason: 'unavailable' }
})
```

（`api()` 参数名以 `test/helpers.ts` 实际为准；清除 cookie 的断言以 `clearSessionCookie` 的实际输出为准。）

- [ ] **Step 2:** 运行 `npx vitest run test/personal-mode.test.ts`。预期：失败。
- [ ] **Step 3: 实现**
  - `isRegistrationOpen()`：`config.mode === 'personal'` 时直接返回 `false`。
  - `requireUser`：个人模式下，非管理员按未登录处理（清 cookie，返回 401）。
  - `/login`：在状态检查之后、`prepareSession` 之前判断，个人模式下非管理员返回 403 `admin_only`，不创建会话。
  - `findDeliveryTarget` 和 `storeMessage` 的条件 INSERT 都加上 `AND (? = 0 OR u.role = 'admin')`，并同步更新 `ingest.ts` 顶部的参数编号注释。`storeMessage` 失败分支里调用 `findDeliveryTarget` 时也要传入 opts。
  - `email.ts` 把 `config.ingest` 传给 `findDeliveryTarget`。
- [ ] **Step 4:** 运行 `npm test && npm run type-check`。预期：全部通过，旧测试不变（它们都跑临时模式）。
- [ ] **Step 5: 提交** `feat(modes): personal mode admits administrators only`

### Task 3: 个人模式的地址规则（后端 + 表单和配额显示）

**Files:**
- Modify: `shared/api.ts`（`isValidLocalPart`、`MailboxQuota`）
- Modify: `worker/repo/mailboxes.ts`、`worker/routes/mailboxes.ts`
- Modify: `src/components/NewAddressForm.vue`（校验、`quotaFull`、配额文案）、`src/components/home/AddressSwitchList.vue`（"4 / 10" 那一处）
- Modify: `src/locales/{zh-CN,en}.ts`（只显示数量的文案）
- Test: `test/mailboxes.test.ts`、`test/personal-mode.test.ts`

**Interfaces:**
- Consumes: `AppConfig.mode`
- Produces:
  - `isValidLocalPart(value: string, opts?: { personal?: boolean }): boolean`：`personal` 时只检查 1–32 位和 `LOCAL_PART_PATTERN`，不查保留前缀
  - `MailboxQuota { used: number; limit: number | null }`（`null` = 不限）
  - `MailboxLimits.quotaApplies: boolean`
  - `getQuota(db, userId, limits: Pick<MailboxLimits, 'defaultQuota' | 'quotaApplies'>)`
  - `updateMailbox(db, userId, id, patch, limits: Pick<MailboxLimits, 'defaultQuota' | 'quotaApplies'>)`

- [ ] **Step 1: 写失败的测试**

```ts
it('personal mode has no active quota or total cap', async () => {
  // admin root; env personal + DEFAULT_MAILBOX_QUOTA '1' + MAX_TOTAL_MAILBOXES '2'
  // three POST /api/mailboxes → all 201; GET /api/mailboxes → body.quota.limit === null
})
it('personal mode keeps the daily creation cap', async () => {
  // MAX_DAILY_MAILBOX_CREATIONS '2' → the third POST → 429 { error: 'rate_limited' }
})
it('personal mode accepts reserved and short local parts, never "+"', async () => {
  // localPart 'postmaster', 'me', 'a' → 201; 'a+b' → 400 invalid_local_part; 33 × 'a' → 400
})
it('temporary mode still rejects reserved and short local parts', async () => {
  // 'postmaster' → 400 invalid_local_part; 'me' → 400
})
it('re-enabling in personal mode ignores the quota', async () => {
  // DEFAULT_MAILBOX_QUOTA '1': two active, disable one, re-enable → 200
})
// 纯函数表驱动：
it.each([['me', true, false], ['postmaster', true, false], ['a+b', false, false], ['abc', true, true]])(
  'isValidLocalPart(%s): personal=%s temporary=%s', (v, personal, temporary) => {
    expect(isValidLocalPart(v, { personal: true })).toBe(personal)
    expect(isValidLocalPart(v)).toBe(temporary)
  })
```

- [ ] **Step 2:** 运行 `npx vitest run test/mailboxes.test.ts test/personal-mode.test.ts`。预期：新测试失败。
- [ ] **Step 3: 实现**
  - `quotaApplies === false` 时，`createMailbox` 去掉 `underQuota` 和总数条件，只保留每日新建上限；`creationFailure` 也不再返回配额和总数相关的错误；`updateMailbox` 重新启用时跳过配额；`getQuota` 返回 `limit: null`。
  - 路由里设置 `quotaApplies: config.mode !== 'personal'`，并调用 `isValidLocalPart(localPart, { personal })`。
  - 前端：`NewAddressForm` 的校验传入 `isPersonal()`；`limit === null` 时 `quotaFull` 为 false，并且只显示数量。
- [ ] **Step 4:** 运行 `npm test && npm run type-check && npm run build`。预期：全部通过。
- [ ] **Step 5: 提交** `feat(modes): personal mode lifts address quotas and reserved names`

### Task 4: 个人模式界面、e2e 跑两种模式、仓库切到 personal

**Files:**
- Modify: `src/views/auth/LoginView.vue`、`src/router/index.ts`、`src/views/admin/AdminView.vue`、`src/views/admin/SettingsPanel.vue`
- Modify: `vite.config.ts`、`playwright.config.ts`、`e2e/helpers.ts`、`tsconfig.e2e.json`
- Create: `e2e/personal.personal.spec.ts`
- Modify: `wrangler.jsonc`（单独提交）

**Interfaces:**
- Consumes: `isPersonal()`（Task 1）
- Produces（e2e）：
  - Playwright 有两个 project：`temporary`（5188 端口，数据在 `.wrangler/e2e`，跳过 `*.personal.spec.ts`）和 `personal`（5189 端口，数据在 `.wrangler/e2e-personal`，只跑 `*.personal.spec.ts`）
  - 环境变量 `POSTLUMA_E2E_MODE=personal|temporary` 决定 `vite.config.ts` 的数据目录和 `SERVICE_MODE`
  - `e2e/helpers.ts` 按当前 project 选择 base URL 和数据目录。个人模式下 `signIn(context, { admin: true })` 不走注册：用 `worker/lib/password.ts` 的 `hashPassword` 生成密码哈希，再用 SQL 插入一个管理员

- [ ] **Step 1: 写失败的 e2e**（`e2e/personal.personal.spec.ts`）
  - `login page has no register link`：`/login` 页面上没有链接到 `/register`；访问 `/register` 会跳到 `/login`。
  - `admin panel has no users tab`：管理员登录后打开 `/admin`，标签依次是 收信域名 / 系统设置 / 统计 / 操作记录，默认选中"收信域名"；系统设置里没有"开放注册"和"默认地址配额"。
  - `a non-admin sees the admin_only message`：用 SQL 插入一个普通用户；用它登录时，页面显示"这个站点是个人邮箱，只有管理员能登录"。
- [ ] **Step 2:** 运行 `npm run test:e2e -- --project personal`。预期：失败（这时还没有 personal project，或者测试本身失败）。
- [ ] **Step 3: 实现** 界面按设计 §4 第 8 条和 §5 #3 改（`admin_only` 的文案在 Task 2 已加好）；e2e 基础设施按上面的 Interfaces 搭。
- [ ] **Step 4:** 运行 `npm test && npm run type-check && npm run build && npm run test:e2e`。预期：两个 project 都通过，现有的 e2e 不受影响。然后在 personal project 下截取登录页和后台的桌面、390 px 截图核对。
- [ ] **Step 5: 提交** `feat(modes): personal mode interface; e2e runs both modes`
- [ ] **Step 6:** 把 `wrangler.jsonc` 的 `SERVICE_MODE` 改成 `"personal"`，注释写明这是本仓库自己的部署、别人部署时可以改。运行 `npm test`，预期仍然通过，因为 vitest 固定了临时模式。提交 `chore(config): this deployment runs in personal mode`

### Task 5: 临时模式去掉发信

**Files:**
- Modify: `worker/repo/settings.ts`（`isSendingEnabled`）
- Modify: `worker/routes/admin/sending.ts`、`worker/routes/admin/domains.ts`（`canSend`）、`worker/routes/admin/users.ts`（`/:id/sending`）
- Modify: `src/views/admin/SettingsPanel.vue`（`SendingCard` 只在个人模式出现）、`src/views/admin/UserManager.vue`（去掉"允许发信"标签和按钮）
- Delete: `src/views/admin/UserSendingDialog.vue`，以及只给它用的文案（审计日志里 `admin.user_sending` 的动作说明要保留，旧记录还会用到）
- Modify tests: `test/outbox.test.ts`、`test/admin-sending.test.ts`、`test/isolation/outbox.test.ts`、`test/sending-config.test.ts`
- Create: `test/temporary-mode.test.ts`
- Rename: `e2e/sending.spec.ts` → `e2e/sending.personal.spec.ts`

**Interfaces:**
- Consumes: `AppConfig.mode`；`signIn(context, { admin: true })` 的个人模式写法（Task 4）
- Produces: `isSendingEnabled(db, config)` 在 `temporary` 下恒为 `false`；`/api/admin/sending/*`、PATCH 域名 `canSend`、`/api/admin/users/:id/sending` 在临时模式下都返回 404

- [ ] **Step 1: 写失败的测试**（`test/temporary-mode.test.ts`，使用默认的临时模式）

```ts
it('temporary mode has no sending, even with the switch on', async () => {
  await setSetting('sending_enabled', 'true')
  // admin cookie: GET /api/outbox → 404; POST /api/outbox → 404; GET /api/outbox/status → 200 with canSend false
  // GET /api/admin/sending → 404; PATCH /api/admin/domains/:id { canSend: true } → 404
  // PATCH /api/admin/users/:id/sending → 404; GET /api/auth/me → canSend false
})
```

- [ ] **Step 2:** 运行 `npx vitest run test/temporary-mode.test.ts`。预期：失败。
- [ ] **Step 3: 实现** 后端开关和三个 404。现有的发信测试全部改成用个人模式的 env，发件人改成管理员（`createUser(name, { role: 'admin' })`）。HTTP 层面需要"非管理员发件人"的用例删掉：个人模式下非管理员无法登录，临时模式下又没有发信。跨用户测试改为两个管理员互相验证。前端按 Files 列表修改。
- [ ] **Step 4:** 运行 `npm test && npm run type-check && npm run build && npm run test:e2e`。预期：全部通过；发信的 e2e 在 personal project 下运行。
- [ ] **Step 5: 提交** `feat(modes): temporary mode has no sending`

### Task 6: 收藏（后端）

**Files:**
- Create: `migrations/0012_starred.sql`
- Modify: `worker/lib/config.ts`、`wrangler.jsonc`、`worker-configuration.d.ts`
- Modify: `shared/api.ts`、`worker/repo/messages.ts`、`worker/routes/messages.ts`、`worker/repo/maintenance.ts`
- Modify: `src/locales/{zh-CN,en}.ts`（`errors.star_limit_reached`：中文"收藏的邮件已达上限，先取消一些再收藏"，英文 "You've starred as many messages as allowed. Unstar some first."）
- Test: `test/messages.test.ts`、`test/isolation/messages.test.ts`、`test/cleanup.test.ts`、`test/query-plans.test.ts`

**Interfaces:**
- Produces:
  - 迁移：

    ```sql
    ALTER TABLE messages ADD COLUMN is_starred INTEGER NOT NULL DEFAULT 0 CHECK (is_starred IN (0, 1));
    -- Only starred rows enter this index, so ordinary deliveries pay no extra write.
    CREATE INDEX idx_messages_user_starred ON messages(user_id, received_at) WHERE is_starred = 1;
    ```
  - `INT_VARS.MAX_STARRED_MESSAGES = { fallback: 500, min: 0, max: 100_000 }` → `AppConfig.maxStarredMessages`
  - `MessageSummary.isStarred: boolean`
  - `updateMessageSchema`：`{ isRead?: boolean; starred?: boolean }`，至少要有一项
  - `listMessagesQuerySchema.starred: flagSchema`
  - `ERROR_CODES` 加 `'star_limit_reached'`
  - `setMessageStarred(db, userId: string, id: string, starred: boolean, maxStarred: number): Promise<void>`：消息不存在或不属于该用户时抛 404；超过上限时抛 409 `star_limit_reached`；重复收藏或重复取消都不报错
  - `listMessages` 的 opts 加 `starredOnly?: boolean`

- [ ] **Step 1: 写失败的测试**

```ts
it('stars and unstars a message', async () => {
  // PATCH { starred: true } → 204; GET /api/messages → isStarred true; GET ?starred=1 → only that one
  // PATCH { starred: false } → 204; GET ?starred=1 → []
})
it('starring stops at MAX_STARRED_MESSAGES', async () => {
  // env MAX_STARRED_MESSAGES '2': third → 409 { error: 'star_limit_reached' }; starring an already starred one → 204
})
it('concurrent stars cannot pass the cap', async () => {
  // MAX_STARRED_MESSAGES '1', two PATCHes in Promise.all on different messages
  // → statuses sorted [204, 409]; SELECT COUNT(*) WHERE is_starred = 1 → 1
})
it('temporary mode has no starring', async () => {
  // PATCH { starred: true } → 404; GET ?starred=1 → 404; PATCH { isRead: true } still 204
})
// isolation/messages.test.ts
it("B cannot star A's message", async () => { /* → 404; A's row is_starred stays 0 */ })
// cleanup.test.ts
it('retention keeps starred mail and its original', async () => {
  // two messages older than retention, one starred → runCleanup deletes only the other; starred R2 object still exists
})
it('manual cleanup keeps starred mail', async () => { /* POST /api/admin/cleanup → starred one survives */ })
it("deleting a user's mail removes starred mail too", async () => { /* scope 'user' deletes everything */ })
// query-plans.test.ts：?starred=1 的列表查询走 idx_messages_user_starred，计划里不出现 SCAN
```

（除"临时模式"那条以外，以上请求都用 `SERVICE_MODE: 'personal'` 和管理员账号；跨用户测试用两个管理员。）

- [ ] **Step 2:** 运行这四个测试文件。预期：失败。
- [ ] **Step 3: 实现**
  - 收藏的条件 UPDATE：`... AND (SELECT COUNT(*) FROM (SELECT 1 FROM messages WHERE user_id = ?1 AND is_starred = 1 LIMIT ?3)) < ?3`。没有改动任何行时，再查一次这一行，区分 404、"本来就已收藏"和 409。
  - 路由：临时模式下，只要带了 `starred`（PATCH 的字段或列表的查询参数）就返回 404。
  - `maintenance.ts`：`olderThan` 范围加上 `AND is_starred = 0`，`user` 范围不变。
- [ ] **Step 4:** 运行 `npm test && npm run type-check && npm run build`。预期：全部通过。
- [ ] **Step 5: 提交** `feat(inbox): star messages to keep them past retention (personal mode)`

### Task 7: 收藏（界面）

**Files:**
- Modify: `src/api/messages.ts`、`src/components/MessageRow.vue`、`src/views/InboxView.vue`、`src/components/MessageDetail.vue`
- Modify: `src/locales/{zh-CN,en}.ts`
- Create: `e2e/starring.personal.spec.ts`

**Interfaces:**
- Consumes: Task 6 的接口和字段

界面以设计 §4 第 3 条为准：
- 星标放在邮件行右侧、时间前面。已收藏时是实心（ink 色），未收藏时是浅色空心。点击星标不会打开邮件。
- 筛选里"验证码"后面多一个"收藏"，和其他筛选一样写进 URL。
- 详情工具栏的第一个按钮是星标；已收藏时，发件人下方显示"已收藏，不会被自动清理"。
- 这些只在个人模式出现。

文案：
| 键 | 中文 | 英文 |
|---|---|---|
| `inbox.filterStarred` | 收藏 | Starred |
| `inbox.star` | 收藏 | Star |
| `inbox.unstar` | 取消收藏 | Unstar |
| `inbox.starredNote` | 已收藏，不会被自动清理 | Starred — kept when old mail is cleaned up |

- [ ] **Step 1: 写失败的 e2e**：投递一封邮件 → 在列表行上点星标 → 切到"收藏"筛选能看到它 → 打开后能看到"已收藏，不会被自动清理" → 取消收藏 → 它从"收藏"筛选里消失。另外，390 px 宽度下收件箱没有横向滚动（写法参照 `flows.spec.ts` 里的溢出检查）。
- [ ] **Step 2:** 运行 `npm run test:e2e -- --project personal`。预期：失败。
- [ ] **Step 3: 实现** 按上面的要求；星标点击后乐观更新，接口失败时回滚，并按错误码提示。
- [ ] **Step 4:** 运行 `npm test && npm run type-check && npm run build && npm run test:e2e`，并截取桌面和 390 px 截图核对。
- [ ] **Step 5: 提交** `feat(inbox): star button, Starred filter and kept-mail note`

### Task 8: catch-all（后端）

**Files:**
- Create: `migrations/0013_catch_all.sql`
- Modify: `worker/lib/config.ts`、`wrangler.jsonc`、`worker-configuration.d.ts`
- Modify: `shared/api.ts`（`AdminDomain`、`PublicMailbox`、`AdminSettings`、`SETTING_RANGES`、`adminSettingsSchema`、`updateDomainSchema`）
- Modify: `worker/repo/settings.ts`、`worker/repo/ingest.ts`、`worker/email.ts`、`worker/repo/mailboxes.ts`、`worker/repo/domains.ts`
- Modify: `worker/routes/admin/domains.ts`、`worker/routes/admin/system.ts`
- Test: `test/catch-all.test.ts`（新建）、`test/isolation/catch-all.test.ts`（新建）、`test/query-plans.test.ts`

**Interfaces:**
- Produces:
  - 迁移：

    ```sql
    -- NULL = catch-all off; otherwise the admin who switched it on owns every auto-created address.
    ALTER TABLE domains ADD COLUMN catch_all_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE mailboxes ADD COLUMN auto_created INTEGER NOT NULL DEFAULT 0 CHECK (auto_created IN (0, 1));
    -- Same row as the daily ingest budget, so these bumps cost no extra row writes.
    ALTER TABLE ingest_counters ADD COLUMN auto_created INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE ingest_counters ADD COLUMN catch_all_messages INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE ingest_counters ADD COLUMN catch_all_bytes INTEGER NOT NULL DEFAULT 0;
    ```
  - `INT_VARS.CATCH_ALL_MAX_PER_DAY = { fallback: 10, min: 0, max: 10_000 }`，`INT_VARS.CATCH_ALL_MAX_PER_ADDRESS_PER_HOUR = { fallback: 10, min: 1, max: 100_000 }` → `AppConfig.ingest.catchAllPerDay`、`AppConfig.ingest.catchAllPerAddressPerHour`（也加进 `IngestLimits`）
  - `SettingKey` 加 `'catch_all_max_per_day' | 'catch_all_max_per_address_per_hour'`；`overrideStatement` 的 key 类型同步；`settingIntSql(key: SettingKey, defaultParam: string): string` 生成 `COALESCE(CAST((SELECT value FROM settings WHERE key = '…') AS INTEGER), <defaultParam>)`
  - `AdminSettings` 加 `catchAllMaxPerDay`、`catchAllMaxPerAddressPerHour`，`overridden` 和 `defaults` 里也各加一项；`SETTING_RANGES` 加 `catchAllMaxPerDay: { min: 0, max: 10_000 }`、`catchAllMaxPerAddressPerHour: { min: 1, max: 100_000 }`；`adminSettingsSchema` 接受这两项（可为 null，表示恢复默认）
  - `AdminDomain.catchAll: boolean`；`updateDomainSchema` 加 `catchAll?: boolean`；`setDomainCatchAll(db, id: string, ownerId: string | null): Promise<string>`（返回域名）
  - `PublicMailbox.autoCreated: boolean`
  - `DeliveryTarget` 加 `autoCreated: boolean` 和 `create?: { domainId: string }`（地址还不存在、要在这次投递里建）
  - `findCatchAllTarget(db, recipient: string, mailboxId: string): Promise<DeliveryTarget | null>`

收信规则（设计 §4 第 4、10、11 条，§5 #7–#11、#16）：
- 只在个人模式、`findDeliveryTarget` 没找到，并且收件人不带 `+` 时，才走 catch-all。
- `findCatchAllTarget` 返回目标的条件：收件人的域名存在、已启用，`catch_all_user_id` 指向一个 `active` 的管理员；本地部分满足严格的 `isValidLocalPart`（不带 personal 选项）；地址不在 `mailboxes`（任何状态）里，也不在 `retired_addresses` 里。
- 建地址：`storeMessage` 看到 `target.create` 时，在同一个 batch 里先执行 `INSERT OR IGNORE INTO mailboxes … auto_created = 1`。所有门槛都写进这条 INSERT 的 WHERE：域名的 catch-all 仍归这个 owner 并且已启用；owner 是 active 的管理员；地址没退役；当天 `auto_created` 小于有效上限；全站预算没超；catch-all 的一半份额没超。接着执行原来的消息 INSERT。同一个事务里条件相同，所以建了地址，消息一定能写进去。
- 计数：只有这次 batch 真建了地址时，`auto_created` 才加 1；每存一封发给自动建地址的信，`catch_all_messages` 和 `catch_all_bytes` 都要累加。
- 速率：手动建的管理员地址照旧豁免；自动建的地址只按"每个地址每小时"的有效上限（`settingIntSql`）计数；临时模式的普通用户照旧用 `WITHIN_RATE`。个人模式没有"每个用户每小时"的上限。
- 一半份额：发给自动建地址的信，要求 `catch_all_messages < 每日条数上限 / 2`，并且 `catch_all_bytes + 本封字节 <= 每日字节上限 / 2`。
- 并发：建地址失败、消息也没写进去时，重新调用一次 `findDeliveryTarget`。地址已经被另一封信建好的话，按普通流程投递一次；否则退信。
- 退信理由：建地址被拒一律 `REJECT_UNAVAILABLE`。已经存在的自动建地址超过每小时上限时，退信理由是 `REJECT_FLOODED`；超过一半份额时，是 `REJECT_OVER_BUDGET`。
- 解析之前，先用便宜的预检查拦掉超限的情况（参照现有的 `ingestBlock`），不浪费 CPU。
- 手动建地址的每日上限（Task 3）只统计 `auto_created = 0` 的行。

- [ ] **Step 1: 写失败的测试**（`test/catch-all.test.ts`。准备：管理员 root；域名 `d.test` 的 `catch_all_user_id = root`；`const personal = { ...env, SERVICE_MODE: 'personal' }`）

```ts
it('creates the address on first mail and delivers it', async () => {
  // handleEmail(stub to 'shop-jd@d.test', personal) → stub.rejected undefined
  // mailboxes row { address: 'shop-jd@d.test', user_id: root, auto_created: 1, status: 'active' }; 1 message
  // ingest_counters today: auto_created 1, catch_all_messages 1
})
it('later mail goes to the same address', async () => { /* 1 mailbox, 2 messages, auto_created still 1 */ })
it('lowercases the envelope recipient', async () => { /* 'Shop-JD@D.test' → mailbox 'shop-jd@d.test' */ })
it.each([
  ['a+b@d.test', 'subaddress without a base address'],
  ['ab@d.test', 'too short'],
  ['postmaster@d.test', 'reserved'],
  ['bad..dots@d.test', 'invalid'],
])('never creates %s (%s)', async (to) => {
  // stub.rejected === REJECT_UNAVAILABLE; no mailboxes row; no messages row
})
it('never re-creates retired or disabled addresses', async () => { /* both → REJECT_UNAVAILABLE; disabled row unchanged */ })
it('does nothing when catch-all is off, the domain disabled, the owner not an active admin, or the mode temporary', async () => {})
it('stops creating at the daily cap; the admin override lifts it', async () => {
  // CATCH_ALL_MAX_PER_DAY '2' → third new address rejected; an existing auto-created address still receives
  // setSetting('catch_all_max_per_day', '3') → the third is created
})
it('caps each auto-created address per hour; manual admin addresses are not capped', async () => {
  // CATCH_ALL_MAX_PER_ADDRESS_PER_HOUR '2' → 3rd mail to the auto-created address → REJECT_FLOODED
  // root's manual address takes 3 mails
})
it('catch-all spam burst leaves room for manual addresses', async () => {
  // INGEST_MAX_MESSAGES_PER_DAY '4' → auto-created addresses take 2 messages, the 3rd → rejected
  // root's manual address still receives
})
it('creates no address when the message is refused', async () => {
  // seed ingest_counters.messages = INGEST_MAX_MESSAGES_PER_DAY → rejected; no mailboxes row; auto_created unchanged
  // malformed MIME to a new address → REJECT_MALFORMED; no mailboxes row
})
it('two first deliveries to one new address create it once', async () => {
  // Promise.all of two handleEmail → one mailboxes row; 2 messages, or 1 message + one REJECT_UNAVAILABLE; no exception
})
it('ownership comes from the domain, never from headers', async () => {
  // forged To:/Delivered-To: naming another admin's address → stored under root only
})
it('admin can switch catch-all per domain', async () => {
  // personal: PATCH /api/admin/domains/:id { catchAll: true } → 200, catch_all_user_id = that admin; audit 'admin.domain_catch_all'
  // { catchAll: false } → NULL; temporary: → 404
})
it('catch-all limits can be overridden and reset in settings', async () => {
  // PATCH /api/admin/settings { catchAllMaxPerDay: 5 } → GET shows 5 and overridden true; null → default; temporary → 404
})
// isolation/catch-all.test.ts：两个管理员 A、B，catch-all 归 A。
// 自动建的地址只出现在 A 的 /api/mailboxes 里；B 对这个地址 id 做 GET 或 PATCH → 404，数据不变。
// query-plans.test.ts：catch-all 查找（按 domains.domain、mailboxes.address、retired_addresses 主键）都走索引。
```

- [ ] **Step 2:** 运行 `npx vitest run test/catch-all.test.ts test/isolation/catch-all.test.ts`。预期：失败。
- [ ] **Step 3: 实现** 按上面的收信规则；`ingest.ts` 顶部的参数编号注释同步更新。
- [ ] **Step 4:** 运行 `npm test && npm run type-check && npm run build`。预期：全部通过，其中 `test/email.test.ts` 不需要改。
- [ ] **Step 5: 提交** `feat(mail): catch-all creates addresses on first mail (personal mode)`

### Task 9: catch-all（界面）

**Files:**
- Modify: 前端的域名接口客户端（`DomainManager.vue` 用的那一个）、`src/api/admin.ts`（设置的类型）
- Modify: `src/views/admin/DomainRow.vue`、`src/views/admin/DomainManager.vue`、`src/views/admin/SettingsPanel.vue`
- Modify: `src/components/MailboxItem.vue`、`src/views/HomeView.vue`
- Modify: `src/locales/{zh-CN,en}.ts`
- Create: `e2e/catch-all.personal.spec.ts`

**Interfaces:**
- Consumes: Task 8 的字段和接口

界面以设计 §4 第 4、11 条和 §5 #13 为准：
- `DomainRow` 的"可发信"前面加一个开关"catch-all 自动建地址"，只在个人模式出现。
- 系统设置里加一个 catch-all 区块，只在个人模式出现：两个数字输入框，显示部署默认值，可以恢复默认，写法参照"保留天数"。
- `MailboxItem` 的第二行在时间前面显示"自动创建"小标签。
- 首页的回退顺序：记住的地址 → 最新的手动创建的地址 → 列表里的第一个。

文案：
| 键 | 中文 | 英文 |
|---|---|---|
| `admin.domains.catchAll` | catch-all 自动建地址 | Catch-all: create addresses |
| `admin.domains.catchAllOn` / `catchAllOff` | {domain} 已开启 / 已关闭 catch-all | Catch-all on / off for {domain} |
| `admin.settings.catchAllPerDay` | 每天最多自动建几个地址 | New addresses per day |
| `admin.settings.catchAllPerAddressPerHour` | 自动建的地址每个每小时最多收几封 | Messages per auto-created address per hour |
| `mailboxes.autoCreated` | 自动创建 | Auto-created |

- [ ] **Step 1: 写失败的 e2e**：管理员在"收信域名"里打开 e2e 域名的 catch-all → 投递到 `shop-<uid>@e2e.test` → 地址页能看到这个地址，带"自动创建" → 收件箱能看到这封信。另外，390 px 宽度下后台域名页和地址页没有横向滚动。
- [ ] **Step 2:** 运行 `npm run test:e2e -- --project personal`。预期：失败。
- [ ] **Step 3: 实现** 按上面的要求。
- [ ] **Step 4:** 运行 `npm test && npm run type-check && npm run build && npm run test:e2e`，并截取桌面和 390 px 截图核对。
- [ ] **Step 5: 提交** `feat(admin): catch-all switch, limits and auto-created tag`

### Task 10: 文档

**Files:**
- Modify: `README.md`、`README.en.md`、`CLAUDE.md`、`docs/DEV_PLAN.md`、`docs/MODES_DESIGN.md`

- [ ] **Step 1: README（中英文）**
  - 开头改成"部署在 Cloudflare 上的邮箱：个人邮箱或临时邮箱，部署时二选一"，并附上设计 §2 的对比表。
  - 部署步骤加一步"选模式"。
  - 配置表加 `SERVICE_MODE`、`MAX_STARRED_MESSAGES`、`CATCH_ALL_MAX_PER_DAY`、`CATCH_ALL_MAX_PER_ADDRESS_PER_HOUR`。
  - "不做什么"改成：发信只在个人模式里有。
  - 补充 catch-all 的说明：Email Routing 的 catch-all 本来就要配，PostLuma 自己决定收不收。
- [ ] **Step 2: CLAUDE.md**
  - 架构：模式的概念，以及模式只在哪几个入口判断。
  - 收信流水线：catch-all 分支和它的几个上限。
  - 安全规则：catch-all 是"归属只来自 D1"的唯一新来源（域名的 `catch_all_user_id`）；个人模式只允许管理员；保留前缀只在个人模式的手动创建中放开。
  - `settings` 表的 key 列表。
  - 收藏和清理的关系。
  - 测试：vitest 固定临时模式；个人模式的测试覆盖 env；e2e 有两个 project。
- [ ] **Step 3: DEV_PLAN.md** 新增 Phase 10 表格（对应 Task 1–10，标记已完成），链接到 `MODES_DESIGN.md` 和 `MODES_PLAN.md`；`MODES_DESIGN.md` 的状态改成"已实现"。
- [ ] **Step 4:** 运行 `npm run build`。预期：通过。
- [ ] **Step 5: 提交** `docs(modes): README, conventions and roadmap for service modes`

## 完成后

- 所有任务完成后，运行一次 `npm test && npm run type-check && npm run build && npm run test:e2e`，然后对整个分支做一次代码审查。
- 合并到 main 和推送都要先问你。推送后，Workers Builds 会自动部署并执行新迁移。然后按设计 §7 核对线上效果，再在需要的域名上打开 catch-all。
