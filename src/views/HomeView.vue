<script setup lang="ts">
import { NSkeleton } from 'naive-ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AddressSwitchList from '@/components/home/AddressSwitchList.vue'
import CurrentPanel from '@/components/home/CurrentPanel.vue'
import NewAddressForm from '@/components/NewAddressForm.vue'
import { createdMailbox } from '@/composables/useCreateMailbox'
import { useMailboxList } from '@/composables/useMailboxList'
import { currentMailboxId, setCurrentMailbox } from '@/stores/current'
import { boostPolling, inbox } from '@/stores/inbox'

/** After creating an address, check for its first mail every 10 s for this long. */
const BOOST_MS = 10 * 60 * 1000

const { t } = useI18n()
const list = useMailboxList('active')
const { items, quota } = list
const listLoaded = ref(false)
const remembered = currentMailboxId()

/** The remembered address if it is still active, else the newest one. */
const current = computed(() => items.value.find((m) => m.id === remembered.value) ?? items.value[0] ?? null)

async function reload(): Promise<void> {
  try {
    await list.reload()
  } finally {
    listLoaded.value = true
  }
}

onMounted(() => void reload())
// Unread dots and "last received".
watch(() => inbox.arrivals, () => void list.reload())
// Copying a code or opening a message marks it read; keep the unread dots in step.
watch(() => inbox.unread, () => void list.reload())

watch(createdMailbox, (mailbox) => {
  if (!mailbox) return
  list.prepend(mailbox)
  if (quota.value) quota.value = { ...quota.value, used: quota.value.used + 1 }
  boostPolling(BOOST_MS)
})
</script>

<template>
  <div class="home">
    <template v-if="current">
      <div class="panel main">
        <CurrentPanel :mailbox="current" :quota="quota" />
      </div>
      <div class="panel side">
        <AddressSwitchList
          :mailboxes="items"
          :current-id="current.id"
          :quota="quota"
          @select="setCurrentMailbox"
        />
      </div>
    </template>

    <section v-else-if="listLoaded" class="panel first" aria-labelledby="first-title">
      <h2 id="first-title">{{ t('home.firstTitle') }}</h2>
      <p>{{ t('home.firstBody') }}</p>
      <NewAddressForm :quota="quota" autofocus />
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
  grid-template-columns: minmax(0, 1fr) minmax(0, 440px);
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
