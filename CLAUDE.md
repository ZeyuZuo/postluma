# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

PostLuma is a multi-user temporary-mailbox service that runs entirely on Cloudflare (Workers + Email Routing + D1, optional R2). Product requirements: [docs/PRD.md](docs/PRD.md) (Chinese). Phased roadmap and open product questions: [docs/DEV_PLAN.md](docs/DEV_PLAN.md) — check it before starting a feature and tick items off when done.

## Commands

```bash
npm run dev                 # Vite + Workers runtime (workerd) locally; API, SPA and bindings in one server
npm run db:migrate:local    # apply migrations/ to the local D1 (.wrangler/state) — needed before first `dev`
npm test                    # Vitest inside workerd (@cloudflare/vitest-plugin)
npx vitest run test/health.test.ts      # single file
npx vitest run -t "reports the database" # single test by name
npm run type-check          # vue-tsc --build over all three tsconfig projects
npm run build               # type-check + vite build -> dist/client (SPA) + dist/postluma (Worker)
npm run cf-typegen          # regenerate worker-configuration.d.ts after editing wrangler.jsonc or .dev.vars.example
npm run deploy              # build + remote D1 migrations + wrangler deploy (manual path; CI uses Workers Builds)
```

Tooling gotchas:
- npm 12 blocks install scripts unless listed in `package.json#allowScripts`, which pins exact versions. After a dependency bump, `npm install` warns that `workerd`/`esbuild` scripts were blocked — run `npm install-scripts approve workerd esbuild` then `npm rebuild workerd esbuild`.
- `worker-configuration.d.ts` is generated but committed, because `npm run build` (also run by Workers Builds) type-checks against it. `cf-typegen` reads secret *names* from `.dev.vars.example` (not your local `.dev.vars`), so types are identical on every machine; a new secret must be added there.
- vue-i18n parses `@`, `{`, `}`, `|` in messages as syntax — never put email addresses or literal braces in `src/locales/*`; keep such sample data in the component.
- Stay on Vitest 4.x until `@cloudflare/vitest-plugin` is verified on a newer major. `@cloudflare/vitest-pool-workers` is the deprecated old name — don't reintroduce it.

## Architecture

**One Worker, three entry points** (`worker/index.ts`):
- `fetch` → Hono app (`worker/app.ts`, mounted at `/api`). Static assets (the built Vue SPA) are served by Workers Static Assets *before* the Worker runs, except paths matching `assets.run_worker_first` (`/api/*`) in `wrangler.jsonc`. Unknown non-API paths fall back to `index.html` (`not_found_handling: single-page-application`), so client routes need no server code.
- `email` → `worker/email.ts`, invoked by Email Routing's catch-all rule. Catch-all is routing only: the handler must look up the recipient in D1 and call `message.setReject()` unless the mailbox exists, is `active`, and its owner is `active`. It rejects everything until ingestion is implemented.
- `scheduled` → cron in `wrangler.jsonc#triggers` for retention cleanup (`settings.retention_days`) and expired-session purge.

**Build/deploy shape**: `@cloudflare/vite-plugin` builds the client and the Worker together and writes `dist/postluma/wrangler.json` plus `.wrangler/deploy/config.json`, a redirect, so plain `wrangler deploy` and `wrangler d1 migrations apply` read the *built* config. Edit `wrangler.jsonc`, never the generated copy.

**Request pipeline** (`worker/app.ts`): `secureHeaders` → `Cache-Control: no-store` → `checkOrigin` (CSRF) → 64 KB `bodyLimit` → default-deny gate (`PUBLIC_ROUTES` set; everything else runs `requireUser`) → `/api/admin/*` additionally `requireAdmin` → route. Handlers signal failures by throwing `ApiError(status, code)`; `onError` serializes it as `{ error: code }`. Request bodies go through `parseJson(c, zodSchema)` from `worker/lib/request.ts`. Auth-sensitive endpoints call `enforceRateLimit` and `requireTurnstile`.

**Code layout**: `src/` is the Vue 3 SPA (alias `@` → `src`). `worker/` is server code: `routes/` (Hono sub-apps), `repo/` (all SQL), `middleware/`, `lib/` (crypto, password, cookies, request helpers). `shared/api.ts` holds the error-code list, API types and zod schemas imported by both sides (frontend imports it via relative path). Three TS projects: `tsconfig.app.json` (DOM, `src/` + `shared/`), `tsconfig.worker.json` (Workers types from `worker-configuration.d.ts`, `worker/` + `shared/` + `test/`), `tsconfig.node.json` (config files).

