import type { UserRow } from './repo/users'

export type AppEnv = {
  Bindings: Env
  Variables: {
    user: UserRow
    sessionId: string
  }
}
