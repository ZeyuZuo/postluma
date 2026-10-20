<script setup lang="ts">
import { CopyOutline } from '@vicons/ionicons5'
import { NIcon } from 'naive-ui'
import { useI18n } from 'vue-i18n'

import { useCopyCode, type CodeMessage } from '@/composables/useCopyCode'

/** With `message`, copying also marks that message read. */
const props = defineProps<{ code: string; size?: 'sm' | 'lg'; message?: CodeMessage }>()
const { t } = useI18n()
const copyCode = useCopyCode()

const copy = () => copyCode(props.code, props.message)
</script>

<template>
  <button type="button" class="chip" :class="[size ?? 'sm', { done: message?.isRead }]" :aria-label="t('inbox.copyCode')" :title="t('inbox.copyCode')" @click.stop="copy">
    <span class="pl-mark">{{ code }}</span>
    <NIcon class="icon"><CopyOutline /></NIcon>
  </button>
</template>

<style scoped>
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--pl-muted);
  cursor: pointer;
  font: inherit;
}
.chip:hover .icon,
.chip:focus-visible .icon {
  color: var(--pl-blue);
}
.chip:focus-visible {
  outline: 2px solid var(--pl-blue);
  outline-offset: 2px;
}
/* Already read (copied): no highlighter, so amber only marks codes still waiting. */
.done .pl-mark {
  background: none;
  color: var(--pl-muted);
}
.sm .pl-mark {
  font-size: 0.9375rem;
  letter-spacing: 0.04em;
}
.lg .pl-mark {
  font-size: 1.75rem;
  letter-spacing: 0.08em;
  padding: 0 0.3em;
}
.lg .icon {
  font-size: 1.25rem;
}
</style>
