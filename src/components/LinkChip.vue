<script setup lang="ts">
import { OpenOutline } from '@vicons/ionicons5'
import { NIcon } from 'naive-ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { markHandled, type CodeMessage } from '@/composables/useCopyCode'
import { safeLink } from '@/lib/links'

/**
 * Opens a verification link in a new tab (a real anchor, so no popup blocker) and marks the message
 * read. The host is always shown on hover and to screen readers: the link comes from the mail.
 */
const props = defineProps<{ link: string; message?: CodeMessage }>()
const { t } = useI18n()
const url = computed(() => safeLink(props.link))
</script>

<template>
  <a
    v-if="url"
    class="chip"
    :class="{ done: message?.isRead }"
    :href="url.href"
    target="_blank"
    rel="noopener noreferrer nofollow"
    referrerpolicy="no-referrer"
    :title="t('inbox.openLinkTitle', { host: url.hostname })"
    :aria-label="t('inbox.openLinkTitle', { host: url.hostname })"
    @click.stop="markHandled(message)"
  >
    <span class="pl-mark">{{ t('inbox.openLink') }}</span>
    <NIcon class="icon"><OpenOutline /></NIcon>
  </a>
</template>

<style scoped>
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  border-radius: 4px;
  color: var(--pl-muted);
  font-size: 0.875rem;
  text-decoration: none;
  white-space: nowrap;
}
.chip:hover .icon,
.chip:focus-visible .icon {
  color: var(--pl-blue);
}
.chip:focus-visible {
  outline: 2px solid var(--pl-blue);
  outline-offset: 2px;
}
/* Already opened (read): no highlighter, so amber only marks links still waiting. */
.done .pl-mark {
  background: none;
  color: var(--pl-muted);
}
</style>
