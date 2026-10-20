<script setup lang="ts">
import { AddOutline, CloseOutline, CopyOutline } from '@vicons/ionicons5'
import { NIcon, NModal, useMessage } from 'naive-ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import type { MailboxQuota, MessageSummary, PublicMailbox } from '../../../shared/api'
import { messageApi } from '@/api/messages'
import MessageDetail from '@/components/MessageDetail.vue'
import NewAddressForm from '@/components/NewAddressForm.vue'
import { copyText } from '@/composables/useClipboard'
import { useCopyCode } from '@/composables/useCopyCode'
import { useCreateMailbox } from '@/composables/useCreateMailbox'
import { formatRelative } from '@/lib/format'
import { inbox, isBoosted } from '@/stores/inbox'

/**
 * The address in use and what it receives. The newest code is the one thing in amber, and only
 * until it is copied; the mail list below never repeats it. Mail opens in a dialog on this page.
 */
const props = defineProps<{ mailbox: PublicMailbox; quota: MailboxQuota | null }>()
const emit = defineEmits<{ created: [mailbox: PublicMailbox] }>()

const LIVE_ITEMS = 5
/** A code older than this is no longer "the code you're waiting for". */
const CODE_FRESH_MS = 24 * 60 * 60 * 1000

const { t } = useI18n()
const toast = useMessage()
const copyCode = useCopyCode()
const { create, busy } = useCreateMailbox()
const mail = ref<MessageSummary[]>([])
const loaded = ref(false)
const customOpen = ref(false)
/** Mail opens in a dialog here; the inbox is one link away. */
const openId = ref<string | null>(null)

const now = ref(Date.now())
const ticker = setInterval(() => (now.value = Date.now()), 10_000)
onBeforeUnmount(() => clearInterval(ticker))

const local = computed(() => props.mailbox.address.split('@')[0])
const domain = computed(() => props.mailbox.address.split('@')[1])
const listening = computed(() => isBoosted(now.value))
const latestCode = computed(() =>
  mail.value.find((m) => m.verificationCode && now.value - m.receivedAt < CODE_FRESH_MS) ?? null,
)

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
  customOpen.value = false
  void load()
}, { immediate: true })
watch(() => inbox.arrivals, () => void load())

async function copyAddress(): Promise<void> {
  if (await copyText(props.mailbox.address)) toast.success(t('common.copied'))
  else toast.warning(t('common.copyFailed'))
}

async function createRandom(): Promise<void> {
  const mailbox = await create()
  if (mailbox) emit('created', mailbox)
}

function onReadChanged(id: string, isRead: boolean): void {
  const item = mail.value.find((m) => m.id === id)
  if (item) item.isRead = isRead
}

function onDeleted(id: string): void {
  mail.value = mail.value.filter((m) => m.id !== id)
  openId.value = null
}

