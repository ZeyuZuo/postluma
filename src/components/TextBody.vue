<script setup lang="ts">
import { computed } from 'vue'

import { linkify } from '@/lib/mail-html'

const props = defineProps<{ text: string }>()
const parts = computed(() => linkify(props.text))
</script>

<template>
  <div class="text-body">
    <template v-for="(part, i) in parts" :key="i">
      <a v-if="part.href" :href="part.href" target="_blank" rel="noopener noreferrer">{{ part.text }}</a>
      <template v-else>{{ part.text }}</template>
    </template>
  </div>
</template>

<style scoped>
.text-body {
  padding: 20px;
  border: 1px solid var(--pl-line);
  border-radius: 8px;
  background: var(--pl-surface);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.7;
}
a {
  color: var(--pl-blue);
}
</style>
