/**
 * Unread badge + "new mail arrived" signal, shared by the layout, home and inbox. One light poll
 * every 30 s while the tab is visible (10 s for a while after creating an address). It sends the latest arrival it knows, so an unchanged inbox
 * costs the server a single index seek; every RECOUNT_EVERY polls it asks for a real recount to
 * correct any drift from local adjustments (other tabs, devices).
 */
import { reactive, readonly } from 'vue'

import { messageApi } from '@/api/messages'

const POLL_MS = 30_000
/** While boosted (a fresh address is waiting for its first mail), poll this often instead. */
const BOOST_POLL_MS = 10_000
const RECOUNT_EVERY = 10

const state = reactive({ unread: 0, latestReceivedAt: null as number | null, boostUntil: 0 })
export const inbox = readonly(state)

let polls = 0
let lastPoll = 0

export async function refreshInbox(opts: { recount?: boolean } = {}): Promise<void> {
  const recount = opts.recount || polls % RECOUNT_EVERY === 0
  polls += 1
  lastPoll = Date.now()
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

/**
 * Poll every BOOST_POLL_MS for the next `ms` (e.g. right after creating an address, when a code is
 * expected within minutes). Unchanged inboxes still cost one index seek per poll.
 */
export function boostPolling(ms: number): void {
  state.boostUntil = Math.max(state.boostUntil, Date.now() + ms)
}

/** Reactive (reads state), so a computed using it updates as soon as a boost starts. */
export function isBoosted(now = Date.now()): boolean {
  return now < state.boostUntil
}

let timer: ReturnType<typeof setInterval> | undefined
let users = 0

function tick(): void {
  if (document.visibilityState !== 'visible') return
  const now = Date.now()
  const interval = isBoosted(now) ? BOOST_POLL_MS : POLL_MS
  // Small slack so a 10 s timer doesn't skip a 30 s poll by a few milliseconds.
  if (now - lastPoll >= interval - 500) void refreshInbox()
}

function onVisibility(): void {
  if (document.visibilityState === 'visible') void refreshInbox()
}

export function startInboxPolling(): void {
  users += 1
  if (users > 1) return
  polls = 0
  void refreshInbox()
  timer = setInterval(tick, BOOST_POLL_MS)
  document.addEventListener('visibilitychange', onVisibility)
}

export function stopInboxPolling(): void {
  users = Math.max(0, users - 1)
  if (users > 0) return
  clearInterval(timer)
  document.removeEventListener('visibilitychange', onVisibility)
}
