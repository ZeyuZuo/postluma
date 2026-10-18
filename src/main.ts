import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/600.css'
import './styles/main.css'

import { createApp } from 'vue'

import App from './App.vue'
import { setUnauthorizedHandler } from './api/client'
import { currentLocale, i18n } from './i18n'
import router from './router'
import { setUser } from './stores/session'

document.documentElement.lang = currentLocale()

// A 401 from any non-auth API call means the session ended (logout elsewhere, ban, expiry).
setUnauthorizedHandler(() => {
  setUser(null)
  void router.push({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } })
})

createApp(App).use(i18n).use(router).mount('#app')
