import { useOsTheme } from 'naive-ui'
import { computed, ref, watchEffect } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'auto'

const STORAGE_KEY = 'postluma.theme'

function readMode(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'auto'
  } catch {
    return 'auto'
  }
}

const mode = ref<ThemeMode>(readMode())

export function useThemeMode() {
  const os = useOsTheme()
  const isDark = computed(() => (mode.value === 'auto' ? os.value === 'dark' : mode.value === 'dark'))
  watchEffect(() => {
    document.documentElement.dataset.theme = isDark.value ? 'dark' : 'light'
  })
  function setMode(next: ThemeMode): void {
    mode.value = next
    try {
      if (next === 'auto') localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Not persisted; applies for this visit.
    }
  }
  return { mode, isDark, setMode }
}
