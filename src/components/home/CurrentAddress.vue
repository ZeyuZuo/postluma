<script setup lang="ts">
import { CopyOutline } from '@vicons/ionicons5'
import { NIcon, useMessage } from 'naive-ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import type { MessageSummary, PublicMailbox } from '../../../shared/api'
import { messageApi } from '@/api/messages'
import CodeChip from '@/components/CodeChip.vue'
import { copyText } from '@/composables/useClipboard'
import { formatRelative } from '@/lib/format'
import { inbox, isBoosted } from '@/stores/inbox'

/** The address the user is most likely signing up with right now, and the mail it receives. */
const props = defineProps<{ mailbox: PublicMailbox }>()

const LIVE_ITEMS = 3

const { t } = useI18n()
const toast = useMessage()
const mail = ref<MessageSummary[]>([])
const loaded = ref(false)

const local = computed(() => props.mailbox.address.split('@')[0])
const domain = computed(() => props.mailbox.address.split('@')[1])
const alias = computed(() => `${local.value}+shop@${domain.value}`)
// Ticks so the status follows the end of the boost and relative times stay current.
const now = ref(Date.now())
const ticker = setInterval(() => (now.value = Date.now()), 10_000)
onBeforeUnmount(() => clearInterval(ticker))
const listening = computed(() => isBoosted(now.value))

let request = 0
async function load(): Promise<void> {
  const id = ++request
  try {
    const res = await messageApi.list({ mailbox: props.mailbox.id, limit: LIVE_ITEMS })
    if (id === request) mail.value = res.items
  } catch {
    // The panel still shows the address.
  } finally {
    if (id === request) loaded.value = true
  }
}

watch(() => props.mailbox.id, () => {
  loaded.value = false
  mail.value = []
  void load()
}, { immediate: true })
watch(() => inbox.latestReceivedAt, (now, before) => {
  if (now && now !== before) void load()
})

async function copy(text: string): Promise<void> {
  if (await copyText(text)) toast.success(t('common.copied'))
  else toast.warning(t('common.copyFailed'))
}
</script>

<template>
  <section class="current" aria-labelledby="current-title">
    <header class="head">
      <h2 id="current-title">{{ t('home.current') }}</h2>
      <span class="status" :class="{ fast: listening }">
        <span class="dot" aria-hidden="true" />
        {{ listening ? t('home.listeningFast') : t('home.listening') }}
      </span>
    </header>

    <div class="address-row">
      <p class="address">
        <span class="local">{{ local }}</span><span class="domain">@{{ domain }}</span>
      </p>
      <div class="actions">
        <button type="button" class="ghost" @click="copy(mailbox.address)">
          <NIcon><CopyOutline /></NIcon>{{ t('home.copyAddress') }}
        </button>
        <button v-if="mailbox.acceptSubaddress" type="button" class="ghost" :title="alias" @click="copy(alias)">
          {{ t('home.copyAlias') }} <span class="pl-mono">+shop</span>
        </button>
      </div>
    </div>

    <ul v-if="mail.length" class="live">
      <li v-for="m in mail" :key="m.id" :class="{ unread: !m.isRead }">
        <RouterLink :to="{ name: 'inbox', params: { id: m.id } }" class="live-link">
          <span class="from">{{ m.fromName || m.fromAddress }}</span>
          <span class="subject">{{ m.subject || t('inbox.noSubject') }}</span>
        </RouterLink>
        <CodeChip v-if="m.verificationCode" :code="m.verificationCode" />
        <span class="time">{{ formatRelative(m.receivedAt, now) }}</span>
      </li>
    </ul>
    <p v-else-if="loaded" class="waiting">{{ t('home.waiting') }}</p>
    <RouterLink v-if="mail.length" :to="{ name: 'inbox', query: { mailbox: mailbox.id } }" class="more">
      {{ t('home.allMailOfAddress') }} →
    </RouterLink>
  </section>
</template>

<style scoped>
.current {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
h2 {
  margin: 0;
  color: var(--pl-muted);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #2f9e62;
}
.status.fast .dot {
  animation: pulse 1.6s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    box-shadow: 0 0 0 5px color-mix(in srgb, #2f9e62 18%, transparent);
  }
}
.address-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 20px;
}
.address {
  flex: 1 1 360px;
  min-width: 0;
  margin: 0;
  font-family: var(--pl-mono);
  font-size: 1.875rem;
  line-height: 1.2;
  overflow-wrap: anywhere;
}
.local {
  font-weight: 700;
}
.domain {
  color: var(--pl-faint);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 14px;
  border: 1px solid var(--pl-line);
  border-radius: 10px;
  background: var(--pl-surface);
  color: var(--pl-ink);
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
}
.ghost:hover {
  border-color: color-mix(in srgb, var(--pl-blue) 45%, var(--pl-line));
}
.ghost:focus-visible {
  outline: 2px solid var(--pl-blue);
  outline-offset: 2px;
}
.ghost .pl-mono {
  color: var(--pl-muted);
}
.live {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--pl-line);
}
.live li {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  border-bottom: 1px solid var(--pl-line);
}
.live-link {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 12px;
  color: var(--pl-ink);
  text-decoration: none;
}
.live-link:hover .subject {
  text-decoration: underline;
}
.from {
  flex: none;
  max-width: 30%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.unread .from {
  font-weight: 700;
}
.subject {
  min-width: 0;
  color: var(--pl-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.time {
  flex: none;
  color: var(--pl-muted);
  font-size: 0.75rem;
}
.waiting {
  margin: 0;
  padding: 14px;
  border: 1px dashed var(--pl-line);
  border-radius: 10px;
  color: var(--pl-muted);
  font-size: 0.875rem;
  text-align: center;
}
.more {
  align-self: flex-start;
  color: var(--pl-blue);
  font-size: 0.8125rem;
  text-decoration: none;
}
@media (max-width: 600px) {
  .address {
    font-size: 1.25rem;
  }
  .from {
    max-width: 40%;
  }
  .live-link {
    flex-direction: column;
    gap: 0;
  }
  .from {
    max-width: 100%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .status.fast .dot {
    animation: none;
  }
}
</style>
