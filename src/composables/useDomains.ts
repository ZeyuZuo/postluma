import { computed, ref, watch } from 'vue'

import type { PublicDomain } from '../../shared/api'
import { mailboxApi } from '@/api/mailboxes'

const DOMAIN_KEY = 'postluma.domain'
const domains = ref<PublicDomain[]>([])
const loaded = ref(false)
const domainId = ref<string | null>(null)
let pending: Promise<void> | null = null

watch(domainId, (id) => {
  try {
    if (id) localStorage.setItem(DOMAIN_KEY, id)
  } catch {
    // ignore
  }
})

/** Enabled receiving domains (loaded once per page load) and the remembered choice. */
export function useDomains() {
  if (!pending) {
    pending = mailboxApi
      .domains()
      .then((res) => {
        domains.value = res.items
        let remembered: string | null = null
        try {
          remembered = localStorage.getItem(DOMAIN_KEY)
        } catch {
          // ignore
        }
        domainId.value = res.items.find((d) => d.id === remembered)?.id ?? res.items[0]?.id ?? null
      })
      .catch(() => {
        pending = null // retry on the next use
      })
      .finally(() => {
        loaded.value = true
      })
  }
  const selected = computed(() => domains.value.find((d) => d.id === domainId.value) ?? null)
  return { domains, loaded, domainId, selected }
}
