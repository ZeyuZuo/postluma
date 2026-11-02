<script setup lang="ts">
import { NBadge, NTabPane, NTabs } from 'naive-ui'
import { h, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import AuditLog from './AuditLog.vue'
import DomainManager from './DomainManager.vue'
import SettingsPanel from './SettingsPanel.vue'
import StatsPanel from './StatsPanel.vue'
import UserManager from './UserManager.vue'
import { isPersonal } from '@/stores/mode'

const TABS = ['users', 'domains', 'settings', 'stats', 'audit'] as const
type Tab = (typeof TABS)[number]

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const pending = ref(0)
// Personal mode has only the administrator, so there are no users to manage.
const personal = isPersonal()
const tabs: readonly Tab[] = personal ? TABS.filter((tab) => tab !== 'users') : TABS

const initial = tabs.includes(route.query.tab as Tab) ? (route.query.tab as Tab) : tabs[0]!
const tab = ref<Tab>(initial)

function select(value: Tab): void {
  tab.value = value
  void router.replace({ query: { ...route.query, tab: value } })
}

const usersTab = () =>
  h('span', { class: 'tab-label' }, [t('admin.tabs.users'), pending.value > 0 ? h(NBadge, { value: pending.value, max: 99 }) : null])
</script>

<template>
  <NTabs :value="tab" type="line" justify-content="center" animated @update:value="select">
    <NTabPane v-if="!personal" name="users" :tab="usersTab">
      <UserManager @pending-changed="(n: number) => (pending = n)" />
    </NTabPane>
    <NTabPane name="domains" :tab="t('admin.tabs.domains')" display-directive="show:lazy">
      <DomainManager />
    </NTabPane>
    <NTabPane name="settings" :tab="t('admin.tabs.settings')" display-directive="show:lazy">
      <SettingsPanel />
    </NTabPane>
    <NTabPane name="stats" :tab="t('admin.tabs.stats')" display-directive="if">
      <StatsPanel />
    </NTabPane>
    <NTabPane name="audit" :tab="t('admin.tabs.audit')" display-directive="if">
      <AuditLog />
    </NTabPane>
  </NTabs>
</template>

<style scoped>
:deep(.tab-label) {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
</style>
