<script setup lang="ts">
import { ArrowBackOutline } from '@vicons/ionicons5'
import { NButton, NIcon, NSpin } from 'naive-ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { formatDateTime } from '@/lib/format'

/**
 * How a message reads, received or sent: toolbar, subject, who and when, then the body. Keep passing
 * the message on show while the next one loads, so the panel doesn't empty in between.
 */
const props = defineProps<{
  /** `who` is the name behind the avatar's initial. */
  mail: { subject: string; who: string; time: number } | null
  loading: boolean
  failed: boolean
  showBack?: boolean
}>()
defineEmits<{ back: [] }>()

const { t } = useI18n()
const initial = computed(() => (props.mail?.who || '?').trim().slice(0, 1).toUpperCase())
</script>

<template>
  <NSpin :show="loading" :delay="150" class="spin">
    <article v-if="mail" class="detail">
      <div class="toolbar">
        <NButton v-if="showBack" quaternary size="small" @click="$emit('back')">
          <template #icon><NIcon><ArrowBackOutline /></NIcon></template>
          {{ t('inbox.back') }}
        </NButton>
        <span class="spacer" />
        <slot name="actions" />
      </div>

      <slot name="above" />

      <h2 class="subject">{{ mail.subject }}</h2>

      <div class="sender">
        <span class="avatar" aria-hidden="true">{{ initial }}</span>
        <div class="who"><slot name="who" /></div>
        <time class="when" :datetime="new Date(mail.time).toISOString()">{{ formatDateTime(mail.time) }}</time>
      </div>

      <slot name="notices" />

      <div class="body"><slot /></div>

      <slot name="below" />
    </article>
    <p v-else-if="failed" class="failed">{{ t('inbox.loadFailed') }}</p>
  </NSpin>
</template>

<style scoped>
.spin,
.spin :deep(.n-spin-content) {
  height: 100%;
}
.detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 100%;
  min-width: 0;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 36px;
}
.spacer {
  flex: 1;
}
.subject {
  margin: 0;
  font-size: 1.375rem;
  font-weight: 750;
  line-height: 1.3;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}
.sender {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.avatar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--pl-ink);
  color: var(--pl-surface);
  font-weight: 700;
}
.who {
  flex: 1;
  min-width: 0;
  font-size: 0.8125rem;
}
.who :deep(p) {
  margin: 0;
  overflow-wrap: anywhere;
}
.when {
  flex: none;
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.body {
  flex: 1;
  min-height: 360px;
  display: flex;
  flex-direction: column;
}
.body > :deep(*) {
  flex: 1;
}
.failed {
  color: var(--pl-muted);
  text-align: center;
  padding: 48px 0;
}
@media (max-width: 600px) {
  .sender {
    flex-wrap: wrap;
  }
  .when {
    width: 100%;
    padding-left: 52px;
  }
}
</style>
