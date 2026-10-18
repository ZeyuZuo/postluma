<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { currentLocale } from '@/i18n'
import { TURNSTILE_SITE_KEY, loadTurnstile, turnstileEnabled } from '@/lib/turnstile'

const props = defineProps<{ action: string }>()
const token = defineModel<string>({ default: '' })
const el = ref<HTMLElement>()
let widgetId: string | undefined

onMounted(async () => {
  if (!turnstileEnabled || !el.value) return
  const turnstile = await loadTurnstile()
  widgetId = turnstile.render(el.value, {
    sitekey: TURNSTILE_SITE_KEY,
    action: props.action,
    language: currentLocale() === 'zh-CN' ? 'zh-cn' : 'en',
    theme: 'auto',
    callback: (value: string) => (token.value = value),
    'expired-callback': () => (token.value = ''),
    'error-callback': () => (token.value = ''),
  })
})

onBeforeUnmount(() => {
  if (widgetId) window.turnstile?.remove(widgetId)
})

defineExpose({
  reset(): void {
    token.value = ''
    if (widgetId) window.turnstile?.reset(widgetId)
  },
})
</script>

<template>
  <div v-if="turnstileEnabled" ref="el" class="turnstile" />
</template>

<style scoped>
.turnstile {
  min-height: 65px;
  margin-bottom: 16px;
}
</style>
