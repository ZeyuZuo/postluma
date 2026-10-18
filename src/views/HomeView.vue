<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { session } from '@/stores/session'

const { t } = useI18n()
</script>

<template>
  <section class="home">
    <h2>{{ t('home.greeting', { name: session.user?.username }) }}</h2>
    <p>{{ t('home.intro') }}</p>
  </section>
</template>

<style scoped>
h2 {
  margin: 8px 0 8px;
  font-size: 1.5rem;
  font-weight: 650;
}
p {
  margin: 0;
  max-width: 60ch;
  color: var(--pl-muted);
  line-height: 1.7;
}
</style>
