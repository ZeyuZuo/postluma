/**
 * Unread badge + "new mail arrived" signal, shared by the layout, home and inbox. One light poll
 * every 30 s while the tab is visible. It sends the latest arrival it knows, so an unchanged inbox
 * costs the server a single index seek; every RECOUNT_EVERY polls it asks for a real recount to
 * correct any drift from local adjustments (other tabs, devices).
 */
import { reactive, readonly } from 'vue'

import { messageApi } from '@/api/messages'

const POLL_MS = 30_000
const RECOUNT_EVERY = 10

const state = reactive({ unread: 0, latestReceivedAt: null as number | null })
export const inbox = readonly(state)

let polls = 0

export async function refreshInbox(opts: { recount?: boolean } = {}): Promise<void> {
  const recount = opts.recount || polls % RECOUNT_EVERY === 0
  polls += 1
  try {
    const summary = await messageApi.summary({
      known: recount ? undefined : (state.latestReceivedAt ?? undefined),
      recount,
    })
    if (summary.unread !== null) state.unread = summary.unread
    state.latestReceivedAt = summary.latestReceivedAt
  } catch {
    // Transient; the next tick retries. A 401 is handled globally by the API client.
  }
}

export function adjustUnread(delta: number): void {
  state.unread = Math.max(0, state.unread + delta)
}

let timer: ReturnType<typeof setInterval> | undefined
let users = 0

function onVisibility(): void {
  if (document.visibilityState === 'visible') void refreshInbox()
}

export function startInboxPolling(): void {
  users += 1
  if (users > 1) return
  polls = 0
  void refreshInbox()
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') void refreshInbox()
  }, POLL_MS)
  document.addEventListener('visibilitychange', onVisibility)
}

export function stopInboxPolling(): void {
  users = Math.max(0, users - 1)
  if (users > 0) return
  clearInterval(timer)
  document.removeEventListener('visibilitychange', onVisibility)
}
