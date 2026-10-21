<script setup lang="ts">
import { CloseOutline, CreateOutline } from '@vicons/ionicons5'
import { NButton, NIcon, NSpin, NTag, useMessage } from 'naive-ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import type { SentMessageDetail, SentMessageSummary } from '../../shared/api'
import { errorCodeOf } from '@/api/client'
import { outboxApi } from '@/api/outbox'
import ComposePanel from '@/components/ComposePanel.vue'
import TextBody from '@/components/TextBody.vue'
import { formatDateTime, formatListTime } from '@/lib/format'
import { canSend, loadOutboxStatus } from '@/stores/outbox'

/** Sent mail (Phase 9): the inbox's fourth filter, as its own page. Plain text only. */
const { t } = useI18n()
const toast = useMessage()
const route = useRoute()
const router = useRouter()
const items = ref<SentMessageSummary[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(true)
const detail = ref<SentMessageDetail | null>(null)
const composing = ref(false)

const selectedId = computed(() => (typeof route.params.id === 'string' && route.params.id ? route.params.id : null))
const inboxFilters = computed(() => [
  { key: undefined, label: t('inbox.filterAll') },
  { key: 'unread', label: t('inbox.filterUnread') },
  { key: 'code', label: t('inbox.filterCode') },
])

async function load(more = false): Promise<void> {
  loading.value = true
  try {
    const res = await outboxApi.list(more ? nextCursor.value : null)
    items.value = more ? [...items.value, ...res.items] : res.items
    nextCursor.value = res.nextCursor
  } catch (err) {
    // 404 = sending is off; the page just shows its empty state.
    if (!more) items.value = []
    if (errorCodeOf(err) !== 'not_found') toast.error(t(`errors.${errorCodeOf(err)}`))
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadOutboxStatus(true)
  void load()
})

watch(
  selectedId,
  async (id) => {
    detail.value = null
    if (!id) return
    composing.value = false
    try {
      detail.value = (await outboxApi.get(id)).message
    } catch (err) {
      toast.error(t(`errors.${errorCodeOf(err)}`))
    }
  },
  { immediate: true },
)

function open(m: SentMessageSummary): void {
  void router.push({ name: 'sent', params: { id: m.id } })
}
function close(): void {
  void router.push({ name: 'sent', params: {} })
}
function onSent(message: SentMessageDetail): void {
  composing.value = false
  items.value = [message, ...items.value.filter((m) => m.id !== message.id)]
}
const recipients = (m: SentMessageSummary) => (m.to.length > 1 ? `${m.to[0]} +${m.to.length - 1}` : m.to[0])
</script>

<template>
  <div class="sent">
    <section class="list-pane" :aria-label="t('compose.sentTab')">
      <div class="toolbar">
        <div class="segmented" role="group" :aria-label="t('inbox.filterLabel')">
          <RouterLink v-for="f in inboxFilters" :key="f.label" :to="{ name: 'inbox', query: f.key ? { filter: f.key } : {} }" class="seg-link">
            {{ f.label }}
          </RouterLink>
          <span class="seg-link on" aria-current="page">{{ t('compose.sentTab') }}</span>
        </div>
        <button v-if="canSend()" type="button" class="pl-btn primary compose-btn" @click="composing = true; close()">
          <NIcon><CreateOutline /></NIcon>{{ t('compose.newButton') }}
        </button>
      </div>

      <NSpin :show="loading && items.length > 0" :delay="150">
        <ul v-if="items.length" class="list">
          <li
            v-for="m in items"
            :key="m.id"
            class="row"
            :class="{ selected: m.id === selectedId }"
            tabindex="0"
            role="button"
            @click="open(m)"
            @keydown.enter.self="open(m)"
          >
            <span class="to pl-mono" :title="m.to.join(', ')">{{ recipients(m) }}</span>
            <span class="text"><span class="subject">{{ m.subject }}</span><span class="snippet"> — {{ m.snippet }}</span></span>
            <NTag v-if="m.status !== 'sent'" size="small" :bordered="false" :type="m.status === 'failed' ? 'error' : 'default'">
              {{ t(`compose.status.${m.status}`) }}
            </NTag>
            <time class="time" :title="formatDateTime(m.createdAt)">{{ formatListTime(m.createdAt) }}</time>
          </li>
        </ul>
        <p v-else-if="!loading" class="empty">{{ canSend() ? t('compose.sentEmpty') : t('compose.sendingOff') }}</p>
      </NSpin>
      <div v-if="nextCursor" class="more"><NButton @click="load(true)">{{ t('common.loadMore') }}</NButton></div>
    </section>

    <aside v-if="composing || selectedId" class="drawer" :aria-label="composing ? t('compose.newTitle') : t('inbox.detailLabel')">
      <NButton class="close" quaternary circle :aria-label="t('inbox.close')" @click="composing = false; close()">
        <template #icon><NIcon><CloseOutline /></NIcon></template>
      </NButton>
      <ComposePanel v-if="composing" @sent="onSent" @cancel="composing = false" />
      <article v-else-if="detail" class="detail">
        <h2 class="subject-big">{{ detail.subject }}</h2>
        <p class="meta-line">{{ t('compose.from') }} <span class="pl-mono">{{ detail.fromAddress }}</span></p>
        <p class="meta-line">{{ t('compose.to') }} <span class="pl-mono">{{ detail.to.join(', ') }}</span></p>
        <p class="meta-line">
          <time>{{ formatDateTime(detail.createdAt) }}</time>
          · {{ t(`compose.status.${detail.status}`) }}
          <span v-if="detail.error" class="error">· {{ t(`sendErrors.${detail.error}`) }}</span>
        </p>
        <div class="body"><TextBody :text="detail.text" /></div>
      </article>
    </aside>
  </div>
</template>

<style scoped>
.sent {
  position: relative;
  min-height: calc(100dvh - var(--pl-chrome, 120px));
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.compose-btn {
  margin-left: auto;
}
.segmented {
  display: flex;
  padding: 3px;
  border: 1px solid var(--pl-line);
  border-radius: 10px;
  background: var(--pl-sunken);
}
.seg-link {
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
.seg-link.on {
  background: var(--pl-surface);
  color: var(--pl-ink);
  font-weight: 650;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--pl-line);
  border-radius: 16px;
  background: var(--pl-surface);
  overflow: hidden;
}
.row {
  display: grid;
  grid-template-columns: minmax(0, 200px) minmax(0, 1fr) auto 64px;
  align-items: center;
  gap: 14px;
  min-height: 46px;
  padding: 0 16px;
  border-bottom: 1px solid var(--pl-line);
  cursor: pointer;
}
.row:last-child {
  border-bottom: 0;
}
.row:hover,
.row.selected {
  background: var(--pl-sunken);
}
.row:focus-visible {
  outline: 2px solid var(--pl-blue);
  outline-offset: -2px;
}
.to,
.text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.to {
  font-size: 0.875rem;
}
.subject {
  font-weight: 600;
}
.snippet {
  color: var(--pl-muted);
}
.time {
  color: var(--pl-muted);
  font-size: 0.75rem;
  text-align: right;
}
.empty {
  padding: 48px 16px;
  color: var(--pl-muted);
  text-align: center;
}
.more {
  display: flex;
  justify-content: center;
  padding: 12px;
}
.drawer {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 5;
  width: min(680px, 62%);
  max-height: calc(100dvh - var(--pl-chrome, 120px));
  padding: 20px 28px 24px;
  box-sizing: border-box;
  overflow: auto;
  border: 1px solid var(--pl-line);
  border-radius: 16px;
  background: var(--pl-surface);
  box-shadow: -24px 0 48px rgb(19 22 27 / 0.12);
}
.close {
  position: absolute;
  top: 14px;
  right: 14px;
}
.detail {
  display: grid;
  gap: 6px;
}
.subject-big {
  margin: 0 40px 8px 0;
  font-size: 1.25rem;
}
.meta-line {
  margin: 0;
  color: var(--pl-muted);
  font-size: 0.875rem;
  overflow-wrap: anywhere;
}
.error {
  color: #b4243f;
}
.body {
  margin-top: 12px;
}
@media (max-width: 760px) {
  .row {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: 'to time' 'text text';
    gap: 2px 10px;
    padding: 10px 14px;
  }
  .to {
    grid-area: to;
  }
  .text {
    grid-area: text;
  }
  .time {
    grid-area: time;
  }
  .drawer {
    position: fixed;
    inset: 0;
    width: auto;
    max-height: none;
    border-radius: 0;
    padding: 16px;
  }
}
</style>
