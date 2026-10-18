<script setup lang="ts">
import { NConfigProvider, NDialogProvider, NGlobalStyle, NMessageProvider, darkTheme } from 'naive-ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterView } from 'vue-router'

import type { Locale } from '../shared/api'
import { LOCALES } from '@/i18n'
import { useThemeMode } from '@/stores/theme'
import { darkOverrides, lightOverrides } from '@/theme'

const { locale } = useI18n()
const { isDark } = useThemeMode()
const naiveLocale = computed(() => LOCALES[locale.value as Locale])
</script>

<template>
  <NConfigProvider
    :theme="isDark ? darkTheme : null"
    :theme-overrides="isDark ? darkOverrides : lightOverrides"
    :locale="naiveLocale.naive"
    :date-locale="naiveLocale.naiveDate"
  >
    <NGlobalStyle />
    <NMessageProvider>
      <NDialogProvider>
        <RouterView />
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
