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
import MailRow from '@/components/MailRow.vue'
import { isPersonal } from '@/stores/mode'

/** A received message in the list: MailRow with its attachment clip, code or link, and star. */
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
  <MailRow
    :id="message.id"
    :who="message.fromName || message.fromAddress"
    :subject="message.subject || t('inbox.noSubject')"
    :snippet="message.snippet"
    :time="message.receivedAt"
    :unread="!message.isRead"
    :selected="selected"
    :mailbox="showMailbox ? message.mailboxNote || message.mailboxAddress.split('@')[0] : undefined"
    :mailbox-title="message.mailboxAddress"
    :mailbox-mono="!message.mailboxNote"
    @open="$emit('open')"
  >
    <template v-if="message.hasAttachments" #icon>
      <NIcon class="clip" :aria-label="t('inbox.attachments')"><AttachOutline /></NIcon>
    </template>
    <template #badge>
      <CodeChip v-if="message.verificationCode" :code="message.verificationCode" :message="message" />
      <LinkChip v-else-if="message.verificationLink" :link="message.verificationLink" :message="message" />
    </template>
    <template v-if="isPersonal()" #action>
      <button
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
    </template>
  </MailRow>
</template>

<style scoped>
.clip {
  margin-right: 4px;
  vertical-align: -2px;
  color: var(--pl-muted);
}
.star {
  grid-area: action;
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
</style>
