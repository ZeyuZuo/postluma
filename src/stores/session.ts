import { reactive, readonly } from 'vue'

import type { PublicUser } from '../../shared/api'
import { authApi } from '@/api/auth'
import { ApiRequestError } from '@/api/client'
import { applyLocale } from '@/i18n'

const state = reactive<{ user: PublicUser | null; loaded: boolean }>({ user: null, loaded: false })

export const session = readonly(state)

export function setUser(user: PublicUser | null): void {
  state.user = user
  state.loaded = true
  if (user?.locale) applyLocale(user.locale)
}

export async function loadSession(): Promise<void> {
  try {
    setUser((await authApi.me()).user)
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) setUser(null)
    else throw err
  }
}

export async function logout(): Promise<void> {
  await authApi.logout()
  setUser(null)
}
