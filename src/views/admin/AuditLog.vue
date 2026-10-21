<script setup lang="ts">
import { NButton, NSpin, useMessage } from 'naive-ui'
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { AuditEntry } from '../../../shared/api'
import { adminApi } from '@/api/admin'
import { errorCodeOf } from '@/api/client'
import { formatDateTime } from '@/lib/format'

const { t, te } = useI18n()
/** Friendly label for known action codes; unknown ones show the raw code. */
const actionLabel = (code: string) => {
  const key = `admin.audit.actions.${code.replace(/\./g, '_')}`
  return te(key) ? t(key) : code
}
const toast = useMessage()
const items = ref<AuditEntry[]>([])
const cursor = ref<string | null>(null)
const loading = ref(true)

async function load(next = false): Promise<void> {
  loading.value = true
  try {
    const res = await adminApi.audit(next ? cursor.value : null)
    items.value = next ? [...items.value, ...res.items] : res.items
    cursor.value = res.nextCursor
  } catch (err) {
    toast.error(t(`errors.${errorCodeOf(err)}`))
  } finally {
    loading.value = false
  }
}
onMounted(() => void load())

const detailText = (d: unknown) => (d === null || d === undefined ? '' : typeof d === 'string' ? d : JSON.stringify(d))
</script>

<template>
  <section class="audit">
    <p class="keep">{{ t('admin.audit.keep') }}</p>
    <NSpin :show="loading && !items.length" :delay="150">
      <ol v-if="items.length" class="log">
        <li v-for="e in items" :key="e.id" class="entry">
          <time class="time">{{ formatDateTime(e.createdAt) }}</time>
          <span class="action" :title="e.action">{{ actionLabel(e.action) }}</span>
          <span v-if="e.actorUsername || !e.targetId" class="who">{{ t('admin.audit.actor') }}: {{ e.actorUsername ?? t('admin.audit.unknownActor') }}</span>
          <span v-if="e.targetId && !e.action.startsWith('admin.domain_')" class="who">
            {{ t('admin.audit.target') }}: {{ e.targetUsername ?? t('admin.audit.deletedTarget') }}
          </span>
          <span v-if="e.ip" class="ip">{{ t('admin.audit.ip') }}: <span class="pl-mono">{{ e.ip }}</span></span>
          <span v-if="detailText(e.detail)" class="detail pl-mono">{{ detailText(e.detail) }}</span>
        </li>
      </ol>
      <p v-else-if="!loading" class="empty">{{ t('admin.audit.empty') }}</p>
    </NSpin>
    <div v-if="cursor" class="more"><NButton :loading="loading" @click="load(true)">{{ t('common.loadMore') }}</NButton></div>
  </section>
</template>

<style scoped>
.audit {
  max-width: 960px;
  margin: 0 auto;
}
.keep {
  margin: 0 0 12px;
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.log {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--pl-line);
  border-radius: 10px;
  background: var(--pl-surface);
}
.entry {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 16px;
  padding: 10px 16px;
  border-top: 1px solid var(--pl-line);
  font-size: 0.875rem;
}
.entry:first-child {
  border-top: 0;
}
.time {
  color: var(--pl-muted);
  font-variant-numeric: tabular-nums;
  min-width: 11em;
}
.action {
  font-weight: 600;
}
.who,
.ip {
  color: var(--pl-muted);
}
.detail {
  flex-basis: 100%;
  color: var(--pl-muted);
  font-size: 0.75rem;
  overflow-wrap: anywhere;
}
.empty {
  margin: 0;
  padding: 40px 16px;
  border: 1px dashed var(--pl-line);
  border-radius: 10px;
  color: var(--pl-muted);
  text-align: center;
}
.more {
  display: flex;
  justify-content: center;
  margin-top: 16px;
}
</style>
