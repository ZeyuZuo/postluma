/**
 * What this user may send (Phase 9). `canSend` false — the default, and whenever the admin hasn't
 * switched sending on for them — hides every sending control. The server enforces it regardless.
 */
import { reactive, readonly } from 'vue'

import type { OutboxStatus } from '../../shared/api'
import { outboxApi } from '@/api/outbox'
import { session } from './session'

const state = reactive<{ status: OutboxStatus | null; userId: string | null }>({ status: null, userId: null })
let pending: Promise<void> | null = null

export const outbox = readonly(state)

export function canSend(): boolean {
  return state.userId === session.user?.id && Boolean(state.status?.canSend)
}

/** Loads once per signed-in user; `force` after sending (remaining count) or on entering a page. */
export function loadOutboxStatus(force = false): Promise<void> {
  const userId = session.user?.id ?? null
  if (!userId) return Promise.resolve()
  if (!force && state.userId === userId && state.status) return Promise.resolve()
  pending ??= outboxApi
    .status()
    .then((status) => {
      state.status = status
      state.userId = userId
    })
    .catch(() => {
      // Sending controls stay hidden.
    })
    .finally(() => {
      pending = null
    })
  return pending
}
