<script setup lang="ts">
import { SearchOutline } from '@vicons/ionicons5'
import {
  NButton,
  NIcon,
  NInput,
  NInputNumber,
  NModal,
  NRadioButton,
  NRadioGroup,
  NSpin,
  NTag,
  useDialog,
  useMessage,
} from 'naive-ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { SETTING_RANGES, type AdminUser, type AdminUserAction, type UserStatus } from '../../../shared/api'
import { adminApi } from '@/api/admin'
import { errorCodeOf } from '@/api/client'
import { formatDateTime, formatRelative } from '@/lib/format'

const emit = defineEmits<{ pendingChanged: [count: number] }>()
const { t } = useI18n()
const toast = useMessage()
const dialog = useDialog()

type Filter = UserStatus | 'all'
const filter = ref<Filter>('all')
const search = ref('')
const users = ref<AdminUser[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(false)
const pendingCount = ref(0)
const defaultQuota = ref(10)
const busyId = ref<string | null>(null)
/** Batches per click; the server-side daily budget is the real limit. */
const MAX_BATCHES_PER_CLICK = 10

let requestId = 0
async function reload(): Promise<void> {
  const id = ++requestId
  loading.value = true
  try {
    const res = await adminApi.users({ status: filter.value === 'all' ? null : filter.value, q: search.value.trim() || undefined })
    if (id !== requestId) return
    users.value = res.items
    nextCursor.value = res.nextCursor
    pendingCount.value = res.pendingCount ?? 0
    emit('pendingChanged', pendingCount.value)
  } catch (err) {
    toast.error(t(`errors.${errorCodeOf(err)}`))
  } finally {
    if (id === requestId) loading.value = false
  }
}

async function loadMore(): Promise<void> {
  if (!nextCursor.value) return
  const id = requestId
  try {
    const res = await adminApi.users({ status: filter.value === 'all' ? null : filter.value, q: search.value.trim() || undefined, cursor: nextCursor.value })
    if (id !== requestId) return // the filter changed meanwhile
    users.value = [...users.value, ...res.items]
    nextCursor.value = res.nextCursor
  } catch (err) {
    toast.error(t(`errors.${errorCodeOf(err)}`))
  }
}

onMounted(async () => {
  try {
    defaultQuota.value = (await adminApi.settings()).defaultMailboxQuota
  } catch {
    // Display only.
  }
  await reload()
  // Land on the queue that needs attention.
  if (pendingCount.value > 0) filter.value = 'pending'
})

watch(filter, () => void reload())
let timer: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(timer)
  timer = setTimeout(() => void reload(), 300)
})

const filters = computed(() => [
  { value: 'pending', label: pendingCount.value ? `${t('admin.status.pending')} ${pendingCount.value}` : t('admin.status.pending') },
  { value: 'active', label: t('admin.status.active') },
  { value: 'banned', label: t('admin.status.banned') },
  { value: 'rejected', label: t('admin.status.rejected') },
  { value: 'all', label: t('admin.users.filterAll') },
])

const STATUS_TYPE: Record<UserStatus, 'warning' | 'success' | 'error' | 'default'> = {
  pending: 'warning',
  active: 'success',
  banned: 'error',
  rejected: 'default',
}

function actionsFor(user: AdminUser): AdminUserAction[] {
  if (user.role === 'admin') return []
  return { pending: ['approve', 'reject'], active: ['ban'], banned: ['unban'], rejected: ['approve'] }[user.status] as AdminUserAction[]
}

const DONE_KEY: Record<AdminUserAction, string> = {
  approve: 'admin.users.approved',
  reject: 'admin.users.rejected',
  ban: 'admin.users.banned',
  unban: 'admin.users.unbanned',
}

