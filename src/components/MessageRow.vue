<script setup lang="ts">
import { AttachOutline } from '@vicons/ionicons5'
import { NIcon } from 'naive-ui'
import { useI18n } from 'vue-i18n'

import type { MessageSummary } from '../../shared/api'
import CodeChip from '@/components/CodeChip.vue'
import { formatDateTime, formatListTime } from '@/lib/format'

/**
 * One message in the inbox list: a single line on wide screens (sender · subject — snippet · code ·
 * address · time), two lines on narrow ones. Every field is attacker-controlled text.
 */
defineProps<{ message: MessageSummary; selected?: boolean; showMailbox?: boolean }>()
defineEmits<{ open: [] }>()
const { t } = useI18n()
</script>

<template>
  <li
    class="row"
    :class="{ unread: !message.isRead, selected, 'with-mailbox': showMailbox }"
    tabindex="0"
    role="button"
    :aria-current="selected ? 'true' : undefined"
    :data-id="message.id"
    @click="$emit('open')"
    @keydown.enter.self="$emit('open')"
  >
    <span class="dot" :aria-label="message.isRead ? undefined : t('inbox.unreadLabel')" />
    <span class="sender">{{ message.fromName || message.fromAddress }}</span>
    <span class="text">
      <NIcon v-if="message.hasAttachments" class="clip" :aria-label="t('inbox.attachments')"><AttachOutline /></NIcon>
      <span class="subject">{{ message.subject || t('inbox.noSubject') }}</span>
      <span v-if="message.snippet" class="snippet"> — {{ message.snippet }}</span>
    </span>
    <span class="code">
      <CodeChip v-if="message.verificationCode" :code="message.verificationCode" />
    </span>
    <span v-if="showMailbox" class="mailbox pl-mono" :title="message.mailboxAddress">{{ message.mailboxAddress.split('@')[0] }}</span>
    <time class="time" :datetime="new Date(message.receivedAt).toISOString()" :title="formatDateTime(message.receivedAt)">
      {{ formatListTime(message.receivedAt) }}
    </time>
  </li>
</template>

<style scoped>
.row {
  display: grid;
  grid-template-columns: 8px minmax(0, 170px) minmax(0, 1fr) auto 64px;
  grid-template-areas: 'dot sender text code time';
  align-items: center;
  gap: 14px;
  min-height: 46px;
  padding: 0 16px 0 14px;
  border-bottom: 1px solid var(--pl-line);
  cursor: pointer;
  outline: none;
}
.row.with-mailbox {
  grid-template-columns: 8px minmax(0, 170px) minmax(0, 1fr) auto minmax(0, 120px) 64px;
  grid-template-areas: 'dot sender text code mailbox time';
}
.row:hover {
  background: var(--pl-paper);
}
.row:focus-visible {
  box-shadow: inset 0 0 0 2px var(--pl-blue);
}
.row.selected {
  background: var(--pl-blue-soft);
}
.dot {
  grid-area: dot;
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.unread .dot {
  background: var(--pl-blue);
}
.sender {
  grid-area: sender;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.text {
  grid-area: text;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.unread .sender,
.unread .subject {
  font-weight: 700;
}
.clip {
  margin-right: 4px;
  vertical-align: -2px;
  color: var(--pl-muted);
}
.snippet {
  color: var(--pl-muted);
}
.code {
  grid-area: code;
  display: flex;
  justify-content: flex-end;
}
.mailbox {
  grid-area: mailbox;
  justify-self: start;
  max-width: 100%;
  padding: 0 7px;
  border-radius: 6px;
  background: var(--pl-sunken);
  color: var(--pl-muted);
  font-size: 0.75rem;
  line-height: 22px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.time {
  grid-area: time;
  color: var(--pl-muted);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}
.unread .time {
  color: var(--pl-ink);
  font-weight: 600;
}
@media (max-width: 899px) {
  .row,
  .row.with-mailbox {
    grid-template-columns: 8px minmax(0, 1fr) auto;
    grid-template-areas:
      'dot sender time'
      '. text code'
      '. mailbox mailbox';
    gap: 2px 10px;
    padding: 10px 14px 10px 12px;
  }
  .mailbox {
    margin-top: 4px;
    line-height: 20px;
  }
}
</style>
