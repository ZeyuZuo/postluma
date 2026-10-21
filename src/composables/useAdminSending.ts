import { ref } from 'vue'

import type { AdminSendingStatus } from '../../shared/api'
import { adminApi } from '@/api/admin'

/**
 * The service-wide sending status, shared by the admin tabs: the domain and user tabs show their
 * "can send" controls only while sending is switched on.
 */
const status = ref<AdminSendingStatus | null>(null)
let pending: Promise<void> | null = null

export function useAdminSending() {
  function load(force = false): Promise<void> {
    if (status.value && !force) return Promise.resolve()
    pending ??= adminApi
      .sending()
      .then((s) => {
        status.value = s
      })
      .catch(() => {
        // Without the status the extra controls simply stay hidden.
      })
      .finally(() => {
        pending = null
      })
    return pending
  }
  const set = (s: AdminSendingStatus) => (status.value = s)
  return { status, load, set }
}
