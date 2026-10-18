import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { beforeEach } from 'vitest'

// The Workers Vitest plugin does not isolate storage between tests on its own:
// wipe every binding and rebuild the schema so each test starts from a fresh database.
beforeEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})