function onCreated(mailbox: PublicMailbox): void {
  customOpen.value = false
  emit('created', mailbox)
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

    <div class="address-block">
      <div class="address-text">
        <p class="address"><span class="local">{{ local }}</span><wbr /><span class="domain">@{{ domain }}</span></p>
        <p v-if="mailbox.note" class="note">{{ mailbox.note }}</p>
      </div>
      <RouterLink :to="{ name: 'inbox', query: { mailbox: mailbox.id } }" class="all-mail">
        {{ t('home.allMailOfAddress') }} →
      </RouterLink>
    </div>

    <div class="actions">
      <button type="button" class="pl-btn primary" @click="copyAddress">
        <NIcon><CopyOutline /></NIcon>{{ t('home.copyAddress') }}
      </button>
      <button type="button" class="pl-btn" :disabled="busy" @click="createRandom">
        <NIcon><AddOutline /></NIcon>{{ t('home.newRandom') }}
      </button>
      <button type="button" class="pl-btn" :aria-expanded="customOpen" @click="customOpen = !customOpen">
        {{ t('home.customPrefix') }}
      </button>
    </div>
    <NewAddressForm v-if="customOpen" :quota="quota" autofocus class="custom" @created="onCreated" />

    <button
      v-if="latestCode"
      type="button"
      class="code-block"
      :class="{ fresh: !latestCode.isRead }"
      :aria-label="t('home.copyCodeLabel', { code: latestCode.verificationCode })"
      @click="copyCode(latestCode.verificationCode!, latestCode)"
    >
      <span class="code-main">
        <span class="code-label">{{ latestCode.isRead ? t('home.latestCodeRead') : t('home.latestCode') }}</span>
        <span class="code-digits">{{ latestCode.verificationCode }}</span>
      </span>
      <span class="code-meta">{{ latestCode.fromName || latestCode.fromAddress }} · {{ formatRelative(latestCode.receivedAt, now) }}</span>
      <span class="code-action"><NIcon><CopyOutline /></NIcon>{{ t('inbox.clickToCopy') }}</span>
    </button>

    <div class="mail">
      <h3>{{ t('home.mailOfAddress') }}</h3>
      <ul v-if="mail.length">
        <li v-for="m in mail" :key="m.id" :class="{ unread: !m.isRead }">
          <button type="button" class="mail-link" @click="openId = m.id">
            <span class="dot" aria-hidden="true" />
            <span class="from">{{ m.fromName || m.fromAddress }}</span>
            <span class="subject">{{ m.subject || t('inbox.noSubject') }}</span>
            <span v-if="m.verificationCode && m.id !== latestCode?.id" class="mini-code pl-mono">{{ m.verificationCode }}</span>
            <span class="time">{{ formatRelative(m.receivedAt, now) }}</span>
          </button>
        </li>
      </ul>
      <p v-else-if="loaded" class="waiting">{{ t('home.waiting') }}</p>
    </div>

    <NModal :show="openId !== null" :auto-focus="false" @update:show="(v: boolean) => { if (!v) openId = null }">
      <div class="mail-dialog" role="dialog" :aria-label="t('inbox.detailLabel')">
        <button type="button" class="dialog-close" :aria-label="t('inbox.close')" @click="openId = null">
          <NIcon><CloseOutline /></NIcon>
        </button>
        <MessageDetail v-if="openId" :id="openId" @deleted="onDeleted" @read-changed="onReadChanged" />
      </div>
    </NModal>
  </section>
</template>

<style scoped>
.current {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
h2,
h3 {
  margin: 0;
  color: var(--pl-muted);
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.08em;
}
.status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.status .dot {
  width: 7px;
  height: 7px;
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
.address-block {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  min-width: 0;
}
.address-text {
  flex: 1;
  min-width: 0;
}
.all-mail {
  flex: none;
  margin-top: 0.6rem;
  color: var(--pl-blue);
  font-size: 0.875rem;
  text-decoration: none;
  white-space: nowrap;
}
.all-mail:hover {
  text-decoration: underline;
}
.address {
  margin: 0;
  font-family: var(--pl-mono);
  font-size: 2rem;
  line-height: 1.2;
  overflow-wrap: anywhere;
}
.local {
  font-weight: 700;
}
.domain {
  color: var(--pl-faint);
}
.note {
  margin: 6px 0 0;
  color: var(--pl-muted);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.code-block {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 20px;
  width: 100%;
  padding: 14px 20px;
  border: 1px solid var(--pl-line);
  border-radius: 14px;
  background: var(--pl-paper);
  color: var(--pl-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.code-block.fresh {
  border-color: var(--pl-code-line);
  background: var(--pl-code-bg);
}
.code-block:focus-visible {
  outline: 2px solid var(--pl-blue);
  outline-offset: 2px;
}
.code-main {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}
.code-label {
  color: var(--pl-muted);
  font-size: 0.75rem;
  font-weight: 650;
}
.code-digits {
  font-family: var(--pl-mono);
  font-size: 2.25rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  line-height: 1.15;
  color: var(--pl-muted);
}
.code-block.fresh .code-digits {
  color: var(--pl-ink);
}
:root[data-theme='dark'] .code-block.fresh .code-digits {
  color: var(--pl-signal);
}
.code-meta {
  flex: 1 1 140px;
  min-width: 0;
  align-self: flex-end;
  padding-bottom: 6px;
  color: var(--pl-muted);
  font-size: 0.8125rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.code-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.code-block.fresh .code-action {
  color: var(--pl-ink);
  font-weight: 650;
}
.mail {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mail ul {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--pl-line);
}
.mail li {
  border-bottom: 1px solid var(--pl-line);
}
.mail-link {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 44px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--pl-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.mail-link:focus-visible {
  outline: 2px solid var(--pl-blue);
  outline-offset: -2px;
}
.mail-link:hover .subject {
  text-decoration: underline;
}
.mail-link .dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.unread .mail-link .dot {
  background: var(--pl-blue);
}
.from {
  flex: none;
  max-width: 28%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.unread .from,
.unread .subject {
  font-weight: 650;
}
.subject {
  flex: 1;
  min-width: 0;
  color: var(--pl-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.unread .subject {
  color: var(--pl-ink);
}
.mini-code {
  flex: none;
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.time {
  flex: none;
  color: var(--pl-muted);
  font-size: 0.75rem;
}
.waiting {
  margin: 0;
  padding: 18px 14px;
  border: 1px dashed var(--pl-line);
  border-radius: 12px;
  color: var(--pl-muted);
  font-size: 0.875rem;
  text-align: center;
}
.mail-dialog {
  position: relative;
  width: min(880px, calc(100vw - 32px));
  max-height: calc(100dvh - 64px);
  padding: 20px 28px 24px;
  box-sizing: border-box;
  overflow: auto;
  border-radius: 16px;
  background: var(--pl-surface);
  box-shadow: 0 24px 60px rgb(0 0 0 / 0.22);
}
.dialog-close {
  position: absolute;
  top: 21px;
  left: 18px;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  background: var(--pl-surface);
  color: var(--pl-muted);
  font-size: 20px;
  cursor: pointer;
}
.dialog-close:hover {
  background: var(--pl-sunken);
  color: var(--pl-ink);
}
@media (max-width: 600px) {
  .address {
    font-size: 1.125rem;
  }
  .all-mail {
    margin-top: 0.15rem;
  }
  .mail-dialog {
    width: 100vw;
    max-height: 100dvh;
    height: 100dvh;
    padding: 16px;
    border-radius: 0;
  }
  .actions .pl-btn {
    flex: 1 1 auto;
  }
  .code-block {
    padding: 12px 16px;
  }
  .code-digits {
    font-size: 1.875rem;
  }
  .from {
    max-width: 40%;
  }
  .mini-code {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .status.fast .dot {
    animation: none;
  }
}
</style>
