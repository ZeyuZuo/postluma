<script setup lang="ts">
import { NProgress, NSpin } from 'naive-ui'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { AdminStats, UserStatus } from '../../../shared/api'
import { adminApi } from '@/api/admin'

const { t } = useI18n()
const stats = ref<AdminStats | null>(null)
onMounted(async () => {
  stats.value = await adminApi.stats().catch(() => null)
})

const STATUSES: UserStatus[] = ['active', 'pending', 'banned', 'rejected']

function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
const pct = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0)
const status = (p: number) => (p >= 90 ? 'error' : p >= 70 ? 'warning' : 'success')

const weekMax = computed(() => Math.max(1, ...(stats.value?.intake.map((d) => d.messages) ?? [1])))
</script>

<template>
  <NSpin :show="!stats" :delay="150">
    <div v-if="stats" class="grid">
      <section class="card">
        <h3>{{ t('admin.stats.users') }}</h3>
        <dl class="figures">
          <template v-for="s in STATUSES" :key="s">
            <dt>{{ t(`admin.status.${s}`) }}</dt>
            <dd>{{ stats.users[s] }}</dd>
          </template>
        </dl>
      </section>

      <section class="card">
        <h3>{{ t('admin.stats.mailboxes') }}</h3>
        <dl class="figures">
          <dt>{{ t('admin.stats.activeMailboxes') }}</dt>
          <dd>{{ stats.mailboxes.active }}</dd>
          <dt>{{ t('admin.stats.disabledMailboxes') }}</dt>
          <dd>{{ stats.mailboxes.disabled }}</dd>
        </dl>
      </section>

      <section class="card">
        <h3>{{ t('admin.stats.today') }}</h3>
        <p class="big">{{ stats.today.messages }} <span>/ {{ stats.today.maxMessages }} {{ t('admin.stats.messages') }}</span></p>
        <NProgress :percentage="pct(stats.today.messages, stats.today.maxMessages)" :status="status(pct(stats.today.messages, stats.today.maxMessages))" :show-indicator="false" />
        <p class="sub">{{ bytes(stats.today.bytes) }} / {{ bytes(stats.today.maxBytes) }}</p>
        <NProgress :percentage="pct(stats.today.bytes, stats.today.maxBytes)" :status="status(pct(stats.today.bytes, stats.today.maxBytes))" :show-indicator="false" />
        <p class="hint">{{ t('admin.stats.todayHint') }}</p>
      </section>

      <section class="card">
        <h3>{{ t('admin.stats.database') }}</h3>
        <template v-if="stats.database.bytes !== null">
          <p class="big">{{ bytes(stats.database.bytes) }} <span>/ {{ bytes(stats.database.limitBytes) }}</span></p>
          <NProgress
            :percentage="pct(stats.database.bytes, stats.database.limitBytes)"
            :status="status(pct(stats.database.bytes, stats.database.limitBytes))"
            :show-indicator="false"
          />
        </template>
        <p v-else class="big">{{ t('admin.stats.unknown') }}</p>
        <p class="hint">{{ t('admin.stats.databaseHint') }}</p>
      </section>

      <section class="card wide">
        <h3>{{ t('admin.stats.week') }}</h3>
        <ol class="bars">
          <li v-for="d in stats.intake" :key="d.day">
            <span class="bar" :style="{ height: `${Math.max(2, (d.messages / weekMax) * 100)}%` }" />
            <span class="value">{{ d.messages }}</span>
            <span class="day">{{ d.day.slice(5) }}</span>
          </li>
        </ol>
      </section>
    </div>
  </NSpin>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}
.card {
  padding: 18px 20px;
  border: 1px solid var(--pl-line);
  border-radius: 10px;
  background: var(--pl-surface);
}
.wide {
  grid-column: 1 / -1;
}
h3 {
  margin: 0 0 12px;
  font-size: 0.9375rem;
  font-weight: 600;
}
.figures {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px 12px;
  margin: 0;
}
.figures dt {
  color: var(--pl-muted);
}
.figures dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.big {
  margin: 0 0 8px;
  font-size: 1.5rem;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.big span {
  color: var(--pl-muted);
  font-size: 0.875rem;
  font-weight: 400;
}
.sub {
  margin: 12px 0 6px;
  font-size: 0.875rem;
  font-variant-numeric: tabular-nums;
}
.hint {
  margin: 10px 0 0;
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.bars {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 12px;
  height: 160px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.bars li {
  display: grid;
  grid-template-rows: 1fr auto auto;
  align-items: end;
  justify-items: center;
  gap: 4px;
  min-width: 0;
}
.bar {
  width: 100%;
  max-width: 40px;
  border-radius: 4px 4px 0 0;
  background: var(--pl-blue);
}
.value {
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
}
.day {
  color: var(--pl-muted);
  font-size: 0.75rem;
}
</style>
