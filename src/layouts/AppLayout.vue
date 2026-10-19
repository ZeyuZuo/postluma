<script setup lang="ts">
import {
  AtOutline,
  FileTrayFullOutline,
  HomeOutline,
  LogOutOutline,
  MenuOutline,
  PauseCircleOutline,
  PersonCircleOutline,
  SettingsOutline,
  ShieldCheckmarkOutline,
} from '@vicons/ionicons5'
import {
  NButton,
  NDrawer,
  NDrawerContent,
  NDropdown,
  NIcon,
  NLayout,
  NLayoutContent,
  NLayoutHeader,
  NLayoutSider,
  NBadge,
  NMenu,
  type MenuOption,
} from 'naive-ui'
import { computed, h, onBeforeUnmount, onMounted, ref, type Component } from 'vue'
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
const drawerOpen = ref(false)

const icon = (c: Component) => () => h(NIcon, null, { default: () => h(c) })
const link = (name: string, labelKey: string) => () =>
  h(RouterLink, { to: { name }, onClick: () => (drawerOpen.value = false) }, { default: () => t(labelKey) })

onMounted(startInboxPolling)
onBeforeUnmount(stopInboxPolling)

const inboxLabel = () =>
  h('span', { class: 'nav-inbox' }, [
    link('inbox', 'nav.inbox')(),
    inbox.unread > 0 ? h(NBadge, { value: inbox.unread, max: 99, class: 'nav-badge' }) : null,
  ])

const menuOptions = computed<MenuOption[]>(() => {
  const items: MenuOption[] = [
    { key: 'home', label: link('home', 'nav.home'), icon: icon(HomeOutline) },
    { key: 'inbox', label: inboxLabel, icon: icon(FileTrayFullOutline) },
    { key: 'mailboxes', label: link('mailboxes', 'nav.mailboxes'), icon: icon(AtOutline) },
    { key: 'mailboxes-disabled', label: link('mailboxes-disabled', 'nav.disabled'), icon: icon(PauseCircleOutline) },
  ]
  if (session.user?.role === 'admin') {
    items.push({ type: 'divider', key: 'admin-divider' })
    items.push({ key: 'admin', label: link('admin', 'nav.admin'), icon: icon(ShieldCheckmarkOutline) })
  }
  return items
})

const userOptions = computed(() => [
  { key: 'account', label: t('nav.account'), icon: icon(SettingsOutline) },
  { key: 'logout', label: t('auth.logout'), icon: icon(LogOutOutline) },
])

const pageTitle = computed(() => (route.meta.titleKey ? t(route.meta.titleKey) : ''))

async function onUserAction(key: string): Promise<void> {
  if (key === 'account') await router.push({ name: 'account' })
  if (key === 'logout') {
    await logout()
    await router.push({ name: 'login' })
  }
}
</script>

<template>
  <NLayout has-sider class="shell">
    <NLayoutSider v-if="!isMobile" bordered :width="232" class="sider">
      <div class="sider-brand"><BrandMark size="sm" /></div>
      <NMenu :value="String(route.name)" :options="menuOptions" :indent="20" />
    </NLayoutSider>

    <NDrawer v-else v-model:show="drawerOpen" placement="left" :width="260">
      <NDrawerContent body-content-style="padding: 0">
        <div class="sider-brand"><BrandMark size="sm" /></div>
        <NMenu :value="String(route.name)" :options="menuOptions" :indent="20" />
      </NDrawerContent>
    </NDrawer>

    <NLayout class="main">
      <NLayoutHeader class="header">
        <NButton v-if="isMobile" quaternary circle :aria-label="t('nav.openMenu')" @click="drawerOpen = true">
          <template #icon><NIcon><MenuOutline /></NIcon></template>
        </NButton>
        <h1 class="title">{{ pageTitle }}</h1>
        <PreferenceSwitches />
        <NDropdown trigger="click" :options="userOptions" @select="onUserAction">
          <NButton quaternary class="user">
            <template #icon><NIcon><PersonCircleOutline /></NIcon></template>
            <span class="username">{{ session.user?.username }}</span>
          </NButton>
        </NDropdown>
      </NLayoutHeader>
      <NLayoutContent class="content" content-class="content-inner">
        <RouterView />
      </NLayoutContent>
    </NLayout>
  </NLayout>
</template>

<style scoped>
.shell {
  height: 100vh;
}
.sider-brand {
  padding: 20px 24px 16px;
}
:deep(.nav-inbox) {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 60px;
  padding: 0 20px 0 28px;
  border-bottom: 1px solid var(--pl-line);
}
.title {
  flex: 1;
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.username {
  max-width: 10em;
  overflow: hidden;
  text-overflow: ellipsis;
}
.content :deep(.content-inner) {
  max-width: 1120px;
  padding: 28px;
}
@media (max-width: 767px) {
  .header {
    padding: 0 12px;
  }
  .content :deep(.content-inner) {
    padding: 20px 16px;
  }
  .username {
    display: none;
  }
}
</style>
