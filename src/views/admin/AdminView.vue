<script setup lang="ts">
import { NTabPane, NTabs } from 'naive-ui'
import { useI18n } from 'vue-i18n'

import ComingSoon from '@/components/ComingSoon.vue'
import DomainManager from './DomainManager.vue'

const { t } = useI18n()
</script>

<template>
  <NTabs type="line" animated>
    <NTabPane name="domains" :tab="t('admin.tabs.domains')">
      <DomainManager />
    </NTabPane>
    <NTabPane name="users" :tab="t('admin.tabs.users')">
      <ComingSoon />
    </NTabPane>
    <NTabPane name="settings" :tab="t('admin.tabs.settings')">
      <ComingSoon />
    </NTabPane>
  </NTabs>
</template>
