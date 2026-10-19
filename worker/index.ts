import { app } from './app'
import { handleEmail } from './email'
import { runCleanup } from './jobs/cleanup'

export default {
  fetch: app.fetch,
  email: handleEmail,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runCleanup(env))
  },
} satisfies ExportedHandler<Env>
