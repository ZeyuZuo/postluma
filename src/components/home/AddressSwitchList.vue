<script setup lang="ts">
import { CheckmarkOutline, CopyOutline, SearchOutline } from '@vicons/ionicons5'
import { NIcon, useMessage } from 'naive-ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import { MAILBOX_COUNT_CAP, type MailboxQuota, type MessageSummary, type PublicMailbox } from '../../../shared/api'
import CodeChip from '@/components/CodeChip.vue'
import { copyText } from '@/composables/useClipboard'
import { formatCount, formatRelative } from '@/lib/format'

/**
 * Every address in use, doubling as the switcher for the current one. A row shows what needs
 * attention there (unread, a code not copied yet); the current row doesn't repeat its code.
 */
const props = defineProps<{
  mailboxes: PublicMailbox[]
  currentId: string | null
  /** Newest uncopied code per mailbox id. */
  codes: Map<string, MessageSummary>
  quota: MailboxQuota | null
}>()
const emit = defineEmits<{ select: [id: string] }>()

const SEARCH_FROM = 6

const { t } = useI18n()
const toast = useMessage()
const query = ref('')

const visible = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.mailboxes
  return props.mailboxes.filter((m) => m.address.includes(q) || (m.note ?? '').toLowerCase().includes(q))
})

async function copy(m: PublicMailbox): Promise<void> {
  emit('select', m.id)
  if (await copyText(m.address)) toast.success(t('common.copied'))
  else toast.warning(t('common.copyFailed'))
}
</script>

<template>
  <section class="addresses" aria-labelledby="addresses-title">
    <header class="head">
      <h2 id="addresses-title">{{ t('home.myAddresses') }}</h2>
      <span v-if="quota" class="count">{{ quota.used }} / {{ quota.limit }}</span>
      <RouterLink :to="{ name: 'mailboxes' }" class="manage">{{ t('home.manage') }} →</RouterLink>
    </header>

    <label v-if="mailboxes.length > SEARCH_FROM" class="search">
      <NIcon aria-hidden="true"><SearchOutline /></NIcon>
      <span class="visually-hidden">{{ t('home.searchAddresses') }}</span>
      <input v-model="query" type="search" :placeholder="t('home.searchAddresses')" />
    </label>

    <ul class="list">
      <li v-for="m in visible" :key="m.id" :class="{ current: m.id === currentId }">
        <button type="button" class="pick" :aria-pressed="m.id === currentId" @click="emit('select', m.id)">
          <span class="line">
            <span class="address pl-mono"><span class="local">{{ m.address.split('@')[0] }}</span><span class="domain">@{{ m.address.split('@')[1] }}</span></span>
            <NIcon v-if="m.id === currentId" class="check" :aria-label="t('home.isCurrent')"><CheckmarkOutline /></NIcon>
          </span>
          <span class="sub">
            <span v-if="m.note" class="note">{{ m.note }}</span>
            <span>{{ m.lastReceivedAt ? t('home.lastReceived', { time: formatRelative(m.lastReceivedAt) }) : t('home.noMailYet') }}</span>
          </span>
        </button>
        <CodeChip
          v-if="m.id !== currentId && codes.get(m.id)"
          :code="codes.get(m.id)!.verificationCode!"
          :message="codes.get(m.id)!"
        />
        <span v-if="m.unreadCount > 0" class="unread" :title="t('mailboxes.unread', { n: m.unreadCount })">
          {{ formatCount(m.unreadCount, MAILBOX_COUNT_CAP) }}
        </span>
        <button type="button" class="copy" :aria-label="t('home.copyAddressLabel', { address: m.address })" @click="copy(m)">
          <NIcon><CopyOutline /></NIcon>
        </button>
      </li>
      <li v-if="!visible.length" class="empty">{{ t('mailboxes.emptySearch') }}</li>
    </ul>
  </section>
</template>

<style scoped>
.addresses {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 18px 18px 12px;
}
h2 {
  margin: 0;
  color: var(--pl-muted);
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.08em;
}
.count {
  color: var(--pl-faint);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}
.manage {
  margin-left: auto;
  color: var(--pl-blue);
  font-size: 0.8125rem;
  text-decoration: none;
}
.search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 12px 8px;
  padding: 0 10px;
  height: 36px;
  border: 1px solid var(--pl-line);
  border-radius: 9px;
  color: var(--pl-muted);
}
.search:focus-within {
  border-color: var(--pl-blue);
}
.search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--pl-ink);
  font: inherit;
  font-size: 0.875rem;
  outline: none;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0 6px 6px;
  overflow: auto;
}
li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px 2px 0;
  border-radius: 10px;
}
li.current {
  background: var(--pl-sunken);
}
.pick {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 9px 10px;
  border: 0;
  border-radius: 10px;
  background: none;
  color: var(--pl-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
li:not(.current) .pick:hover {
  background: var(--pl-paper);
}
.pick:focus-visible {
  outline: 2px solid var(--pl-blue);
  outline-offset: -2px;
}
.line {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
}
.address {
  min-width: 0;
  font-size: 0.875rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.local {
  font-weight: 700;
}
.domain {
  color: var(--pl-faint);
}
.check {
  flex: none;
  color: var(--pl-ink);
}
.sub {
  display: flex;
  gap: 8px;
  max-width: 100%;
  color: var(--pl-muted);
  font-size: 0.75rem;
  white-space: nowrap;
}
.note {
  min-width: 0;
  color: var(--pl-ink);
  overflow: hidden;
  text-overflow: ellipsis;
}
.unread {
  flex: none;
  min-width: 20px;
  padding: 0 6px;
  box-sizing: border-box;
  border-radius: 999px;
  background: var(--pl-blue-soft);
  color: var(--pl-blue);
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 20px;
  text-align: center;
}
.copy {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 9px;
  background: none;
  color: var(--pl-muted);
  cursor: pointer;
}
.copy:hover {
  background: var(--pl-surface);
  color: var(--pl-ink);
}
.copy:focus-visible {
  outline: 2px solid var(--pl-blue);
  outline-offset: -2px;
}
.empty {
  padding: 16px 10px;
  color: var(--pl-muted);
  font-size: 0.875rem;
}
</style>
