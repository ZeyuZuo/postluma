import { app } from './app'
import { handleEmail } from './email'

export default {
  fetch: app.fetch,
  email: handleEmail,
  async scheduled(_controller, _env, _ctx) {
    // Phase 4: purge messages older than settings.retention_days and expired sessions.
  },
} satisfies ExportedHandler<Env>
