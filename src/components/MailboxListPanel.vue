<script setup lang="ts">
import { SearchOutline } from '@vicons/ionicons5'
import { NButton, NIcon, NInput, NSpin } from 'naive-ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { PublicMailbox } from '../../shared/api'
import MailboxItem from '@/components/MailboxItem.vue'

const props = defineProps<{
  items: PublicMailbox[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  emptyText: string
  freshId?: string | null
}>()
const query = defineModel<string>('query', { required: true })
const emit = defineEmits<{ changed: [mailbox: PublicMailbox]; more: [] }>()

const { t } = useI18n()
const emptyMessage = computed(() => (query.value.trim() ? t('mailboxes.emptySearch') : props.emptyText))
</script>

<template>
  <section class="panel">
    <NInput v-model:value="query" class="search" clearable :placeholder="t('mailboxes.searchPlaceholder')">
      <template #prefix><NIcon><SearchOutline /></NIcon></template>
    </NInput>
    <NSpin :show="loading" :delay="150">
      <ul v-if="items.length" class="list">
        <MailboxItem
          v-for="mailbox in items"
          :key="mailbox.id"
          :mailbox="mailbox"
          :fresh="mailbox.id === freshId"
          @changed="emit('changed', $event)"
        />
      </ul>
      <p v-else-if="!loading" class="empty">{{ emptyMessage }}</p>
      <div v-else class="placeholder" />
    </NSpin>
    <div v-if="hasMore" class="more">
      <NButton :loading="loadingMore" @click="emit('more')">{{ t('common.loadMore') }}</NButton>
    </div>
  </section>
</template>

<style scoped>
.search {
  max-width: 360px;
  margin-bottom: 12px;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--pl-line);
  border-radius: 14px;
  background: var(--pl-surface);
  overflow: hidden;
}
.empty {
  margin: 0;
  padding: 40px 16px;
  border: 1px dashed var(--pl-line);
  border-radius: 14px;
  color: var(--pl-muted);
  text-align: center;
}
.placeholder {
  height: 120px;
}
.more {
  display: flex;
  justify-content: center;
  margin-top: 16px;
}
@media (max-width: 600px) {
  .search {
    max-width: none;
  }
}
</style>
