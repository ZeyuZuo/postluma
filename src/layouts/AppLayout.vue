<script setup lang="ts">
import {
  AtOutline,
  FileTrayFullOutline,
  HomeOutline,
  LogOutOutline,
  SettingsOutline,
  ShieldCheckmarkOutline,
} from '@vicons/ionicons5'
import { NButton, NDropdown, NIcon } from 'naive-ui'
import { computed, h, onBeforeUnmount, onMounted, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'

import BrandMark from '@/components/BrandMark.vue'
import PreferenceSwitches from '@/components/PreferenceSwitches.vue'
import { useIsMobile } from '@/composables/useIsMobile'
import { inbox, startInboxPolling, stopInboxPolling } from '@/stores/inbox'
import { logout, session } from '@/stores/session'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const isMobile = useIsMobile()

onMounted(startInboxPolling)
onBeforeUnmount(stopInboxPolling)

interface NavItem {
  name: string
  labelKey: string
  icon: Component
  /** Other route names that light this item up. */
  also?: string[]
}

const isAdmin = computed(() => session.user?.role === 'admin')

/** Top bar on desktop, bottom tab bar on phones. Disabled addresses are a tab of "Addresses". */
const navItems = computed<NavItem[]>(() => [
  { name: 'home', labelKey: 'nav.home', icon: HomeOutline },
  { name: 'inbox', labelKey: 'nav.inbox', icon: FileTrayFullOutline, also: ['sent'] },
  { name: 'mailboxes', labelKey: 'nav.mailboxes', icon: AtOutline, also: ['mailboxes-disabled'] },
  ...(isAdmin.value ? [{ name: 'admin', labelKey: 'nav.admin', icon: ShieldCheckmarkOutline }] : []),
])

const isActive = (item: NavItem) => route.name === item.name || (item.also ?? []).includes(String(route.name))
const unreadLabel = computed(() => (inbox.unread > 99 ? '99+' : String(inbox.unread)))

const icon = (c: Component) => () => h(NIcon, null, { default: () => h(c) })
const userOptions = computed(() => [
  { key: 'account', label: t('nav.account'), icon: icon(SettingsOutline) },
  { type: 'divider', key: 'd' },
  { key: 'logout', label: t('auth.logout'), icon: icon(LogOutOutline) },
])

const pageTitle = computed(() => (route.meta.titleKey ? t(route.meta.titleKey) : ''))
const initial = computed(() => (session.user?.username ?? '?').slice(0, 1).toUpperCase())

async function onUserAction(key: string): Promise<void> {
  if (key === 'logout') {
    await logout()
    await router.push({ name: 'login' })
    return
  }
  await router.push({ name: key })
}
</script>

<template>
  <div class="shell" :class="{ mobile: isMobile }">
    <header class="topbar">
      <RouterLink :to="{ name: 'home' }" class="brand" :aria-label="t('nav.home')"><BrandMark size="sm" /></RouterLink>

      <nav v-if="!isMobile" class="topnav" :aria-label="t('nav.main')">
        <RouterLink
          v-for="item in navItems"
          :key="item.name"
          :to="{ name: item.name }"
          class="topnav-link"
          :class="{ active: isActive(item) }"
          :aria-current="isActive(item) ? 'page' : undefined"
        >
          {{ t(item.labelKey) }}
          <span v-if="item.name === 'inbox' && inbox.unread > 0" class="count">{{ unreadLabel }}</span>
        </RouterLink>
      </nav>

      <span class="spacer" />
      <PreferenceSwitches />
      <NDropdown trigger="click" placement="bottom-end" :options="userOptions" @select="onUserAction">
        <NButton quaternary class="user" :aria-label="t('nav.userMenu')">
          <span class="avatar" aria-hidden="true">{{ initial }}</span>
          <span v-if="!isMobile" class="username">{{ session.user?.username }}</span>
        </NButton>
      </NDropdown>
    </header>

    <main class="content">
      <h1 class="visually-hidden">{{ pageTitle }}</h1>
      <div class="content-inner">
        <RouterView />
      </div>
    </main>

    <nav v-if="isMobile" class="tabbar" :aria-label="t('nav.main')">
      <RouterLink
        v-for="item in navItems"
        :key="item.name"
        :to="{ name: item.name }"
        class="tab"
        :class="{ active: isActive(item) }"
        :aria-current="isActive(item) ? 'page' : undefined"
      >
        <span class="tab-icon">
          <NIcon :size="22"><component :is="item.icon" /></NIcon>
          <span v-if="item.name === 'inbox' && inbox.unread > 0" class="tab-badge">{{ unreadLabel }}</span>
        </span>
        <span>{{ t(item.labelKey) }}</span>
      </RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.shell {
  /* Header + content padding; views that fill the viewport (the inbox) subtract this. */
  --pl-chrome: calc(64px + 56px);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100vh;
  height: 100dvh;
}
.shell.mobile {
  --pl-chrome: calc(56px + 64px + 40px);
  grid-template-rows: auto minmax(0, 1fr) auto;
}
.topbar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 64px;
  padding: 0 20px 0 28px;
  background: var(--pl-surface);
  border-bottom: 1px solid var(--pl-line);
}
.brand {
  display: flex;
  margin-right: 20px;
  text-decoration: none;
}
.topnav {
  /* Centered on the page, independent of the brand and user menu widths. */
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
}
.topnav-link {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  color: var(--pl-muted);
  font-weight: 500;
  text-decoration: none;
  box-shadow: inset 0 -2px 0 transparent;
  transition: color 0.15s, box-shadow 0.15s;
}
.topnav-link:hover {
  color: var(--pl-ink);
}
.topnav-link.active {
  color: var(--pl-ink);
  font-weight: 650;
  box-shadow: inset 0 -2px 0 var(--pl-ink);
}
.topnav-link:focus-visible,
.tab:focus-visible {
  outline: 2px solid var(--pl-blue);
  outline-offset: -2px;
  border-radius: 6px;
}
.count {
  min-width: 20px;
  padding: 0 6px;
  box-sizing: border-box;
  border-radius: 999px;
  background: var(--pl-ink);
  color: var(--pl-surface);
  font-size: 0.75rem;
  font-weight: 650;
  line-height: 20px;
  text-align: center;
}
.spacer {
  flex: 1;
}
.user {
  padding: 0 6px;
}
.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--pl-sunken);
  color: var(--pl-ink);
  font-weight: 700;
}
.username {
  max-width: 10em;
  margin-left: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.content {
  overflow: auto;
}
.content-inner {
  max-width: 1240px;
  margin: 0 auto;
  padding: 28px 32px;
}
.tabbar {
  display: grid;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--pl-surface);
  border-top: 1px solid var(--pl-line);
}
.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 64px;
  color: var(--pl-muted);
  font-size: 0.6875rem;
  text-decoration: none;
}
.tab.active {
  color: var(--pl-ink);
  font-weight: 650;
}
.tab.active .tab-icon::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -5px;
  width: 16px;
  height: 3px;
  margin-left: -8px;
  border-radius: 2px;
  background: var(--pl-ink);
}
.tab-icon {
  position: relative;
  display: flex;
}
.tab-badge {
  position: absolute;
  top: -4px;
  left: 14px;
  min-width: 16px;
  padding: 0 4px;
  box-sizing: border-box;
  border-radius: 8px;
  background: var(--pl-ink);
  color: var(--pl-surface);
  font-size: 0.625rem;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}
@media (max-width: 767px) {
  .topbar {
    height: 56px;
    padding: 0 8px 0 16px;
  }
  .content-inner {
    padding: 20px 16px;
  }
}
</style>
