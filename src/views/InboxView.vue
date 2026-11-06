<script setup lang="ts">
import { CreateOutline, SearchOutline } from '@vicons/ionicons5'
import { NButton, NIcon, NInput, NSelect, useMessage } from 'naive-ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { MARK_READ_BATCH, SEARCH_MIN_CHARS, type MessageSummary, type PublicMailbox } from '../../shared/api'
import { errorCodeOf } from '@/api/client'
import { mailboxApi } from '@/api/mailboxes'
import { messageApi, type MessageQuery } from '@/api/messages'
import ComposePanel from '@/components/ComposePanel.vue'
import MailListLayout from '@/components/MailListLayout.vue'
import MessageDetail from '@/components/MessageDetail.vue'
import MessageRow from '@/components/MessageRow.vue'
import { useMailDrawer } from '@/composables/useMailDrawer'
import { inbox, refreshInbox } from '@/stores/inbox'
import { isPersonal } from '@/stores/mode'
import { canSend, loadOutboxStatus } from '@/stores/outbox'

const SEARCH_DEBOUNCE_MS = 400
/** Safety stop for "mark all read" on a huge backlog (each batch is MARK_READ_BATCH rows). */
const MARK_READ_MAX_BATCHES = 10

type Filter = 'all' | 'unread' | 'code' | 'starred'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const toast = useMessage()

const items = ref<MessageSummary[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(false)
const loadingMore = ref(false)
const mailboxes = ref<PublicMailbox[]>([])
const search = ref(typeof route.query.q === 'string' ? route.query.q : '')
const searchInput = ref<InstanceType<typeof NInput> | null>(null)

const { selectedId, composing, drawerOpen, open, closeDetail, compose, closeDrawer } = useMailDrawer(
  'inbox',
  () => items.value,
  () => searchInput.value?.focus(),
)
void loadOutboxStatus(true)

/** Searches shorter than SEARCH_MIN_CHARS aren't sent (every search scans rows). */
const effectiveQuery = computed(() => {
  const q = search.value.trim()
  return q.length >= SEARCH_MIN_CHARS ? q : undefined
})
const mailboxFilter = computed(() => (typeof route.query.mailbox === 'string' ? route.query.mailbox : null))
const filter = computed<Filter>(() =>
  route.query.filter === 'unread' || route.query.filter === 'code' || (isPersonal() && route.query.filter === 'starred')
    ? route.query.filter
    : 'all',
)
const selectedIsStarred = computed(() => items.value.find((m) => m.id === selectedId.value)?.isStarred)

const mailboxOptions = computed(() => {
  const active = mailboxes.value.filter((m) => m.status === 'active')
  const disabled = mailboxes.value.filter((m) => m.status === 'disabled')
  const toOption = (m: PublicMailbox) => ({ value: m.id, label: m.note ? `${m.address} · ${m.note}` : m.address })
  return [
    { value: '', label: t('inbox.allMailboxes') },
    ...active.map(toOption),
    ...(disabled.length
      ? [{ type: 'group', key: 'disabled', label: t('inbox.disabledGroup'), children: disabled.map(toOption) }]
      : []),
  ]
})

const filters = computed(() => [
  { key: 'all' as const, label: t('inbox.filterAll') },
  {
    key: 'unread' as const,
    // The badge counts every active mailbox; only show it when the list does too.
    label:
      !mailboxFilter.value && inbox.unread > 0
        ? `${t('inbox.filterUnread')} ${inbox.unread > 99 ? '99+' : inbox.unread}`
        : t('inbox.filterUnread'),
  },
  { key: 'code' as const, label: t('inbox.filterCode') },
  ...(isPersonal() ? [{ key: 'starred' as const, label: t('inbox.filterStarred') }] : []),
])

function listParams(): MessageQuery {
  return {
    mailbox: mailboxFilter.value,
    q: effectiveQuery.value,
    unread: filter.value === 'unread',
    code: filter.value === 'code',
    starred: filter.value === 'starred' ? '1' : undefined,
  }
}

let requestId = 0
async function reload(): Promise<void> {
  const id = ++requestId
  loading.value = true
  try {
    const res = await messageApi.list(listParams())
    if (id !== requestId) return
    items.value = res.items
    nextCursor.value = res.nextCursor
  } catch (err) {
    if (id === requestId) toast.error(t(`errors.${errorCodeOf(err)}`))
  } finally {
    if (id === requestId) loading.value = false
  }
}

async function loadMore(): Promise<void> {
  if (!nextCursor.value) return
  const id = requestId
  loadingMore.value = true
  try {
    const res = await messageApi.list({ ...listParams(), cursor: nextCursor.value })
    if (id !== requestId) return
    items.value = [...items.value, ...res.items]
    nextCursor.value = res.nextCursor
  } finally {
    loadingMore.value = false
  }
}

/** Pulls only what arrived after the newest message we already show (cheap, filter-aware). */
async function pullNew(): Promise<void> {
  if (loading.value) return
  const newest = items.value[0]?.receivedAt
  if (newest === undefined) return void reload()
  const id = requestId
  try {
    const res = await messageApi.list({ ...listParams(), since: newest })
    if (id !== requestId) return
    // More than one page arrived (e.g. after the tab was hidden): refresh instead of leaving a gap.
    if (res.nextCursor) return void reload()
    const known = new Set(items.value.map((m) => m.id))
    items.value = [...res.items.filter((m) => !known.has(m.id)), ...items.value]
  } catch {
    // The next poll tries again.
  }
}

onMounted(async () => {
  void reload()
  try {
    const [active, disabled] = await Promise.all([
      mailboxApi.list({ status: 'active' }),
      mailboxApi.list({ status: 'disabled' }),
    ])
    mailboxes.value = [...active.items, ...disabled.items]
  } catch {
    // The filter is optional; the list still works without it.
  }
})

watch([mailboxFilter, filter], () => void reload())
watch(() => inbox.arrivals, () => void pullNew())

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(effectiveQuery, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    void router.replace({ query: { ...route.query, q: value } })
    void reload()
  }, SEARCH_DEBOUNCE_MS)
})

