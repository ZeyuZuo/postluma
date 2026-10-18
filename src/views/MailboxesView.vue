<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { PublicMailbox } from '../../shared/api'
import MailboxCreator from '@/components/MailboxCreator.vue'
import MailboxListPanel from '@/components/MailboxListPanel.vue'
import { useMailboxList } from '@/composables/useMailboxList'

const { t } = useI18n()
const list = useMailboxList('active')
const { items, quota, query, nextCursor, loading, loadingMore } = list
const freshId = ref<string | null>(null)

onMounted(() => void list.reload())

function onCreated(mailbox: PublicMailbox): void {
  freshId.value = mailbox.id
  list.prepend(mailbox)
  if (quota.value) quota.value = { ...quota.value, used: quota.value.used + 1 }
}

function onChanged(mailbox: PublicMailbox): void {
  list.apply(mailbox)
  if (mailbox.status === 'disabled' && quota.value) quota.value = { ...quota.value, used: quota.value.used - 1 }
}
</script>

<template>
  <div class="page">
    <MailboxCreator :quota="quota" @created="onCreated" />
    <MailboxListPanel
      v-model:query="query"
      :items="items"
      :loading="loading"
      :loading-more="loadingMore"
      :has-more="!!nextCursor"
      :empty-text="t('mailboxes.emptyActive')"
      :fresh-id="freshId"
      @changed="onChanged"
      @more="list.loadMore"
    />
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: 24px;
}
</style>
