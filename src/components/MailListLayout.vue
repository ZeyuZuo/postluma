<script setup lang="ts">
import { CloseOutline } from '@vicons/ionicons5'
import { NButton, NIcon, NSkeleton, NSpin } from 'naive-ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useIsMobile } from '@/composables/useIsMobile'

/**
 * The page shared by the inbox and Sent: a toolbar over a list, and a drawer that slides over the
 * list on wider screens and replaces it on phones. The drawer has its full size from the first
 * frame, so it doesn't jump when the message inside finishes loading.
 */
const props = defineProps<{
  listLabel: string
  drawerLabel: string
  drawerOpen: boolean
  loading: boolean
  loadingMore: boolean
  /** Rows on show; the rows themselves are the default slot. */
  count: number
  hasMore: boolean
  emptyText: string
  /** Keyboard help under the list, on wider screens. */
  hint: string
}>()
defineEmits<{ closeDrawer: []; loadMore: [] }>()

const { t } = useI18n()
const isMobile = useIsMobile()
const showList = computed(() => !isMobile.value || !props.drawerOpen)
</script>

<template>
  <div class="mail-page" :class="{ mobile: isMobile }">
    <section v-if="showList" class="list-pane" :aria-label="listLabel">
      <div class="toolbar"><slot name="toolbar" :mobile="isMobile" /></div>

      <NSpin :show="loading && count > 0" :delay="150" class="list-spin">
        <div v-if="loading && !count" class="skeleton" aria-hidden="true">
          <div v-for="i in 8" :key="i" class="skeleton-row">
            <NSkeleton text :width="120" />
            <NSkeleton text :width="`${40 + ((i * 13) % 35)}%`" />
            <NSkeleton text :width="48" />
          </div>
        </div>
        <template v-else-if="count">
          <ul class="list"><slot /></ul>
          <div v-if="hasMore" class="more">
            <NButton :loading="loadingMore" @click="$emit('loadMore')">{{ t('common.loadMore') }}</NButton>
          </div>
        </template>
        <p v-else-if="!loading" class="empty">{{ emptyText }}</p>
      </NSpin>
      <p v-if="!isMobile && count" class="keys">{{ hint }}</p>
    </section>

    <Transition name="drawer">
      <aside v-if="drawerOpen" class="drawer" :aria-label="drawerLabel">
        <NButton v-if="!isMobile" class="close" quaternary circle :aria-label="t('inbox.close')" @click="$emit('closeDrawer')">
          <template #icon><NIcon><CloseOutline /></NIcon></template>
        </NButton>
        <slot name="drawer" :mobile="isMobile" />
      </aside>
    </Transition>
  </div>
</template>

<style scoped>
.mail-page {
  position: relative;
  display: flex;
  flex-direction: column;
  height: calc(100dvh - var(--pl-chrome, 120px));
  min-height: 480px;
}
.list-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.list-spin {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--pl-line);
  border-radius: 14px;
  background: var(--pl-surface);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.skeleton-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  height: 46px;
  padding: 0 16px 0 36px;
  border-bottom: 1px solid var(--pl-line);
}
.empty {
  margin: 0;
  padding: 56px 24px;
  color: var(--pl-muted);
  text-align: center;
  line-height: 1.7;
}
.more {
  display: flex;
  justify-content: center;
  padding: 14px;
}
.keys {
  margin: 8px 4px 0;
  color: var(--pl-faint);
  font-size: 0.75rem;
}
.drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 5;
  width: min(var(--pl-mail-width), 86%);
  padding: 20px 28px 24px;
  box-sizing: border-box;
  overflow: auto;
  border: 1px solid var(--pl-line);
  border-radius: 16px;
  background: var(--pl-surface);
  box-shadow: -24px 0 48px rgb(19 22 27 / 0.12);
}
:root[data-theme='dark'] .drawer {
  box-shadow: -24px 0 48px rgb(0 0 0 / 0.45);
}
.close {
  position: absolute;
  top: 18px;
  left: 16px;
  z-index: 1;
}
/* Room for the close button beside the compose title. */
.mail-page:not(.mobile) .drawer :deep(.compose > .title) {
  padding-left: 28px;
  line-height: 34px;
}
.drawer-enter-active,
.drawer-leave-active {
  transition: transform 0.2s ease-out, opacity 0.2s ease-out;
}
.drawer-enter-from,
.drawer-leave-to {
  transform: translateX(24px);
  opacity: 0;
}
.mail-page.mobile {
  height: auto;
  min-height: 0;
}
.mail-page.mobile .list-spin {
  overflow: visible;
}
.mail-page.mobile .drawer {
  position: static;
  width: auto;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
@media (prefers-reduced-motion: reduce) {
  .drawer-enter-active,
  .drawer-leave-active {
    transition: none;
  }
}
</style>
