<script setup lang="ts">
import { CheckmarkDoneOutline, SearchOutline } from '@vicons/ionicons5'
import { NButton, NIcon, NInput, NSelect, NSpin, useMessage } from 'naive-ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { MARK_READ_BATCH, SEARCH_MIN_CHARS, type MessageSummary, type PublicMailbox } from '../../shared/api'
import { errorCodeOf } from '@/api/client'
import { mailboxApi } from '@/api/mailboxes'
import { messageApi } from '@/api/messages'
import MessageDetail from '@/components/MessageDetail.vue'
import MessageListItem from '@/components/MessageListItem.vue'
import { useIsMobile } from '@/composables/useIsMobile'
import { inbox, refreshInbox } from '@/stores/inbox'

const SEARCH_DEBOUNCE_MS = 400
/** Safety stop for "mark all read" on a huge backlog (each batch is MARK_READ_BATCH rows). */
const MARK_READ_MAX_BATCHES = 10

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

/** Searches shorter than SEARCH_MIN_CHARS aren't sent (every search scans rows). */
const effectiveQuery = computed(() => {
  const q = search.value.trim()
  return q.length >= SEARCH_MIN_CHARS ? q : undefined
})
const selectedId = computed(() => (typeof route.params.id === 'string' && route.params.id ? route.params.id : null))
const mailboxFilter = computed(() => (typeof route.query.mailbox === 'string' ? route.query.mailbox : null))

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

let requestId = 0
async function reload(): Promise<void> {
  const id = ++requestId
  loading.value = true
  try {
    const res = await messageApi.list({ mailbox: mailboxFilter.value, q: effectiveQuery.value })
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
    const res = await messageApi.list({ mailbox: mailboxFilter.value, q: effectiveQuery.value, cursor: nextCursor.value })
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
    const res = await messageApi.list({ mailbox: mailboxFilter.value, q: effectiveQuery.value, since: newest })
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

watch(mailboxFilter, () => void reload())
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

function open(message: MessageSummary): void {
  void router.push({ name: 'inbox', params: { id: message.id }, query: route.query })
}

function closeDetail(): void {
  void router.push({ name: 'inbox', params: {}, query: route.query })
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
  if (mailboxFilter.value) return t('inbox.emptyMailbox')
  return t('inbox.empty')
})
const showList = computed(() => !isMobile.value || !selectedId.value)
const showDetail = computed(() => !isMobile.value || !!selectedId.value)
</script>

<template>
  <div class="inbox" :class="{ mobile: isMobile }">
    <section v-if="showList" class="list-pane">
      <div class="filters">
        <NSelect
          class="mailbox-filter"
          :value="mailboxFilter ?? ''"
          :options="mailboxOptions"
          :aria-label="t('inbox.allMailboxes')"
          :consistent-menu-width="false"
          @update:value="setMailbox"
        />
        <NButton quaternary circle :title="t('inbox.markAllRead')" :aria-label="t('inbox.markAllRead')" @click="markAllRead">
          <template #icon><NIcon><CheckmarkDoneOutline /></NIcon></template>
        </NButton>
      </div>
      <NInput v-model:value="search" clearable :placeholder="t('inbox.searchPlaceholder')" class="search">
        <template #prefix><NIcon><SearchOutline /></NIcon></template>
      </NInput>
      <NSpin :show="loading" :delay="150" class="list-spin">
        <ul v-if="items.length" class="list">
          <MessageListItem
            v-for="message in items"
            :key="message.id"
            :message="message"
            :selected="message.id === selectedId"
            :show-mailbox="!mailboxFilter"
            @open="open(message)"
          />
        </ul>
        <p v-else-if="!loading" class="empty">{{ emptyText }}</p>
      </NSpin>
      <div v-if="nextCursor" class="more">
        <NButton :loading="loadingMore" @click="loadMore">{{ t('common.loadMore') }}</NButton>
      </div>
    </section>

    <section v-if="showDetail" class="detail-pane">
      <MessageDetail
        v-if="selectedId"
        :id="selectedId"
        :show-back="isMobile"
        @back="closeDetail"
        @deleted="onDeleted"
        @read-changed="onReadChanged"
      />
      <p v-else class="hint">{{ t('inbox.selectHint') }}</p>
    </section>
  </div>
</template>

<style scoped>
.inbox {
  display: grid;
  grid-template-columns: minmax(300px, 380px) minmax(0, 1fr);
  gap: 24px;
  height: calc(100vh - 60px - 56px);
  min-height: 520px;
}
.inbox.mobile {
  /* minmax(0, …): nowrap subjects must not widen the column past the viewport */
  grid-template-columns: minmax(0, 1fr);
  height: auto;
}
.list-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.filters {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.mailbox-filter {
  flex: 1;
  min-width: 0;
}
.search {
  margin-bottom: 12px;
}
.list-spin {
  flex: 1;
  min-height: 0;
  overflow: auto;
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
  padding: 40px 16px;
  border: 1px dashed var(--pl-line);
  border-radius: 10px;
  color: var(--pl-muted);
  text-align: center;
  line-height: 1.7;
}
.more {
  display: flex;
  justify-content: center;
  padding-top: 12px;
}
.detail-pane {
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
.hint {
  display: grid;
  place-items: center;
  height: 100%;
  margin: 0;
  color: var(--pl-muted);
}
@media (max-width: 1023px) and (min-width: 768px) {
  .inbox {
    grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
    gap: 16px;
  }
}
</style>
