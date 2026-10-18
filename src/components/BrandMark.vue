<script setup lang="ts">
defineProps<{ size?: 'sm' | 'md' }>()
</script>

<template>
  <span class="brand" :class="size ?? 'md'">
    <svg class="glyph" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="3" y="8" width="24" height="17" rx="3" fill="none" stroke="currentColor" stroke-width="2" />
      <path d="M4 10l11 8 11-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
      <circle cx="26" cy="8" r="4.5" class="glow" />
    </svg>
    <span class="word">PostLuma</span>
  </span>
</template>

<style scoped>
.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.5em;
  color: var(--pl-blue);
}
.glyph {
  width: 1.6em;
  height: 1.6em;
}
.glow {
  fill: var(--pl-mark);
  stroke: var(--pl-surface);
  stroke-width: 2;
}
.word {
  color: var(--pl-ink);
  font-weight: 650;
  letter-spacing: -0.01em;
}
.sm {
  font-size: 1rem;
}
.md {
  font-size: 1.25rem;
}
</style>
