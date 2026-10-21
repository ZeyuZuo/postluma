<script setup lang="ts">
import { TrashOutline } from '@vicons/ionicons5'
import { NButton, NIcon, NSwitch, NTooltip } from 'naive-ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { AdminDomain, DomainHealth } from '../../../shared/api'

const props = defineProps<{ domain: AdminDomain; health?: DomainHealth | 'checking'; sending?: boolean }>()
const emit = defineEmits<{ toggle: [enabled: boolean]; remove: []; check: []; canSend: [value: boolean] }>()
const { t } = useI18n()

/** ok → green; partial/other/none → red (mail won't arrive, or not all of it); error → grey. */
const tone = computed(() => {
  const h = props.health
  if (!h || h === 'checking') return 'pending'
  if (h.status === 'ok') return 'ok'
  return h.status === 'error' ? 'unknown' : 'bad'
})
</script>

<template>
  <li class="item">
    <div class="main">
      <span class="name pl-mono" :class="{ off: !domain.enabled }">{{ domain.domain }}</span>
      <span class="count">{{ t('admin.domains.mailboxCount', { n: domain.mailboxCount }) }}</span>
      <NTooltip v-if="health" :disabled="health === 'checking'">
        <template #trigger>
          <button type="button" class="mx" :class="tone" :disabled="health === 'checking'" @click="emit('check')">
            {{ health === 'checking' ? t('admin.domains.mxChecking') : t(`admin.domains.mx.${health.status}`) }}
          </button>
        </template>
        <template v-if="health !== 'checking'">
          <p class="mx-hint">{{ t(`admin.domains.mxHint.${health.status}`) }}</p>
          <p v-for="r in health.mx" :key="r.host" class="pl-mono mx-record">{{ r.priority }} {{ r.host }}</p>
          <p class="mx-hint">{{ t('admin.domains.mxRecheck') }}</p>
        </template>
      </NTooltip>
    </div>
    <label v-if="sending" class="switch">
      <NSwitch :value="domain.canSend" size="small" @update:value="(v: boolean) => emit('canSend', v)" />
      {{ t('admin.domains.canSend') }}
    </label>
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
.mx {
  padding: 0 8px;
  border: 0;
  border-radius: 999px;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 650;
  line-height: 20px;
  white-space: nowrap;
  cursor: pointer;
}
.mx:disabled {
  cursor: progress;
}
.mx:focus-visible {
  outline: 2px solid var(--pl-blue);
  outline-offset: 2px;
}
.mx.pending,
.mx.unknown {
  background: var(--pl-sunken);
  color: var(--pl-muted);
}
.mx.ok {
  background: color-mix(in srgb, #2f9e62 14%, transparent);
  color: #23794a;
}
.mx.bad {
  background: color-mix(in srgb, #d03050 14%, transparent);
  color: #b4243f;
}
:root[data-theme='dark'] .mx.ok {
  color: #5fd08f;
}
:root[data-theme='dark'] .mx.bad {
  color: #ff7d93;
}
.mx-hint,
.mx-record {
  margin: 0;
  max-width: 320px;
}
.mx-record {
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
