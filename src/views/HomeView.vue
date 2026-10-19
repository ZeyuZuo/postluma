<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRouter } from 'vue-router'

import type { MessageSummary, PublicMailbox } from '../../shared/api'
import { messageApi } from '@/api/messages'
import CodeChip from '@/components/CodeChip.vue'
import MailboxCreator from '@/components/MailboxCreator.vue'
import MailboxItem from '@/components/MailboxItem.vue'
import MessageListItem from '@/components/MessageListItem.vue'
import { useMailboxList } from '@/composables/useMailboxList'
import { formatRelative } from '@/lib/format'
import { inbox } from '@/stores/inbox'
import { session } from '@/stores/session'

const RECENT_MAILBOXES = 5
const LATEST_MESSAGES = 5
const RECENT_CODES = 4
/** Older codes are useless, and the bound keeps the query to a few index rows. */
const CODE_WINDOW_MS = 24 * 60 * 60 * 1000

const { t } = useI18n()
const router = useRouter()
const list = useMailboxList('active')
const { items, quota } = list
const freshId = ref<string | null>(null)
const recent = computed(() => items.value.slice(0, RECENT_MAILBOXES))
const latest = ref<MessageSummary[]>([])
const codes = ref<MessageSummary[]>([])

async function loadMail(): Promise<void> {
  try {
    const [l, c] = await Promise.all([messageApi.list({ limit: LATEST_MESSAGES }), messageApi.list({ code: true, limit: RECENT_CODES, since: Date.now() - CODE_WINDOW_MS })])
    latest.value = l.items
    codes.value = c.items
  } catch {
    // Home stays usable without mail previews.
  }
}

onMounted(() => {
  void list.reload()
  void loadMail()
})
watch(() => inbox.latestReceivedAt, (now, before) => {
  if (now && before != null && now !== before) void loadMail()
})

function onCreated(mailbox: PublicMailbox): void {
  freshId.value = mailbox.id
  list.prepend(mailbox)
  if (quota.value) quota.value = { ...quota.value, used: quota.value.used + 1 }
}

function onChanged(mailbox: PublicMailbox): void {
  list.apply(mailbox)
  if (mailbox.status === 'disabled' && quota.value) quota.value = { ...quota.value, used: quota.value.used - 1 }
}

function openMessage(id: string): void {
  void router.push({ name: 'inbox', params: { id } })
}
</script>

<template>
  <div class="home">
    <h2 class="greeting">{{ t('home.greeting', { name: session.user?.username }) }}</h2>
    <MailboxCreator :quota="quota" @created="onCreated" />

    <section v-if="codes.length" class="codes">
      <header>
        <h3>{{ t('inbox.recentCodes') }}</h3>
      </header>
      <ul class="code-grid">
        <li v-for="m in codes" :key="m.id" class="code-card" @click="openMessage(m.id)">
          <CodeChip :code="m.verificationCode!" size="lg" />
          <span class="code-from">{{ m.fromName || m.fromAddress }}</span>
          <span class="code-meta">
            <span class="pl-mono">{{ m.mailboxAddress }}</span>
            <span>{{ formatRelative(m.receivedAt) }}</span>
          </span>
        </li>
      </ul>
    </section>

    <section class="latest">
      <header>
        <h3>{{ t('inbox.latest') }}</h3>
        <RouterLink :to="{ name: 'inbox' }">{{ t('inbox.viewInbox') }}</RouterLink>
      </header>
      <ul v-if="latest.length" class="list">
        <MessageListItem v-for="m in latest" :key="m.id" :message="m" show-mailbox @open="openMessage(m.id)" />
      </ul>
      <p v-else class="empty">{{ t('inbox.noMail') }}</p>
    </section>

    <section v-if="recent.length" class="recent">
      <header>
        <h3>{{ t('mailboxes.recent') }}</h3>
        <RouterLink :to="{ name: 'mailboxes' }">{{ t('mailboxes.viewAll') }}</RouterLink>
      </header>
      <ul class="list">
        <MailboxItem
          v-for="mailbox in recent"
          :key="mailbox.id"
          :mailbox="mailbox"
          :fresh="mailbox.id === freshId"
          @changed="onChanged"
        />
      </ul>
    </section>
  </div>
</template>

<style scoped>
.home {
  display: grid;
  gap: 28px;
}
.greeting {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 650;
}
section header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10px;
}
h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}
header a {
  color: var(--pl-blue);
  font-size: 0.875rem;
  text-decoration: none;
}
.code-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.code-card {
  display: grid;
  gap: 6px;
  justify-items: start;
  padding: 14px 16px;
  border: 1px solid var(--pl-line);
  border-radius: 10px;
  background: var(--pl-surface);
  cursor: pointer;
}
.code-card:hover {
  border-color: color-mix(in srgb, var(--pl-blue) 40%, var(--pl-line));
}
.code-from {
  font-weight: 600;
  font-size: 0.875rem;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.code-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
  color: var(--pl-muted);
  font-size: 0.75rem;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--pl-line);
  border-radius: 10px;
  background: var(--pl-surface);
  overflow: hidden;
}
.empty {
  margin: 0;
  padding: 24px 16px;
  border: 1px dashed var(--pl-line);
  border-radius: 10px;
  color: var(--pl-muted);
  text-align: center;
}
</style>
