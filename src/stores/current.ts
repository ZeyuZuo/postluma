/**
 * The address the user is working with right now ("current address" on the home page). It is
 * whatever they last created, copied or picked, remembered per user in this browser; with nothing
 * remembered (or a stale id), the home page falls back to the newest active address.
 */
import { ref } from 'vue'

import { session } from './session'

const PREFIX = 'postluma.current.'
const currentId = ref<string | null>(null)
let loadedFor: string | null = null

function key(): string | null {
  return session.user ? `${PREFIX}${session.user.id}` : null
}

/** The remembered address id for the signed-in user (reactive). */
export function currentMailboxId() {
  const k = key()
  if (k !== loadedFor) {
    loadedFor = k
    try {
      currentId.value = k ? localStorage.getItem(k) : null
    } catch {
      currentId.value = null
    }
  }
  return currentId
}

export function setCurrentMailbox(id: string): void {
  currentMailboxId().value = id
  const k = key()
  try {
    if (k) localStorage.setItem(k, id)
  } catch {
    // Remembered for this visit only.
  }
}
