<script setup lang="ts">
import { TrashOutline } from '@vicons/ionicons5'
import { NButton, NIcon, NSwitch, NTooltip } from 'naive-ui'
import { useI18n } from 'vue-i18n'

import type { AdminDomain } from '../../../shared/api'

defineProps<{ domain: AdminDomain }>()
const emit = defineEmits<{ toggle: [enabled: boolean]; remove: [] }>()
const { t } = useI18n()
</script>

<template>
  <li class="item">
    <div class="main">
      <span class="name pl-mono" :class="{ off: !domain.enabled }">{{ domain.domain }}</span>
      <span class="count">{{ t('admin.domains.mailboxCount', { n: domain.mailboxCount }) }}</span>
    </div>
    <label class="switch">
      <NSwitch :value="domain.enabled" size="small" @update:value="(v: boolean) => emit('toggle', v)" />
      {{ t('admin.domains.enabled') }}
    </label>
    <!-- Only never-used domains can be deleted: addresses must stay unique forever. -->
    <NTooltip :disabled="domain.mailboxCount === 0">
      <template #trigger>
        <span>
          <NButton
            quaternary
            circle
            size="small"
            :disabled="domain.mailboxCount > 0"
            :aria-label="t('admin.domains.delete')"
            @click="emit('remove')"
          >
            <template #icon><NIcon><TrashOutline /></NIcon></template>
          </NButton>
        </span>
      </template>
      {{ t('admin.domains.inUse') }}
    </NTooltip>
  </li>
</template>

<style scoped>
.item {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 12px 20px;
  border-top: 1px solid var(--pl-line);
}
.item:first-child {
  border-top: 0;
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 16px;
}
.name {
  overflow-wrap: anywhere;
}
.name.off {
  color: var(--pl-muted);
  text-decoration: line-through;
}
.count {
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--pl-muted);
  font-size: 0.875rem;
  cursor: pointer;
}
@media (max-width: 600px) {
  .item {
    flex-wrap: wrap;
    gap: 8px 16px;
    padding: 12px 16px;
  }
}
</style>
