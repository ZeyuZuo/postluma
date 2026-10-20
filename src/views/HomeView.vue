<script setup lang="ts">
import { NSkeleton } from 'naive-ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import type { MessageSummary, PublicMailbox } from '../../shared/api'
import { messageApi } from '@/api/messages'
import AddressSwitchList from '@/components/home/AddressSwitchList.vue'
import CurrentPanel from '@/components/home/CurrentPanel.vue'
import NewAddressForm from '@/components/NewAddressForm.vue'
import { useMailboxList } from '@/composables/useMailboxList'
import { currentMailboxId, setCurrentMailbox } from '@/stores/current'
import { boostPolling, inbox } from '@/stores/inbox'

/** Uncopied codes from the last day light up their address in the list. */
const CODE_WINDOW_MS = 24 * 60 * 60 * 1000
const CODE_LOOKUP = 30
/** After creating an address, check for its first mail every 10 s for this long. */
const BOOST_MS = 10 * 60 * 1000

const { t } = useI18n()
const list = useMailboxList('active')
const { items, quota } = list
const listLoaded = ref(false)
const remembered = currentMailboxId()
const recentCodes = ref<MessageSummary[]>([])

/** The remembered address if it is still active, else the newest one. */
const current = computed(() => items.value.find((m) => m.id === remembered.value) ?? items.value[0] ?? null)

/** Newest code per address that hasn't been copied (read) yet. */
const codes = computed(() => {
  const map = new Map<string, MessageSummary>()
  for (const m of recentCodes.value) if (!m.isRead && !map.has(m.mailboxId)) map.set(m.mailboxId, m)
  return map
})

async function loadCodes(): Promise<void> {
  try {
    recentCodes.value = (await messageApi.list({ code: true, limit: CODE_LOOKUP, since: Date.now() - CODE_WINDOW_MS })).items
  } catch {
    // The list still works without code hints.
  }
}

async function reload(): Promise<void> {
  try {
    await list.reload()
  } finally {
    listLoaded.value = true
  }
}

onMounted(() => {
  void reload()
  void loadCodes()
})
watch(() => inbox.arrivals, () => {
  void list.reload() // unread counts and "last received"
  void loadCodes()
})
// Copying a code marks its message read; keep the per-address unread counts in step.
watch(() => inbox.unread, () => void list.reload())

function onCreated(mailbox: PublicMailbox): void {
  list.prepend(mailbox)
  if (quota.value) quota.value = { ...quota.value, used: quota.value.used + 1 }
  boostPolling(BOOST_MS)
}
</script>

<template>
  <div class="home">
    <template v-if="current">
      <div class="panel main">
        <CurrentPanel :mailbox="current" :quota="quota" @created="onCreated" />
      </div>
      <div class="panel side">
        <AddressSwitchList
          :mailboxes="items"
          :current-id="current.id"
          :codes="codes"
          :quota="quota"
          @select="setCurrentMailbox"
        />
      </div>
    </template>

    <section v-else-if="listLoaded" class="panel first" aria-labelledby="first-title">
      <h2 id="first-title">{{ t('home.firstTitle') }}</h2>
      <p>{{ t('home.firstBody') }}</p>
      <NewAddressForm :quota="quota" autofocus @created="onCreated" />
    </section>

    <div v-else class="panel main" aria-hidden="true">
      <NSkeleton text :repeat="2" />
      <NSkeleton height="48px" width="60%" :sharp="false" />
      <NSkeleton text :repeat="3" />
    </div>
  </div>
</template>

<style scoped>
.home {
  display: grid;
  /* minmax(0, …): otherwise a column grows to the widest nowrap line and overflows phones. */
  grid-template-columns: minmax(0, 1fr) minmax(0, 380px);
  align-items: start;
  gap: 24px;
}
.panel {
  border: 1px solid var(--pl-line);
  border-radius: 18px;
  background: var(--pl-surface);
}
.main {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  padding: 24px 26px;
}
.side {
  position: sticky;
  top: 0;
  display: flex;
  max-height: calc(100dvh - var(--pl-chrome, 120px));
  overflow: hidden;
}
.side > * {
  flex: 1;
  min-width: 0;
}
.first {
  grid-column: 1 / -1;
  max-width: 720px;
  padding: 32px;
}
.first h2 {
  margin: 0 0 8px;
  font-size: 1.375rem;
  font-weight: 750;
}
.first p {
  margin: 0 0 20px;
  color: var(--pl-muted);
  line-height: 1.7;
}
@media (max-width: 999px) {
  .home {
    grid-template-columns: minmax(0, 1fr);
  }
  .side {
    position: static;
    max-height: none;
  }
}
@media (max-width: 600px) {
  .main {
    padding: 18px 16px;
  }
  .first {
    padding: 22px 16px;
  }
}
</style>