function setMailbox(value: string): void {
  void router.replace({ name: 'inbox', params: {}, query: { ...route.query, mailbox: value || undefined } })
}

function setFilter(value: Filter): void {
  void router.replace({ name: 'inbox', params: {}, query: { ...route.query, filter: value === 'all' ? undefined : value } })
}

function onReadChanged(id: string, isRead: boolean): void {
  const item = items.value.find((m) => m.id === id)
  if (item) item.isRead = isRead
}

function onStarredChanged(id: string, isStarred: boolean): void {
  const item = items.value.find((m) => m.id === id)
  if (item) item.isStarred = isStarred
}

function onDeleted(id: string): void {
  items.value = items.value.filter((m) => m.id !== id)
  closeDetail()
}

async function markAllRead(): Promise<void> {
  try {
    let total = 0
    for (let i = 0; i < MARK_READ_MAX_BATCHES; i++) {
      const { updated } = await messageApi.markAllRead(mailboxFilter.value)
      total += updated
      if (updated < MARK_READ_BATCH) break
    }
    items.value = items.value.map((m) => ({ ...m, isRead: true }))
    toast.success(t('inbox.markedAllRead', total))
    void refreshInbox({ recount: true })
  } catch (err) {
    toast.error(t(`errors.${errorCodeOf(err)}`))
  }
}

const emptyText = computed(() => {
  if (effectiveQuery.value) return t('inbox.emptySearch')
  if (filter.value === 'unread') return t('inbox.emptyUnread')
  if (filter.value === 'code') return t('inbox.emptyCode')
  if (mailboxFilter.value) return t('inbox.emptyMailbox')
  return t('inbox.empty')
})
</script>

