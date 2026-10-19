<script setup lang="ts">
import { computed } from 'vue'

import { buildSrcdoc } from '@/lib/mail-html'

/** `html` must already be sanitized by prepareMailHtml(). */
const props = defineProps<{ html: string; allowRemoteImages: boolean; title: string }>()
const srcdoc = computed(() => buildSrcdoc(props.html, props.allowRemoteImages))
</script>

<template>
  <!-- No allow-scripts, no allow-same-origin: the mail can't run code or reach this app. -->
  <iframe
    class="frame"
    :srcdoc="srcdoc"
    sandbox="allow-popups allow-popups-to-escape-sandbox"
    referrerpolicy="no-referrer"
    :title="title"
  />
</template>

<style scoped>
.frame {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 420px;
  border: 1px solid var(--pl-line);
  border-radius: 8px;
  background: #fff;
}
</style>