async function run(user: AdminUser, action: AdminUserAction): Promise<void> {
  busyId.value = user.id
  try {
    const { status } = await adminApi.act(user.id, action)
    toast.success(t(DONE_KEY[action], { name: user.username }))
    if (user.status === 'pending') pendingCount.value = Math.max(0, pendingCount.value - 1)
    emit('pendingChanged', pendingCount.value)
    if (filter.value !== 'all' && filter.value !== status) users.value = users.value.filter((u) => u.id !== user.id)
    else user.status = status
  } catch (err) {
    toast.error(t(`errors.${errorCodeOf(err)}`))
  } finally {
    busyId.value = null
  }
}

function confirmThen(user: AdminUser, action: AdminUserAction): void {
  if (action === 'ban' || action === 'reject') {
    dialog.warning({
      title: t(action === 'ban' ? 'admin.users.banTitle' : 'admin.users.rejectTitle', { name: user.username }),
      content: t(action === 'ban' ? 'admin.users.banBody' : 'admin.users.rejectBody'),
      positiveText: t(`admin.users.${action}`),
      negativeText: t('common.cancel'),
      onPositiveClick: () => run(user, action),
    })
  } else {
    void run(user, action)
  }
}

// ---- quota
const quotaUser = ref<AdminUser | null>(null)
const quotaValue = ref<number | null>(null)
function openQuota(user: AdminUser): void {
  quotaUser.value = user
  quotaValue.value = user.mailboxQuota
}
async function saveQuota(): Promise<void> {
  const user = quotaUser.value
  if (!user) return
  try {
    await adminApi.setQuota(user.id, quotaValue.value)
    user.mailboxQuota = quotaValue.value
    toast.success(t('admin.users.quotaSaved'))
    quotaUser.value = null
  } catch (err) {
    toast.error(t(`errors.${errorCodeOf(err)}`))
  }
}

// ---- delete (mail first, in bounded batches)
async function confirmDelete(user: AdminUser): Promise<void> {
  busyId.value = user.id
  let count: number
  try {
    count = (await adminApi.messageCount(user.id)).count
  } catch (err) {
    toast.error(t(`errors.${errorCodeOf(err)}`))
    busyId.value = null
    return
  }
  busyId.value = null
  const body = t('admin.users.deleteBody', { count: count >= 10_000 ? '10000+' : count })
  dialog.error({
    title: t('admin.users.deleteTitle', { name: user.username }),
    content: user.status === 'active' ? `${t('admin.users.deleteBanFirst')} ${body}` : body,
    positiveText: t('admin.users.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => {
      void deleteUser(user)
    },
  })
}

async function deleteUser(user: AdminUser): Promise<void> {
  busyId.value = user.id
  const progress = toast.loading(t('admin.users.deleteProgress', { n: 0 }), { duration: 0 })
  try {
    // Ban first: stops ingest and logins, and the API refuses to delete an active account.
    if (user.status === 'active') user.status = (await adminApi.act(user.id, 'ban')).status
    let removed = 0
    let done = false
    for (let i = 0; i < MAX_BATCHES_PER_CLICK && !done; i++) {
      const batch = await adminApi.purgeMessages(user.id)
      removed += batch.deleted
      progress.content = t('admin.users.deleteProgress', { n: removed })
      if (batch.budgetExhausted) {
        toast.warning(t('admin.settings.budgetExhausted', { n: removed }), { duration: 8000 })
        return
      }
      done = batch.done
    }
    if (!done) {
      toast.info(t('admin.users.deleteContinue', { n: removed }), { duration: 8000 })
      return
    }
    await adminApi.deleteUser(user.id)
    users.value = users.value.filter((u) => u.id !== user.id)
    toast.success(t('admin.users.deleted', { name: user.username }))
  } catch (err) {
    toast.error(t(`errors.${errorCodeOf(err)}`))
  } finally {
    progress.destroy()
    busyId.value = null
  }
}
</script>

