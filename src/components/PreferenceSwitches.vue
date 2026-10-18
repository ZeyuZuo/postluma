<script setup lang="ts">
import { LanguageOutline, MoonOutline, SunnyOutline } from '@vicons/ionicons5'
import { NButton, NDropdown, NIcon, useMessage } from 'naive-ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { Locale } from '../../shared/api'
import { authApi } from '@/api/auth'
import { LOCALES, applyLocale } from '@/i18n'
import { session, setUser } from '@/stores/session'
import { useThemeMode, type ThemeMode } from '@/stores/theme'

const { t } = useI18n()
const message = useMessage()
const { mode, isDark, setMode } = useThemeMode()

const localeOptions = computed(() => [
  ...Object.entries(LOCALES).map(([key, l]) => ({ key, label: l.label })),
  { type: 'divider', key: 'd' },
  { key: 'auto', label: t('language.auto') },
])

const themeOptions = computed(() =>
  (['light', 'dark', 'auto'] as const).map((key) => ({
    key,
    label: t(`theme.${key}`),
    disabled: key === mode.value,
  })),
)

async function onLocale(key: string): Promise<void> {
  const locale = key === 'auto' ? null : (key as Locale)
  applyLocale(locale)
  if (!session.user) return
  try {
    setUser((await authApi.updateProfile({ locale })).user)
  } catch {
    message.error(t('errors.internal_error'))
  }
}
</script>

<template>
  <div class="switches">
    <NDropdown trigger="click" :options="localeOptions" @select="onLocale">
      <NButton quaternary circle :aria-label="t('language.label')">
        <template #icon><NIcon><LanguageOutline /></NIcon></template>
      </NButton>
    </NDropdown>
    <NDropdown trigger="click" :options="themeOptions" @select="(k: ThemeMode) => setMode(k)">
      <NButton quaternary circle :aria-label="t('theme.label')">
        <template #icon>
          <NIcon><MoonOutline v-if="isDark" /><SunnyOutline v-else /></NIcon>
        </template>
      </NButton>
    </NDropdown>
  </div>
</template>

<style scoped>
.switches {
  display: flex;
  gap: 4px;
}
</style>
