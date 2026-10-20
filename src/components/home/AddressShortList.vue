<script setup lang="ts">
import { CopyOutline } from '@vicons/ionicons5'
import { NIcon, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import { MAILBOX_COUNT_CAP, type PublicMailbox } from '../../../shared/api'
import { copyText } from '@/composables/useClipboard'
import { formatCount, formatRelative } from '@/lib/format'

/** Compact address list for the home page: copy in one click, unread at a glance. */
defineProps<{ mailboxes: PublicMailbox[]; freshId?: string | null }>()

const { t } = useI18n()
const toast = useMessage()

async function copy(address: string): Promise<void> {
  if (await copyText(address)) toast.success(t('common.copied'))
  else toast.warning(t('common.copyFailed'))
}
</script>

<template>
  <ul class="list">
    <li v-for="m in mailboxes" :key="m.id" :class="{ fresh: m.id === freshId }">
      <RouterLink :to="{ name: 'inbox', query: { mailbox: m.id } }" class="main">
        <span class="address pl-mono">
          <span class="local">{{ m.address.split('@')[0] }}</span><span class="domain">@{{ m.address.split('@')[1] }}</span>
        </span>
        <span class="sub">
          <span v-if="m.note" class="note">{{ m.note }}</span>
          <span>{{ m.lastReceivedAt ? t('home.lastReceived', { time: formatRelative(m.lastReceivedAt) }) : t('home.noMailYet') }}</span>
        </span>
      </RouterLink>
      <span v-if="m.unreadCount > 0" class="unread" :aria-label="t('mailboxes.unread', { n: m.unreadCount })">
        {{ formatCount(m.unreadCount, MAILBOX_COUNT_CAP) }}
      </span>
      <button type="button" class="copy" :aria-label="t('home.copyAddressLabel', { address: m.address })" @click="copy(m.address)">
        <NIcon><CopyOutline /></NIcon>
      </button>
    </li>
  </ul>
</template>

<style scoped>
.list {
  list-style: none;
  margin: 0;
  padding: 0;
}
li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 8px 10px 16px;
  border-bottom: 1px solid var(--pl-line);
}
li.fresh {
  animation: arrive 1.6s ease-out;
}
@keyframes arrive {
  from {
    background: var(--pl-code-bg);
  }
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  color: var(--pl-ink);
  text-decoration: none;
}
.main:hover .local {
  text-decoration: underline;
}
.address {
  font-size: 0.875rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.local {
  font-weight: 700;
}
.domain {
  color: var(--pl-faint);
}
.sub {
  display: flex;
  gap: 8px;
  min-width: 0;
  color: var(--pl-muted);
  font-size: 0.75rem;
  white-space: nowrap;
}
.note {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.note::after {
  content: ' ·';
}
.unread {
  flex: none;
  min-width: 22px;
  padding: 0 7px;
  box-sizing: border-box;
  border-radius: 999px;
  background: var(--pl-blue-soft);
  color: var(--pl-blue);
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 22px;
  text-align: center;
}
.copy {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 10px;
  background: none;
  color: var(--pl-muted);
  font-size: 1.0625rem;
  cursor: pointer;
}
.copy:hover {
  background: var(--pl-sunken);
  color: var(--pl-ink);
}
.copy:focus-visible {
  outline: 2px solid var(--pl-blue);
  outline-offset: -2px;
}
@media (prefers-reduced-motion: reduce) {
  li.fresh {
    animation: none;
  }
}
</style>
