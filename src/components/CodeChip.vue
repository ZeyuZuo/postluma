<script setup lang="ts">
import { CopyOutline } from '@vicons/ionicons5'
import { NIcon, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'

import { copyText } from '@/composables/useClipboard'

const props = defineProps<{ code: string; size?: 'sm' | 'lg' }>()
const { t } = useI18n()
const message = useMessage()

async function copy(): Promise<void> {
  if (await copyText(props.code)) message.success(t('inbox.codeCopied', { code: props.code }))
  else message.warning(t('common.copyFailed'))
}
</script>

<template>
  <button type="button" class="chip" :class="size ?? 'sm'" :aria-label="t('inbox.copyCode')" :title="t('inbox.copyCode')" @click.stop="copy">
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
