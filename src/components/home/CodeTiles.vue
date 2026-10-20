<script setup lang="ts">
import { CopyOutline } from '@vicons/ionicons5'
import { NIcon, useMessage } from 'naive-ui'
import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import type { MessageSummary } from '../../../shared/api'
import { copyText } from '@/composables/useClipboard'
import { formatRelative } from '@/lib/format'

/** Recent verification codes as large tiles: the code copies, the subject opens the message. */
defineProps<{ messages: MessageSummary[] }>()

/** A code this recent is most likely the one being waited for. */
const FRESH_MS = 10 * 60 * 1000

const { t } = useI18n()
const toast = useMessage()
const now = ref(Date.now())
const ticker = setInterval(() => (now.value = Date.now()), 30_000)
onBeforeUnmount(() => clearInterval(ticker))

async function copy(code: string): Promise<void> {
  if (await copyText(code)) toast.success(t('inbox.codeCopied', { code }))
  else toast.warning(t('common.copyFailed'))
}

const prefix = (address: string) => address.split('@')[0]
</script>

<template>
  <ul class="tiles">
    <li v-for="m in messages" :key="m.id" class="tile" :class="{ fresh: now - m.receivedAt < FRESH_MS }">
      <div class="meta">
        <span class="from">{{ m.fromName || m.fromAddress }}</span>
        <span class="to pl-mono">→ {{ prefix(m.mailboxAddress) }}</span>
        <span class="time">{{ formatRelative(m.receivedAt, now) }}</span>
      </div>
      <button type="button" class="code" :aria-label="t('home.copyCodeLabel', { code: m.verificationCode })" @click="copy(m.verificationCode!)">
        <span class="digits">{{ m.verificationCode }}</span>
        <NIcon class="copy" aria-hidden="true"><CopyOutline /></NIcon>
      </button>
      <RouterLink :to="{ name: 'inbox', params: { id: m.id } }" class="subject">{{ m.subject || t('inbox.noSubject') }}</RouterLink>
    </li>
  </ul>
</template>

<style scoped>
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr));
  gap: 12px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.tile {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 14px 16px 12px;
  border: 1px solid var(--pl-line);
  border-radius: 14px;
  background: var(--pl-surface);
}
.tile.fresh {
  border-color: var(--pl-code-line);
  background: var(--pl-code-bg);
  box-shadow: 0 0 0 1px var(--pl-code-line);
}
.meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  color: var(--pl-muted);
  font-size: 0.75rem;
}
.from {
  min-width: 0;
  color: var(--pl-ink);
  font-size: 0.8125rem;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.to {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.time {
  margin-left: auto;
  flex: none;
}
.fresh .time {
  color: var(--pl-ink);
  font-weight: 650;
}
.code {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  margin: 2px 0;
  padding: 4px 6px 4px 0;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--pl-ink);
  cursor: pointer;
  text-align: left;
}
.digits {
  font-family: var(--pl-mono);
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  line-height: 1.15;
  overflow-wrap: anywhere;
  background-image: linear-gradient(var(--pl-mark), var(--pl-mark));
  background-repeat: no-repeat;
  background-position: 0 70%;
  background-size: 100% 0.45em;
  color: #13161b;
}
:root[data-theme='dark'] .digits {
  background: none;
  color: var(--pl-signal);
}
.copy {
  flex: none;
  color: var(--pl-faint);
  font-size: 1.25rem;
}
.code:hover .copy,
.code:focus-visible .copy {
  color: var(--pl-blue);
}
.code:focus-visible {
  outline: 2px solid var(--pl-blue);
  outline-offset: 2px;
}
.subject {
  color: var(--pl-muted);
  font-size: 0.8125rem;
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.subject:hover {
  color: var(--pl-blue);
  text-decoration: underline;
}
</style>
