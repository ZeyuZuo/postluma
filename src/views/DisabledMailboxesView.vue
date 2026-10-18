<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import MailboxListPanel from '@/components/MailboxListPanel.vue'
import { useMailboxList } from '@/composables/useMailboxList'

const { t } = useI18n()
const list = useMailboxList('disabled')
const { items, query, nextCursor, loading, loadingMore } = list

onMounted(() => void list.reload())
</script>

<template>
  <div class="page">
    <p class="intro">{{ t('mailboxes.disabledIntro') }}</p>
    <MailboxListPanel
      v-model:query="query"
      :items="items"
      :loading="loading"
      :loading-more="loadingMore"
      :has-more="!!nextCursor"
      :empty-text="t('mailboxes.emptyDisabled')"
      @changed="list.apply"
      @more="list.loadMore"
    />
  </div>
</template>

<style scoped>
.intro {
  max-width: 64ch;
  margin: 0 0 20px;
  color: var(--pl-muted);
  line-height: 1.7;
}
</style>
