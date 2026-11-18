# 一键部署按钮与 README 重写（设计）

> 状态：已实现（2026-11-16），见 [DEV_PLAN.md](DEV_PLAN.md) 的 Phase 12。按钮流程本地验证不了，合并到 main 后要实际点一次。

## 1. 为什么做

要把 PostLuma 拿出去宣传。第一次看到 README 的人要能很快明白它是什么，点一下 Deploy to Cloudflare 按钮，就能在自己的账号里部署一份。

## 2. 目标、不做的事、算失败的情况

**目标**
- README 第一屏是一句话介绍、部署按钮和截图，读起来像作者自己写的。
- 按钮部署出来的站点能直接用 `admin` 登录，给收信域名配好 Email Routing 后就能收信。
- 作者现有的部署不需要改任何配置。

**不做**
- 不为按钮另建一份配置（分支、子目录或 Wrangler 环境）。
- 不放松 Turnstile：按钮部署和手动部署一样，缺少密钥时拒绝登录。
- 不改 `npm run deploy`。

**算失败**
- 按钮部署出来登录不了，或者 Turnstile 被关掉。
- Turnstile 的 Secret Key 有被公开的可能。
- 作者的部署因为这次改动要补配置才能继续工作。

## 3. 按钮怎么工作（约束）

Cloudflare 的流程：
1. 把仓库复制到对方的 GitHub 或 GitLab。
2. 按 `wrangler.jsonc` 创建 D1 和 R2，新资源的 id 写回复制出来的仓库。
3. 把 `.dev.vars.example` 里列出的每个名字当作 Worker 密钥，让对方填写。
4. 用 `package.json` 的 `build`、`deploy` 脚本在 Workers Builds 里构建和部署。

`package.json#cloudflare.bindings.<名字>.description` 会作为说明显示在部署页面上。

按钮做不到：设置构建变量、开通 R2（要先绑定付款方式）、配置 Email Routing、创建 Turnstile 组件。仓库必须公开，按钮读的是 GitHub 上的默认分支。

## 4. 做法

| # | 决定 | 谁定的 | 原因 |
|---|---|---|---|
| 1 | 按钮照样创建 R2，README 写明要先开通 | 你 | 配置只有一份；没绑卡的人走手动部署 |
| 2 | `.dev.vars.example` 只列部署要填的 `ADMIN_INITIAL_PASSWORD`、`TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET_KEY`，值留空。本地开发的默认值（含 `TURNSTILE_DISABLED=true`、`MAIL_PROVIDER=log`）挪到 `.dev.vars.local.example`。`cf-typegen` 两个文件都读 | 我 | 按钮会把 `.dev.vars.example` 的每一项都当成生产密钥；值留空，就没人能沿用默认值直接上线 |
| 3 | `RESEND_API_KEY` 不放进 `.dev.vars.example` | 我 | 发信默认关闭，按钮不该要求填写它 |
| 4 | Site Key 改为运行时读取：Worker 读 `TURNSTILE_SITE_KEY`，经 `/api/settings/public` 下发。Turnstile 关闭、没有设置或长度像 Secret Key（超过 30 位）时下发 `null`。前端优先用下发的值，没有时回退到构建变量 `VITE_TURNSTILE_SITE_KEY` | 我 | 按钮流程设不了构建变量；有了回退，作者现有的部署不用改；长度检查沿用 `vite.config.ts` 的规则，防止把 Secret 公开 |
| 5 | 删除 `.env.example` | 我 | 里面只有构建变量，按钮可能会把它当成密钥来问 |
| 6 | `package.json` 加上三个密钥的说明（中英文，链接到 Turnstile 控制台） | 我 | 部署页面上能看到每一项该填什么 |
| 7 | 按钮部署出来默认是个人邮箱模式（仓库现在的值），README 写怎么改成临时邮箱 | 我 | 点按钮的人多半是给自己用 |
| 8 | `npm run deploy` 不动，按钮流程会因此构建两次 | 我 | 手动部署仍然只要一条命令，多构建一次只是慢一点 |

## 5. README

中英文两份同步修改。

- **结构**：一句话介绍和部署按钮 → 截图 → 为什么做 → 两种模式 → 功能 → 部署（按钮在前，手动部署折叠） → 配置（折叠） → 本地开发和测试 → 安全 → 不做什么 → 许可证。
- **写法**：不用 emoji；不用“强大”“轻松”“开箱即用”“一站式”这类词；少用加粗和括号；句子短；用作者的口吻讲为什么做；数字写具体的。
- **不提其他项目**：README 不和其他项目比较，也不点名（2026-11-17 你定的）。按免费额度设计的部分放在“怎么工作的”里讲。
- **截图**：重拍首页、收件箱、暗色、手机 4 张，用个人邮箱模式和示例数据。现在的截图是 10 月 20 日在临时邮箱模式下拍的，邮件详情里还有已经去掉的验证码大卡片。
- **部署步骤**要写清楚按钮做不了的事：开通 R2、先建 Turnstile 组件、配置 Email Routing、首次登录后改密码并删除 `ADMIN_INITIAL_PASSWORD`。

## 6. 留给实现时决定

- 截图里的示例数据和 README 的具体措辞。
- 测试覆盖 `/api/settings/public` 下发 Site Key 的几种情况：有、没有、Turnstile 关闭、长度像 Secret Key。
