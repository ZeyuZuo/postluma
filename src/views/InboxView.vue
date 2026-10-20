<script setup lang="ts">
import { CloseOutline, SearchOutline } from '@vicons/ionicons5'
import { NButton, NIcon, NInput, NSelect, NSpin, useMessage } from 'naive-ui'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { MARK_READ_BATCH, SEARCH_MIN_CHARS, type MessageSummary, type PublicMailbox } from '../../shared/api'
import { errorCodeOf } from '@/api/client'
import { mailboxApi } from '@/api/mailboxes'
import { messageApi } from '@/api/messages'
import MessageDetail from '@/components/MessageDetail.vue'
import MessageRow from '@/components/MessageRow.vue'
import { useIsMobile } from '@/composables/useIsMobile'
import { dayGroup, type DayGroup } from '@/lib/format'
import { inbox, refreshInbox } from '@/stores/inbox'

const SEARCH_DEBOUNCE_MS = 400
/** Safety stop for "mark all read" on a huge backlog (each batch is MARK_READ_BATCH rows). */
const MARK_READ_MAX_BATCHES = 10

type Filter = 'all' | 'unread' | 'code'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const toast = useMessage()
const isMobile = useIsMobile()

const items = ref<MessageSummary[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(false)
const loadingMore = ref(false)
const mailboxes = ref<PublicMailbox[]>([])
const search = ref(typeof route.query.q === 'string' ? route.query.q : '')
const searchInput = ref<InstanceType<typeof NInput> | null>(null)

/** Searches shorter than SEARCH_MIN_CHARS aren't sent (every search scans rows). */
const effectiveQuery = computed(() => {
  const q = search.value.trim()
  return q.length >= SEARCH_MIN_CHARS ? q : undefined
})
const selectedId = computed(() => (typeof route.params.id === 'string' && route.params.id ? route.params.id : null))
const mailboxFilter = computed(() => (typeof route.query.mailbox === 'string' ? route.query.mailbox : null))
const filter = computed<Filter>(() =>
  route.query.filter === 'unread' || route.query.filter === 'code' ? route.query.filter : 'all',
)

const mailboxOptions = computed(() => {
  const active = mailboxes.value.filter((m) => m.status === 'active')
  const disabled = mailboxes.value.filter((m) => m.status === 'disabled')
  const toOption = (m: PublicMailbox) => ({ value: m.id, label: m.address })
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
])

function listParams() {
  return {
    mailbox: mailboxFilter.value,
    q: effectiveQuery.value,
    unread: filter.value === 'unread',
    code: filter.value === 'code',
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

/** Sections by local day, keeping the list order. */
const groups = computed(() => {
  const out: { key: DayGroup; items: MessageSummary[] }[] = []
  for (const m of items.value) {
    const key = dayGroup(m.receivedAt)
    const last = out.at(-1)
    if (last?.key === key) last.items.push(m)
    else out.push({ key, items: [m] })
  }
  return out
})

onMounted(async () => {
  void reload()
  window.addEventListener('keydown', onKey)
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
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

watch([mailboxFilter, filter], () => void reload())
// `previous != null`: the first summary after page load isn't "new mail".
watch(() => inbox.latestReceivedAt, (latest, previous) => {
  if (latest && previous != null && latest !== previous) void pullNew()
})

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

function open(message: MessageSummary): void {
  void router.push({ name: 'inbox', params: { id: message.id }, query: route.query })
}

function closeDetail(): void {
  void router.push({ name: 'inbox', params: {}, query: route.query })
}

/** j/k move through the list, / focuses search, Esc closes the message — never while typing. */
function onKey(e: KeyboardEvent): void {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const target = e.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
  if (e.key === '/') {
    e.preventDefault()
    searchInput.value?.focus()
  } else if (e.key === 'Escape' && selectedId.value) {
    closeDetail()
  } else if (e.key === 'j' || e.key === 'k') {
    const index = items.value.findIndex((m) => m.id === selectedId.value)
    const next = items.value[index === -1 ? 0 : index + (e.key === 'j' ? 1 : -1)]
    if (!next) return
    open(next)
    void nextTick(() => document.querySelector(`[data-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: 'nearest' }))
  }
}

function onReadChanged(id: string, isRead: boolean): void {
  const item = items.value.find((m) => m.id === id)
  if (item) item.isRead = isRead
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
/** Phones show either the list or one message; wider screens slide the message over the list. */
const showList = computed(() => !isMobile.value || !selectedId.value)
</script>

<template>
  <div class="inbox" :class="{ mobile: isMobile }">
    <section v-if="showList" class="list-pane" :aria-label="t('inbox.listLabel')">
      <div class="toolbar">
        <NInput
          ref="searchInput"
          v-model:value="search"
          class="search"
          clearable
          :placeholder="isMobile ? t('inbox.searchPlaceholder') : t('inbox.searchPlaceholderKey')"
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
      </div>

      <NSpin :show="loading" :delay="150" class="list-spin">
        <template v-if="items.length">
          <section v-for="g in groups" :key="g.key" class="group">
            <h2 class="group-label">{{ t(`inbox.day.${g.key}`) }}</h2>
            <ul class="list">
              <MessageRow
                v-for="message in g.items"
                :key="message.id"
                :message="message"
                :selected="message.id === selectedId"
                :show-mailbox="!mailboxFilter"
                @open="open(message)"
              />
            </ul>
          </section>
          <div v-if="nextCursor" class="more">
            <NButton :loading="loadingMore" @click="loadMore">{{ t('common.loadMore') }}</NButton>
          </div>
        </template>
        <p v-else-if="!loading" class="empty">{{ emptyText }}</p>
      </NSpin>
      <p v-if="!isMobile && items.length" class="keys">{{ t('inbox.shortcuts') }}</p>
    </section>

    <Transition name="drawer">
      <aside v-if="selectedId" class="drawer" :aria-label="t('inbox.detailLabel')">
        <NButton v-if="!isMobile" class="close" quaternary circle :aria-label="t('inbox.close')" @click="closeDetail">
          <template #icon><NIcon><CloseOutline /></NIcon></template>
        </NButton>
        <MessageDetail
          :id="selectedId"
          :show-back="isMobile"
          @back="closeDetail"
          @deleted="onDeleted"
          @read-changed="onReadChanged"
        />
      </aside>
    </Transition>
  </div>
</template>

<style scoped>
.inbox {
  position: relative;
  display: flex;
  flex-direction: column;
  height: calc(100dvh - var(--pl-chrome, 120px));
  min-height: 480px;
}
.list-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
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
.list-spin {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--pl-line);
  border-radius: 14px;
  background: var(--pl-surface);
}
.group-label {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0;
  padding: 8px 16px 6px 36px;
  border-bottom: 1px solid var(--pl-line);
  background: var(--pl-surface);
  color: var(--pl-muted);
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.06em;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.empty {
  margin: 0;
  padding: 56px 24px;
  color: var(--pl-muted);
  text-align: center;
  line-height: 1.7;
}
.more {
  display: flex;
  justify-content: center;
  padding: 14px;
}
.keys {
  margin: 8px 4px 0;
  color: var(--pl-faint);
  font-size: 0.75rem;
}
.drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 5;
  width: min(680px, 62%);
  padding: 20px 28px 24px;
  box-sizing: border-box;
  overflow: auto;
  border: 1px solid var(--pl-line);
  border-radius: 16px;
  background: var(--pl-surface);
  box-shadow: -24px 0 48px rgb(19 22 27 / 0.12);
}
:root[data-theme='dark'] .drawer {
  box-shadow: -24px 0 48px rgb(0 0 0 / 0.45);
}
.close {
  position: absolute;
  top: 18px;
  left: 16px;
  z-index: 1;
}
.drawer-enter-active,
.drawer-leave-active {
  transition: transform 0.2s ease-out, opacity 0.2s ease-out;
}
.drawer-enter-from,
.drawer-leave-to {
  transform: translateX(24px);
  opacity: 0;
}
@media (max-width: 1023px) {
  .drawer {
    width: min(680px, 86%);
  }
}
.inbox.mobile {
  height: auto;
  min-height: 0;
}
.inbox.mobile .list-spin {
  overflow: visible;
}
.inbox.mobile .drawer {
  position: static;
  width: auto;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
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
@media (prefers-reduced-motion: reduce) {
  .drawer-enter-active,
  .drawer-leave-active {
    transition: none;
  }
}
</style>
