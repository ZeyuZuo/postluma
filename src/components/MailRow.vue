<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { formatDateTime, formatListTime } from '@/lib/format'

/**
 * One line of a mail list, received or sent: who · subject — snippet · badge · address · time on wide
 * screens, two lines on narrow ones. Every field is attacker-controlled text. The `action` slot is a
 * control with a column of its own (the star).
 */
defineProps<{
  id: string
  who: string
  whoTitle?: string
  subject: string
  snippet?: string | null
  time: number
  unread?: boolean
  selected?: boolean
  /** The user's own address this mail belongs to, for a list that mixes several. */
  mailbox?: string
  mailboxTitle?: string
  mailboxMono?: boolean
}>()
defineEmits<{ open: [] }>()
const { t } = useI18n()
</script>

<template>
  <li
    class="row"
    :class="{ unread, selected, 'with-mailbox': mailbox !== undefined, 'with-action': Boolean($slots.action) }"
    tabindex="0"
    role="button"
    :aria-current="selected ? 'true' : undefined"
    :data-id="id"
    @click="$emit('open')"
    @keydown.enter.self="$emit('open')"
  >
    <span class="dot" :aria-label="unread ? t('inbox.unreadLabel') : undefined" />
    <span class="sender" :title="whoTitle">{{ who }}</span>
    <span class="text">
      <slot name="icon" />
      <span class="subject">{{ subject }}</span>
      <span v-if="snippet" class="snippet"> — {{ snippet }}</span>
    </span>
    <span class="code"><slot name="badge" /></span>
    <span v-if="mailbox !== undefined" class="mailbox" :class="{ 'pl-mono': mailboxMono }" :title="mailboxTitle">{{ mailbox }}</span>
    <slot name="action" />
    <time class="time" :datetime="new Date(time).toISOString()" :title="formatDateTime(time)">{{ formatListTime(time) }}</time>
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
  grid-template-columns: 8px minmax(0, 170px) minmax(0, 1fr) auto minmax(0, 140px) 64px;
  grid-template-areas: 'dot sender text code mailbox time';
}
.row.with-action {
  grid-template-columns: 8px minmax(0, 170px) minmax(0, 1fr) auto 28px 64px;
  grid-template-areas: 'dot sender text code action time';
}
.row.with-action.with-mailbox {
  grid-template-columns: 8px minmax(0, 170px) minmax(0, 1fr) auto minmax(0, 140px) 28px 64px;
  grid-template-areas: 'dot sender text code mailbox action time';
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
  .row.with-action,
  .row.with-action.with-mailbox {
    grid-template-columns: 8px minmax(0, 1fr) 28px auto;
    grid-template-areas:
      'dot sender action time'
      '. text text code'
      '. mailbox mailbox mailbox';
  }
}
</style>
