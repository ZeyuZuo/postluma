<script setup lang="ts">
import { ConstructOutline } from '@vicons/ionicons5'
import { NIcon } from 'naive-ui'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <section class="coming-soon">
    <NIcon size="36" class="icon"><ConstructOutline /></NIcon>
    <h2>{{ t('comingSoon.title') }}</h2>
    <p>{{ t('comingSoon.description') }}</p>
  </section>
</template>

<style scoped>
.coming-soon {
  padding: 72px 16px;
  text-align: center;
}
.icon {
  color: var(--pl-muted);
}
h2 {
  margin: 12px 0 6px;
  font-size: 1.0625rem;
  font-weight: 600;
}
p {
  margin: 0;
  color: var(--pl-muted);
  font-size: 0.875rem;
}
</style>