**Data model** (`migrations/0001_init.sql`; never edit an applied migration, add `000N_*.sql`):
- `users.status`: `pending → active | rejected`, `active ↔ banned`. Only `active` users may log in or receive mail. The first admin is `admin`, bootstrapped from the `ADMIN_INITIAL_PASSWORD` secret.
- `sessions.id` is SHA-256 of the cookie token; the raw token exists only in the cookie.
- `mailboxes.status` has exactly two values: `active` (receives mail) and `disabled` (rejects new mail, history still readable, can be re-enabled). Disabled mailboxes are listed on a separate page. There is **no mailbox delete feature** — don't add one. Only `active` mailboxes count toward the user's quota (so re-enabling must re-check quota).
- Addresses are never reusable: when a user account is deleted, its addresses go into `retired_addresses`; mailbox creation checks both `mailboxes.address` and `retired_addresses`, so no user can ever receive a previous owner's mail.
- `domains` (admin-managed) replaces any env-var domain list; a disabled domain blocks new mailboxes only. Each domain also needs an Email Routing catch-all in the Cloudflare dashboard.
- `messages.user_id` is denormalized from the mailbox so every user-facing query can filter `WHERE user_id = ?` directly.
- `audit_logs` records admin actions and auth failures. `settings` is a key/value table for admin-tunable config (default quota, retention, `registration_open`).
- Timestamps are epoch milliseconds (INTEGER). D1 enforces foreign keys; `ON DELETE CASCADE` is the cleanup path.

**Security invariants** (from PRD §6 — tenant isolation is the top priority; enforced in code review):
- Every non-auth `/api` route resolves the session and re-checks `users.status = 'active'` on each request (bans take effect immediately). Admin routes additionally require `role = 'admin'`.
- Route handlers never call `env.DB` directly for user data. All mailbox/message/attachment access goes through `worker/repo/*` functions whose first argument is the session's `userId` and whose SQL always includes `user_id = ?`. A resource owned by someone else returns 404 (not 403) so ids can't be probed.
- Admins manage accounts, quotas, domains and settings, and see aggregate counts only. No admin endpoint returns mail content (product decision, not a TODO).
- Email ingestion derives `user_id` solely from the D1 mailbox row matched by exact lowercase recipient address — never from headers. No subaddressing (`+tag`) or fuzzy matching.
- State-changing requests require a same-origin `Origin` header (CSRF) in addition to `SameSite=Lax` cookies. Login rotates the session token; ban, reject and password change delete all of that user's sessions.
- Sessions are only ever created through `prepareSession()` (`worker/repo/sessions.ts`), whose INSERT is conditional on the user still having the verified password hash and `status='active'`. Run it in the same `db.batch()` as any status/password change, so a racing login can't outlive a ban or password change.
- Rate-limit keys must never be chosen by an unauthenticated caller alone (e.g. a per-username bucket) — that lets anyone lock a victim out. Login uses per-IP limits + Turnstile + PBKDF2 cost.
- Turnstile fails closed: a missing `TURNSTILE_SECRET_KEY` makes auth return 500 unless `TURNSTILE_DISABLED=true` (local dev/tests only, never in production). The siteverify `hostname` and `action` must match.
- The initial-admin bootstrap runs once per database (guarded by `settings.admin_bootstrapped`, written in the same batch). Never weaken this to "if no admin exists".
- Every new endpoint gets a cross-tenant test: user B requesting user A's resource must get 404 and must not mutate anything.
- Passwords: PBKDF2-SHA256 via WebCrypto (Workers caps iterations at 100,000), with per-user salt and constant-time compare.
- Login/register: `AUTH_LIMITER` (Workers Rate Limiting binding) + Turnstile verification (`TURNSTILE_SECRET_KEY`).
- HTML mail is rendered only inside a sandboxed iframe (no `allow-scripts`, no `allow-same-origin`) with a restrictive CSP; remote images are blocked until the user opts in per message.

**Secrets** (`wrangler secret put` in prod, `.dev.vars` locally; template in `.dev.vars.example`): `ADMIN_INITIAL_PASSWORD`, `TURNSTILE_SECRET_KEY`, plus dev-only `TURNSTILE_DISABLED`. Runtime-tunable config (domains, quotas, retention, registration switch) lives in D1, not `wrangler.jsonc#vars`.

**Frontend**: Naive UI for components, vue-i18n for text. Session state is `src/stores/session.ts` (no Pinia); the router guard in `src/router/index.ts` loads it once and enforces `meta.public` / `meta.admin`. `src/api/client.ts` throws `ApiRequestError(status, code)` and triggers a global redirect to login on any 401 outside `/api/auth/*`. Post-login redirects go through `safeRedirect()`. Visual tokens live in `src/styles/main.css` (`--pl-*`) and `src/theme.ts` (Naive overrides); the yellow `.pl-mark` highlighter is reserved for verification codes. Initial locales are `zh-CN` and `en`; adding one (e.g. `ja`) should only need a new `src/locales/<lang>.ts` plus registering the matching Naive UI locale and date locale. No user-visible string is hard-coded in components. The API returns stable error codes (e.g. `mailbox_quota_exceeded`), and the frontend translates them.

## Testing

Tests run inside workerd via `cloudflareTest()` in `vitest.config.ts`, reading bindings from `wrangler.jsonc`. `test/apply-migrations.ts` applies `migrations/` to the test D1 before each file. Use `api()` / `createUser()` / `login()` from `test/helpers.ts` for HTTP-level tests (it sets a matching `Origin` and a unique `cf-connecting-ip` per call so rate-limit buckets don't collide) and `env.DB` for direct assertions. Storage is reset between tests. In tests `ADMIN_INITIAL_PASSWORD` is `test-admin-password` and Turnstile is disabled (see `vitest.config.ts`). To test the email handler, call it directly with a constructed `ForwardableEmailMessage` stub.
