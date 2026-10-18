import { ref, watch } from 'vue'

import type { MailboxQuota, MailboxStatus, PublicMailbox } from '../../shared/api'
import { mailboxApi } from '@/api/mailboxes'

const SEARCH_DEBOUNCE_MS = 250

export function useMailboxList(status: MailboxStatus) {
  const items = ref<PublicMailbox[]>([])
  const quota = ref<MailboxQuota | null>(null)
  const query = ref('')
  const nextCursor = ref<string | null>(null)
  const loading = ref(false)
  const loadingMore = ref(false)
  let requestId = 0

  async function reload(): Promise<void> {
    const id = ++requestId
    loading.value = true
    try {
      const res = await mailboxApi.list({ status, q: query.value.trim() || undefined })
      if (id !== requestId) return
      items.value = res.items
      quota.value = res.quota
      nextCursor.value = res.nextCursor
    } finally {
      if (id === requestId) loading.value = false
    }
  }

  async function loadMore(): Promise<void> {
    if (!nextCursor.value) return
    const id = requestId
    loadingMore.value = true
    try {
      const res = await mailboxApi.list({ status, q: query.value.trim() || undefined, cursor: nextCursor.value })
      if (id !== requestId) return // the search changed meanwhile; drop this stale page
      items.value = [...items.value, ...res.items]
      quota.value = res.quota
      nextCursor.value = res.nextCursor
    } finally {
      loadingMore.value = false
    }
  }

  /** Keep a changed mailbox in this list only while it still has this list's status. */
  function apply(mailbox: PublicMailbox): void {
    if (mailbox.status !== status) {
      items.value = items.value.filter((m) => m.id !== mailbox.id)
    } else {
      items.value = items.value.map((m) => (m.id === mailbox.id ? mailbox : m))
    }
  }

  function prepend(mailbox: PublicMailbox): void {
    items.value = [mailbox, ...items.value.filter((m) => m.id !== mailbox.id)]
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  watch(query, () => {
    clearTimeout(timer)
    timer = setTimeout(() => void reload(), SEARCH_DEBOUNCE_MS)
  })

  return { items, quota, query, nextCursor, loading, loadingMore, reload, loadMore, apply, prepend }
}
