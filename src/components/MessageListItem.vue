<script setup lang="ts">
import { AttachOutline } from '@vicons/ionicons5'
import { NIcon } from 'naive-ui'
import { useI18n } from 'vue-i18n'

import type { MessageSummary } from '../../shared/api'
import CodeChip from '@/components/CodeChip.vue'
import { formatDateTime, formatRelative } from '@/lib/format'

defineProps<{ message: MessageSummary; selected?: boolean; showMailbox?: boolean }>()
defineEmits<{ open: [] }>()
const { t } = useI18n()
</script>

<template>
  <li
    class="item"
    :class="{ unread: !message.isRead, selected }"
    tabindex="0"
    role="button"
    :aria-current="selected ? 'true' : undefined"
    @click="$emit('open')"
    @keydown.enter="$emit('open')"
  >
    <div class="row top">
      <span class="dot" aria-hidden="true" />
      <span class="sender">{{ message.fromName || message.fromAddress }}</span>
      <time class="time" :title="formatDateTime(message.receivedAt)">{{ formatRelative(message.receivedAt) }}</time>
    </div>
    <div class="subject">
      <NIcon v-if="message.hasAttachments" class="clip"><AttachOutline /></NIcon>
      {{ message.subject || t('inbox.noSubject') }}
    </div>
    <div class="row bottom">
      <span class="snippet">{{ message.snippet }}</span>
      <CodeChip v-if="message.verificationCode" :code="message.verificationCode" />
    </div>
    <div v-if="showMailbox" class="mailbox pl-mono">{{ message.mailboxAddress }}</div>
  </li>
</template>

<style scoped>
.item {
  position: relative;
  padding: 12px 16px 12px 28px;
  border-top: 1px solid var(--pl-line);
  cursor: pointer;
  outline: none;
}
.item:first-child {
  border-top: 0;
}
.item:hover {
  background: color-mix(in srgb, var(--pl-blue) 4%, transparent);
}
.item:focus-visible {
  box-shadow: inset 0 0 0 2px var(--pl-blue);
}
.item.selected {
  background: color-mix(in srgb, var(--pl-blue) 10%, transparent);
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.dot {
  position: absolute;
  left: 12px;
  top: 19px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: transparent;
}
.unread .dot {
  background: var(--pl-blue);
}
.sender {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.875rem;
}
.unread .sender,
.unread .subject {
  font-weight: 650;
}
.time {
  flex: none;
  color: var(--pl-muted);
  font-size: 0.75rem;
}
.subject {
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.9375rem;
}
.clip {
  vertical-align: -2px;
  color: var(--pl-muted);
}
.bottom {
  margin-top: 2px;
}
.snippet {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.mailbox {
  margin-top: 4px;
  color: var(--pl-muted);
  font-size: 0.75rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
