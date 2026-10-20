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

const TABS = ['users', 'domains', 'settings', 'stats', 'audit'] as const
type Tab = (typeof TABS)[number]

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const pending = ref(0)

const initial = TABS.includes(route.query.tab as Tab) ? (route.query.tab as Tab) : 'users'
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
    <NTabPane name="users" :tab="usersTab">
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
