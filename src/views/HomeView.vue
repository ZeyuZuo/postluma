<script setup lang="ts">
import { NSkeleton } from 'naive-ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import type { MessageSummary, PublicMailbox } from '../../shared/api'
import { messageApi } from '@/api/messages'
import AddressCommand from '@/components/AddressCommand.vue'
import AddressShortList from '@/components/home/AddressShortList.vue'
import CodeTiles from '@/components/home/CodeTiles.vue'
import CurrentAddress from '@/components/home/CurrentAddress.vue'
import { useMailboxList } from '@/composables/useMailboxList'
import { boostPolling, inbox } from '@/stores/inbox'

const SHORT_LIST = 6
const RECENT_CODES = 6
/** Older codes are useless, and the bound keeps the query to a few index rows. */
const CODE_WINDOW_MS = 24 * 60 * 60 * 1000
/** After creating an address, check for its first mail every 10 s for this long. */
const BOOST_MS = 10 * 60 * 1000

const { t } = useI18n()
const list = useMailboxList('active')
const { items, quota } = list
const freshId = ref<string | null>(null)
const codes = ref<MessageSummary[]>([])
const codesLoaded = ref(false)

/** The address being signed up with: the one just created, else the newest active one. */
const current = computed(() => items.value.find((m) => m.id === freshId.value) ?? items.value[0] ?? null)
const shortList = computed(() => items.value.slice(0, SHORT_LIST))

async function loadCodes(): Promise<void> {
  try {
    codes.value = (await messageApi.list({ code: true, limit: RECENT_CODES, since: Date.now() - CODE_WINDOW_MS })).items
  } catch {
    // Home stays usable without codes.
  } finally {
    codesLoaded.value = true
  }
}

onMounted(() => {
  void list.reload()
  void loadCodes()
})
watch(() => inbox.arrivals, () => {
  void loadCodes()
  void list.reload() // unread counts and "last received"
})

function onCreated(mailbox: PublicMailbox): void {
  freshId.value = mailbox.id
  list.prepend(mailbox)
  if (quota.value) quota.value = { ...quota.value, used: quota.value.used + 1 }
  boostPolling(BOOST_MS)
}
</script>

<template>
  <div class="home">
    <section class="panel hero" :aria-label="t('home.newAddress')">
      <AddressCommand :quota="quota" @created="onCreated" />
      <CurrentAddress v-if="current" :mailbox="current" class="current" />
    </section>

    <div class="columns">
      <section class="codes" aria-labelledby="codes-title">
        <header class="section-head">
          <h2 id="codes-title">{{ t('home.codes') }}</h2>
          <span class="hint">{{ t('home.codesHint') }}</span>
        </header>
        <CodeTiles v-if="codes.length" :messages="codes" />
        <p v-else-if="codesLoaded" class="empty">{{ t('home.noCodes') }}</p>
        <div v-else class="tile-skeletons" aria-hidden="true">
          <NSkeleton v-for="i in 2" :key="i" height="128px" :sharp="false" />
        </div>
      </section>

      <section class="addresses" aria-labelledby="addresses-title">
        <header class="section-head">
          <h2 id="addresses-title">{{ t('home.addresses') }}</h2>
          <RouterLink :to="{ name: 'mailboxes' }" class="link">{{ t('home.manage') }} →</RouterLink>
        </header>
        <div class="panel flush">
          <AddressShortList v-if="shortList.length" :mailboxes="shortList" :fresh-id="freshId" />
          <p v-else class="empty plain">{{ t('mailboxes.emptyActive') }}</p>
          <RouterLink :to="{ name: 'inbox' }" class="inbox-link">
            <span>{{ inbox.unread > 0 ? t('home.unreadMail', { n: inbox.unread > 99 ? '99+' : inbox.unread }) : t('home.noUnread') }}</span>
            <span class="link">{{ t('inbox.viewInbox') }} →</span>
          </RouterLink>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.home {
  display: grid;
  /* minmax(0, …): otherwise the column grows to the widest nowrap line and overflows phones. */
  grid-template-columns: minmax(0, 1fr);
  gap: 28px;
}
.panel {
  border: 1px solid var(--pl-line);
  border-radius: 18px;
  background: var(--pl-surface);
}
.hero {
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding: 22px 24px;
}
.current {
  padding-top: 20px;
  border-top: 1px solid var(--pl-line);
}
.columns {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 28px;
}
.codes {
  flex: 7 1 520px;
  min-width: 0;
}
.addresses {
  flex: 5 1 340px;
  min-width: 0;
}
.section-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 12px;
}
h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 750;
  letter-spacing: -0.01em;
}
.hint {
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.link {
  margin-left: auto;
  color: var(--pl-blue);
  font-size: 0.875rem;
  text-decoration: none;
}
.flush {
  overflow: hidden;
}
.inbox-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  color: var(--pl-ink);
  font-weight: 650;
  text-decoration: none;
}
.inbox-link:hover .link {
  text-decoration: underline;
}
.empty {
  margin: 0;
  padding: 28px 16px;
  border: 1px dashed var(--pl-line);
  border-radius: 14px;
  color: var(--pl-muted);
  text-align: center;
}
.empty.plain {
  border: 0;
  border-bottom: 1px solid var(--pl-line);
  border-radius: 0;
}
.tile-skeletons {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr));
  gap: 12px;
}
.tile-skeletons :deep(.n-skeleton) {
  border-radius: 14px;
}
@media (max-width: 600px) {
  .hero {
    padding: 16px;
  }
  .home,
  .columns {
    gap: 22px;
  }
}
</style>