<template>
  <section class="users">
    <div class="toolbar">
      <div class="filter-scroll">
        <NRadioGroup v-model:value="filter" size="small">
          <NRadioButton v-for="f in filters" :key="f.value" :value="f.value">{{ f.label }}</NRadioButton>
        </NRadioGroup>
      </div>
      <NInput v-model:value="search" size="small" clearable class="search" :placeholder="t('admin.users.searchPlaceholder')">
        <template #prefix><NIcon><SearchOutline /></NIcon></template>
      </NInput>
    </div>

    <NSpin :show="loading" :delay="150">
      <ul v-if="users.length" class="list">
        <li v-for="user in users" :key="user.id" class="item">
          <div class="main">
            <div class="name-line">
              <span class="name">{{ user.username }}</span>
              <NTag size="small" :bordered="false" :type="STATUS_TYPE[user.status]">{{ t(`admin.status.${user.status}`) }}</NTag>
              <NTag v-if="user.role === 'admin'" size="small" :bordered="false" type="info">{{ t('admin.users.adminTag') }}</NTag>
            </div>
            <p class="meta">
              <span :title="formatDateTime(user.createdAt)">{{ t('admin.users.registered', { time: formatRelative(user.createdAt) }) }}</span>
              <span v-if="user.lastLoginAt" :title="formatDateTime(user.lastLoginAt)">{{ t('admin.users.lastLogin', { time: formatRelative(user.lastLoginAt) }) }}</span>
              <span v-else>{{ t('admin.users.neverLoggedIn') }}</span>
              <span>
                {{ t('admin.users.mailboxes', { active: user.activeMailboxes, total: user.totalMailboxes, quota: user.mailboxQuota ?? `${defaultQuota} (${t('admin.users.quotaDefault')})` }) }}
              </span>
            </p>
          </div>
          <div class="actions">
            <NButton
              v-for="action in actionsFor(user)"
              :key="action"
              size="small"
              :type="action === 'approve' || action === 'unban' ? 'primary' : 'default'"
              :secondary="action !== 'approve'"
              :loading="busyId === user.id"
              @click="confirmThen(user, action)"
            >
              {{ t(`admin.users.${action}`) }}
            </NButton>
            <NButton size="small" quaternary @click="openQuota(user)">{{ t('admin.users.quota') }}</NButton>
            <NButton v-if="user.role !== 'admin'" size="small" quaternary type="error" :disabled="busyId === user.id" @click="confirmDelete(user)">
              {{ t('admin.users.delete') }}
            </NButton>
          </div>
        </li>
      </ul>
      <p v-else-if="!loading" class="empty">{{ t('admin.users.empty') }}</p>
    </NSpin>
    <div v-if="nextCursor" class="more"><NButton @click="loadMore">{{ t('common.loadMore') }}</NButton></div>

    <NModal
      :show="!!quotaUser"
      preset="dialog"
      :title="quotaUser ? t('admin.users.quotaTitle', { name: quotaUser.username }) : ''"
      :positive-text="t('admin.settings.save')"
      :negative-text="t('common.cancel')"
      @positive-click="saveQuota"
      @update:show="(v: boolean) => !v && (quotaUser = null)"
    >
      <p class="hint">{{ t('admin.users.quotaHint', { n: defaultQuota }) }}</p>
      <NInputNumber
        v-model:value="quotaValue"
        clearable
        :min="SETTING_RANGES.mailboxQuota.min"
        :max="SETTING_RANGES.mailboxQuota.max"
        :placeholder="String(defaultQuota)"
      />
    </NModal>
  </section>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.filter-scroll {
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}
.search {
  width: 220px;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--pl-line);
  border-radius: 10px;
  background: var(--pl-surface);
}
.item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 20px;
  border-top: 1px solid var(--pl-line);
}
.item:first-child {
  border-top: 0;
}
.main {
  flex: 1;
  min-width: 0;
}
.name-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.name {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 6px 0 0;
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
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
.hint {
  margin: 0 0 12px;
  color: var(--pl-muted);
  font-size: 0.875rem;
}
@media (max-width: 700px) {
  .item {
    flex-direction: column;
    align-items: stretch;
  }
  .actions {
    justify-content: flex-start;
  }
  .search {
    width: 100%;
  }
}
</style>
