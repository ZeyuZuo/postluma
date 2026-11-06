<script setup lang="ts">
import { CreateOutline } from '@vicons/ionicons5'
import { NIcon, NTag, useMessage } from 'naive-ui'
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { SentMessageDetail, SentMessageSummary } from '../../shared/api'
import { errorCodeOf } from '@/api/client'
import { outboxApi } from '@/api/outbox'
import ComposePanel from '@/components/ComposePanel.vue'
import MailListLayout from '@/components/MailListLayout.vue'
import MailRow from '@/components/MailRow.vue'
import SentDetail from '@/components/SentDetail.vue'
import { useMailDrawer } from '@/composables/useMailDrawer'
import { canSend, loadOutboxStatus, outbox } from '@/stores/outbox'

/** Sent mail (Phase 9): the inbox's page, rows and message layout on top of the outbox API. */
const { t } = useI18n()
const toast = useMessage()

const items = ref<SentMessageSummary[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(true)
const loadingMore = ref(false)

const { selectedId, composing, drawerOpen, open, closeDetail, compose, closeDrawer } = useMailDrawer('sent', () => items.value)

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await outboxApi.list()
    items.value = res.items
    nextCursor.value = res.nextCursor
  } catch (err) {
    // 404 = sending is off; the page just shows its empty state.
    items.value = []
    if (errorCodeOf(err) !== 'not_found') toast.error(t(`errors.${errorCodeOf(err)}`))
  } finally {
    loading.value = false
  }
}

async function loadMore(): Promise<void> {
  if (!nextCursor.value) return
  loadingMore.value = true
  try {
    const res = await outboxApi.list(nextCursor.value)
    items.value = [...items.value, ...res.items]
    nextCursor.value = res.nextCursor
  } catch (err) {
    toast.error(t(`errors.${errorCodeOf(err)}`))
  } finally {
    loadingMore.value = false
  }
}

onMounted(() => {
  void loadOutboxStatus(true)
  void load()
})

function onSent(message: SentMessageDetail): void {
  composing.value = false
  items.value = [message, ...items.value.filter((m) => m.id !== message.id)]
}

const recipients = (m: SentMessageSummary) => (m.to.length > 1 ? `${m.to[0]} +${m.to.length - 1}` : (m.to[0] ?? ''))
</script>

<template>
  <MailListLayout
    :list-label="t('nav.sent')"
    :drawer-label="composing ? t('compose.newTitle') : t('inbox.detailLabel')"
    :drawer-open="drawerOpen"
    :loading="loading"
    :loading-more="loadingMore"
    :count="items.length"
    :has-more="Boolean(nextCursor)"
    :empty-text="canSend() ? t('compose.sentEmpty') : t('compose.sendingOff')"
    :hint="t('compose.sentShortcuts')"
    @close-drawer="closeDrawer"
    @load-more="loadMore"
  >
    <template #toolbar>
      <template v-if="canSend()">
        <span class="remaining">{{ t('compose.remaining', { n: outbox.status?.remaining ?? 0 }) }}</span>
        <button type="button" class="pl-btn primary compose-btn" @click="compose">
          <NIcon><CreateOutline /></NIcon>{{ t('compose.newButton') }}
        </button>
      </template>
    </template>

    <MailRow
      v-for="m in items"
      :id="m.id"
      :key="m.id"
      :who="recipients(m)"
      :who-title="m.to.join(', ')"
      :subject="m.subject"
      :snippet="m.snippet"
      :time="m.createdAt"
      :selected="m.id === selectedId"
      :mailbox="m.fromAddress.split('@')[0]"
      :mailbox-title="m.fromAddress"
      mailbox-mono
      @open="open(m.id)"
    >
      <template v-if="m.status !== 'sent'" #badge>
        <NTag size="small" :bordered="false" :type="m.status === 'failed' ? 'error' : 'default'">
          {{ t(`compose.status.${m.status}`) }}
        </NTag>
      </template>
    </MailRow>

    <template #drawer="{ mobile }">
      <ComposePanel v-if="composing && !selectedId" @sent="onSent" @cancel="composing = false" />
      <SentDetail v-else-if="selectedId" :id="selectedId" :show-back="mobile" @back="closeDetail" />
    </template>
  </MailListLayout>
</template>

<style scoped>
.remaining {
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.compose-btn {
  margin-left: auto;
}
</style>
