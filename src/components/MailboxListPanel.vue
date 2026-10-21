<script setup lang="ts">
import { SearchOutline } from '@vicons/ionicons5'
import { NButton, NIcon, NInput, NSelect, NSkeleton, NSpin } from 'naive-ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { PublicMailbox } from '../../shared/api'
import MailboxItem from '@/components/MailboxItem.vue'
import { useDomains } from '@/composables/useDomains'

const props = defineProps<{
  items: PublicMailbox[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  emptyText: string
  freshId?: string | null
}>()
const query = defineModel<string>('query', { required: true })
/** Domain id filter (null = all); options are the enabled domains. */
const domain = defineModel<string | null>('domain', { default: null })
const emit = defineEmits<{ changed: [mailbox: PublicMailbox]; more: [] }>()

const { t } = useI18n()
const emptyMessage = computed(() => (query.value.trim() || domain.value ? t('mailboxes.emptySearch') : props.emptyText))
const { domains } = useDomains()
const domainOptions = computed(() => [
  { value: '', label: t('mailboxes.allDomains') },
  ...domains.value.map((d) => ({ value: d.id, label: d.domain })),
])
</script>

<template>
  <section class="panel">
    <div class="filters">
      <NInput v-model:value="query" class="search" clearable :placeholder="t('mailboxes.searchPlaceholder')">
        <template #prefix><NIcon><SearchOutline /></NIcon></template>
      </NInput>
      <NSelect
        class="domain"
        :value="domain ?? ''"
        :options="domainOptions"
        :aria-label="t('mailboxes.domainFilter')"
        :consistent-menu-width="false"
        @update:value="(v: string) => (domain = v || null)"
      />
    </div>
    <NSpin :show="loading && items.length > 0" :delay="150">
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
      <div v-else class="list skeleton" aria-hidden="true">
        <div v-for="i in 4" :key="i" class="skeleton-row">
          <NSkeleton text :width="220" />
          <NSkeleton text :width="`${30 + ((i * 17) % 30)}%`" />
        </div>
      </div>
    </NSpin>
    <div v-if="hasMore" class="more">
      <NButton :loading="loadingMore" @click="emit('more')">{{ t('common.loadMore') }}</NButton>
    </div>
  </section>
</template>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.search {
  flex: 1 1 240px;
  max-width: 360px;
}
.domain {
  flex: 0 1 200px;
  min-width: 150px;
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
.skeleton-row {
  display: grid;
  gap: 10px;
  padding: 18px 20px;
  border-top: 1px solid var(--pl-line);
}
.skeleton-row:first-child {
  border-top: 0;
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
