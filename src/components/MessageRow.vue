<script setup lang="ts">
import { AttachOutline, Star, StarOutline } from '@vicons/ionicons5'
import { NIcon, useMessage } from 'naive-ui'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { MessageSummary } from '../../shared/api'
import { errorCodeOf } from '@/api/client'
import { messageApi } from '@/api/messages'
import CodeChip from '@/components/CodeChip.vue'
import LinkChip from '@/components/LinkChip.vue'
import { formatDateTime, formatListTime } from '@/lib/format'
import { isPersonal } from '@/stores/mode'

/**
 * One message in the inbox list: a single line on wide screens (sender · subject — snippet · code ·
 * address · time), two lines on narrow ones. Every field is attacker-controlled text.
 */
const props = defineProps<{ message: MessageSummary; selected?: boolean; showMailbox?: boolean }>()
const emit = defineEmits<{ open: []; starredChanged: [id: string, isStarred: boolean] }>()
const { t } = useI18n()
const toast = useMessage()
const starring = ref(false)

async function toggleStar(): Promise<void> {
  if (starring.value) return
  const { id, isStarred } = props.message
  starring.value = true
  emit('starredChanged', id, !isStarred)
  try {
    await messageApi.update(id, { starred: !isStarred })
  } catch (err) {
    emit('starredChanged', id, isStarred)
    toast.error(t(`errors.${errorCodeOf(err)}`))
  } finally {
    starring.value = false
  }
}
</script>

<template>
  <li
    class="row"
    :class="{ unread: !message.isRead, selected, 'with-mailbox': showMailbox, personal: isPersonal() }"
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
      <CodeChip v-if="message.verificationCode" :code="message.verificationCode" :message="message" />
      <LinkChip v-else-if="message.verificationLink" :link="message.verificationLink" :message="message" />
    </span>
    <span v-if="showMailbox" class="mailbox" :class="{ 'pl-mono': !message.mailboxNote }" :title="message.mailboxAddress">
      {{ message.mailboxNote || message.mailboxAddress.split('@')[0] }}
    </span>
    <button
      v-if="isPersonal()"
      type="button"
      class="star"
      :class="{ starred: message.isStarred }"
      :aria-label="t(message.isStarred ? 'inbox.unstar' : 'inbox.star')"
      :aria-pressed="message.isStarred"
      :disabled="starring"
      @click.stop="toggleStar"
    >
      <NIcon><Star v-if="message.isStarred" /><StarOutline v-else /></NIcon>
    </button>
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
  grid-template-columns: 8px minmax(0, 170px) minmax(0, 1fr) auto minmax(0, 140px) 64px;
  grid-template-areas: 'dot sender text code mailbox time';
}
.row.personal {
  grid-template-columns: 8px minmax(0, 170px) minmax(0, 1fr) auto 28px 64px;
  grid-template-areas: 'dot sender text code star time';
}
.row.personal.with-mailbox {
  grid-template-columns: 8px minmax(0, 170px) minmax(0, 1fr) auto minmax(0, 140px) 28px 64px;
  grid-template-areas: 'dot sender text code mailbox star time';
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
.star {
  grid-area: star;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--pl-faint);
  font-size: 1rem;
  cursor: pointer;
}
.row:hover .star,
.row:focus-within .star {
  color: var(--pl-muted);
}
.row .star.starred {
  color: var(--pl-ink);
}
.star:focus-visible {
  outline: 2px solid var(--pl-blue);
  outline-offset: -2px;
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
  .row.personal,
  .row.personal.with-mailbox {
    grid-template-columns: 8px minmax(0, 1fr) 28px auto;
    grid-template-areas:
      'dot sender star time'
      '. text text code'
      '. mailbox mailbox mailbox';
  }
}
</style>