<template>
  <MailListLayout
    class="inbox"
    :class="{ personal: isPersonal() }"
    :list-label="t('inbox.listLabel')"
    :drawer-label="composing ? t('compose.newTitle') : t('inbox.detailLabel')"
    :drawer-open="drawerOpen"
    :loading="loading"
    :loading-more="loadingMore"
    :count="items.length"
    :has-more="Boolean(nextCursor)"
    :empty-text="emptyText"
    :hint="t('inbox.shortcuts')"
    @close-drawer="closeDrawer"
    @load-more="loadMore"
  >
    <template #toolbar="{ mobile }">
      <NInput
        ref="searchInput"
        v-model:value="search"
        class="search"
        clearable
        :placeholder="mobile ? t('inbox.searchPlaceholder') : t('inbox.searchPlaceholderKey')"
        :input-props="{ 'aria-label': t('inbox.searchPlaceholder') }"
      >
        <template #prefix><NIcon><SearchOutline /></NIcon></template>
      </NInput>
      <div class="segmented" role="group" :aria-label="t('inbox.filterLabel')">
        <button
          v-for="f in filters"
          :key="f.key"
          type="button"
          :class="{ on: filter === f.key }"
          :aria-pressed="filter === f.key"
          @click="setFilter(f.key)"
        >
          {{ f.label }}
        </button>
        <RouterLink v-if="canSend()" :to="{ name: 'sent' }" class="seg-link">{{ t('compose.sentTab') }}</RouterLink>
      </div>
      <NSelect
        class="mailbox-filter"
        :value="mailboxFilter ?? ''"
        :options="mailboxOptions"
        :aria-label="t('inbox.allMailboxes')"
        :consistent-menu-width="false"
        @update:value="setMailbox"
      />
      <NButton class="mark-all" quaternary @click="markAllRead">{{ t('inbox.markAllRead') }}</NButton>
      <button v-if="canSend()" type="button" class="pl-btn primary" @click="compose">
        <NIcon><CreateOutline /></NIcon>{{ t('compose.newButton') }}
      </button>
    </template>

    <MessageRow
      v-for="message in items"
      :key="message.id"
      :message="message"
      :selected="message.id === selectedId"
      :show-mailbox="!mailboxFilter"
      @open="open(message.id)"
      @starred-changed="onStarredChanged"
    />

    <template #drawer="{ mobile }">
      <ComposePanel v-if="composing && !selectedId" @sent="composing = false" @cancel="composing = false" />
      <MessageDetail
        v-else-if="selectedId"
        :id="selectedId"
        :show-back="mobile"
        :is-starred="selectedIsStarred"
        @back="closeDetail"
        @deleted="onDeleted"
        @read-changed="onReadChanged"
        @starred-changed="onStarredChanged"
      />
    </template>
  </MailListLayout>
</template>

<style scoped>
.search {
  flex: 0 1 300px;
}
.segmented {
  display: flex;
  padding: 3px;
  border: 1px solid var(--pl-line);
  border-radius: 10px;
  background: var(--pl-sunken);
}
.segmented button {
  height: 28px;
  padding: 0 14px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--pl-muted);
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
  white-space: nowrap;
}
.segmented button.on {
  background: var(--pl-surface);
  color: var(--pl-ink);
  font-weight: 650;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
}
.segmented .seg-link {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 14px;
  border-radius: 7px;
  color: var(--pl-muted);
  font-size: 0.8125rem;
  text-decoration: none;
  white-space: nowrap;
}
.segmented .seg-link:hover {
  color: var(--pl-ink);
}
.segmented .seg-link:focus-visible,
.segmented button:focus-visible {
  outline: 2px solid var(--pl-blue);
  outline-offset: -2px;
}
.mailbox-filter {
  width: 220px;
}
.mark-all {
  margin-left: auto;
}
.inbox.mobile .search,
.inbox.mobile .mailbox-filter {
  flex: 1 1 100%;
  width: auto;
  min-width: 0;
}
.inbox.mobile .mailbox-filter {
  order: -1;
}
.inbox.mobile .search {
  order: -2;
}
.inbox.mobile.personal .segmented {
  flex-wrap: wrap;
  max-width: 100%;
  box-sizing: border-box;
}
</style>
