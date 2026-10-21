<script setup lang="ts">
import { CopyOutline, CreateOutline, HelpCircleOutline, MailOutline, PaperPlaneOutline } from '@vicons/ionicons5'
import { NButton, NIcon, NInput, NSwitch, NTooltip, useMessage } from 'naive-ui'
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import { MAILBOX_COUNT_CAP, NOTE_MAX, type PublicMailbox } from '../../shared/api'
import { errorCodeOf } from '@/api/client'
import { mailboxApi } from '@/api/mailboxes'
import { copyText } from '@/composables/useClipboard'
import { formatCount, formatDateTime, formatRelative } from '@/lib/format'
import ComposeDialog from '@/components/ComposeDialog.vue'
import { setCurrentMailbox } from '@/stores/current'
import { canSend, outbox } from '@/stores/outbox'

const props = defineProps<{ mailbox: PublicMailbox; fresh?: boolean }>()
/** Phase 9: this address may send (only shown while sending is allowed for the user). */
const sendable = computed(() => canSend() && (outbox.status?.mailboxIds.includes(props.mailbox.id) ?? false))
const composing = ref(false)
const emit = defineEmits<{ changed: [mailbox: PublicMailbox] }>()

const { t } = useI18n()
const message = useMessage()

const editing = ref(false)
const draft = ref('')
const saving = ref(false)
const noteInput = ref<InstanceType<typeof NInput> | null>(null)
const savingSubaddress = ref(false)

/** "box+shop@example.com": built here because vue-i18n can't hold '@' in messages. */
const subaddressExample = computed(() => props.mailbox.address.replace('@', '+shop@'))

/** Copying an address means you're about to use it: it becomes the home page's current address. */
async function copy(text = props.mailbox.address): Promise<void> {
  if (props.mailbox.status === 'active') setCurrentMailbox(props.mailbox.id)
  const ok = await copyText(text)
  if (ok) message.success(t('common.copied'))
  else message.warning(t('common.copyFailed'))
}

const local = computed(() => props.mailbox.address.split('@')[0])
const domain = computed(() => props.mailbox.address.split('@')[1])

async function startEdit(): Promise<void> {
  draft.value = props.mailbox.note ?? ''
  editing.value = true
  await nextTick()
  noteInput.value?.focus()
}

async function saveNote(): Promise<void> {
  if (!editing.value || saving.value) return
  const next = draft.value.trim()
  if (next === (props.mailbox.note ?? '')) {
    editing.value = false
    return
  }
  saving.value = true
  try {
    const { mailbox } = await mailboxApi.update(props.mailbox.id, { note: next })
    emit('changed', mailbox)
    message.success(t('mailboxes.noteSaved'))
    editing.value = false
  } catch (err) {
    message.error(t(`errors.${errorCodeOf(err)}`))
  } finally {
    saving.value = false
  }
}

/** Disabling is undoable (the page offers "Undo"), so it needs no confirmation dialog. */
async function setStatus(status: 'active' | 'disabled'): Promise<void> {
  try {
    const { mailbox } = await mailboxApi.update(props.mailbox.id, { status })
    if (status === 'active') message.success(t('mailboxes.enabledToast', { address: mailbox.address }))
    emit('changed', mailbox)
  } catch (err) {
    message.error(t(`errors.${errorCodeOf(err)}`))
  }
}

async function setSubaddress(acceptSubaddress: boolean): Promise<void> {
  savingSubaddress.value = true
  try {
    const { mailbox } = await mailboxApi.update(props.mailbox.id, { acceptSubaddress })
    emit('changed', mailbox)
  } catch (err) {
    message.error(t(`errors.${errorCodeOf(err)}`))
  } finally {
    savingSubaddress.value = false
  }
}

</script>

<template>
  <li class="item" :class="{ fresh, disabled: mailbox.status === 'disabled' }">
    <div class="who">
      <p class="address pl-mono"><span class="local">{{ local }}</span><span class="domain">@{{ domain }}</span><span v-if="sendable" class="send-tag">{{ t('compose.canSendTag') }}</span></p>
      <form v-if="editing" class="note-edit" @submit.prevent="saveNote">
        <NInput
          ref="noteInput"
          v-model:value="draft"
          size="small"
          :maxlength="NOTE_MAX"
          :placeholder="t('mailboxes.notePlaceholder')"
          :loading="saving"
          @blur="saveNote"
          @keydown.esc="editing = false"
        />
      </form>
      <button v-else type="button" class="note" :class="{ empty: !mailbox.note }" @click="startEdit">
        <span>{{ mailbox.note || t('mailboxes.notePlaceholder') }}</span>
        <NIcon class="note-icon" :aria-label="t('common.edit')"><CreateOutline /></NIcon>
      </button>
    </div>

    <div class="stats">
      <p>
        {{ t('mailboxes.messages', { n: formatCount(mailbox.messageCount, MAILBOX_COUNT_CAP) }, mailbox.messageCount) }}
        <span v-if="mailbox.unreadCount > 0" class="unread">· {{ t('mailboxes.unread', { n: formatCount(mailbox.unreadCount, MAILBOX_COUNT_CAP) }) }}</span>
      </p>
      <p class="muted" :title="formatDateTime(mailbox.lastReceivedAt ?? mailbox.createdAt)">
        {{
          mailbox.lastReceivedAt
            ? t('home.lastReceived', { time: formatRelative(mailbox.lastReceivedAt) })
            : t('mailboxes.createdAt', { time: formatRelative(mailbox.createdAt) })
        }}
      </p>
    </div>

    <div class="actions">
      <div v-if="mailbox.status === 'active'" class="alias">
        <NSwitch size="small" :value="mailbox.acceptSubaddress" :loading="savingSubaddress" @update:value="setSubaddress" />
        <span>{{ t('mailboxes.subaddress') }}</span>
        <NTooltip>
          <template #trigger>
            <NIcon class="help" :aria-label="t('mailboxes.subaddressHelp')"><HelpCircleOutline /></NIcon>
          </template>
          {{ t('mailboxes.subaddressHelp') }}
          <span class="pl-mono">{{ subaddressExample }}</span>
        </NTooltip>
      </div>

      <NTooltip>
        <template #trigger>
          <button type="button" class="icon-btn" :aria-label="t('home.copyAddressLabel', { address: mailbox.address })" @click="copy()">
            <NIcon><CopyOutline /></NIcon>
          </button>
        </template>
        {{ t('home.copyAddress') }}
      </NTooltip>
      <NTooltip>
        <template #trigger>
          <RouterLink class="icon-btn" :to="{ name: 'inbox', query: { mailbox: mailbox.id } }" :aria-label="t('mailboxes.viewMail')">
            <NIcon><MailOutline /></NIcon>
          </RouterLink>
        </template>
        {{ t('mailboxes.viewMail') }}
      </NTooltip>
      <NTooltip v-if="sendable && mailbox.status === 'active'">
        <template #trigger>
          <button type="button" class="icon-btn" :aria-label="t('compose.fromAddressLabel', { address: mailbox.address })" @click="composing = true">
            <NIcon><PaperPlaneOutline /></NIcon>
          </button>
        </template>
        {{ t('compose.newButton') }}
      </NTooltip>
      <ComposeDialog :show="composing" :from-id="mailbox.id" @close="composing = false" />
      <NButton v-if="mailbox.status === 'active'" size="small" secondary class="status-btn" @click="setStatus('disabled')">
        {{ t('mailboxes.disable') }}
      </NButton>
      <NButton v-else size="small" secondary class="status-btn" @click="setStatus('active')">{{ t('mailboxes.enable') }}</NButton>
    </div>
  </li>
</template>

<style scoped>
.item {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  min-height: 64px;
  padding: 10px 14px 10px 20px;
  border-top: 1px solid var(--pl-line);
}
.item:first-child {
  border-top: 0;
}
.item.fresh {
  animation: arrive 1.6s ease-out;
}
@keyframes arrive {
  from {
    background-color: var(--pl-code-bg);
  }
}
p {
  margin: 0;
}
.who {
  min-width: 0;
}
.address {
  font-size: 0.9375rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.local {
  font-weight: 700;
}
.send-tag {
  margin-left: 8px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--pl-blue-soft);
  color: var(--pl-blue);
  font-family: var(--pl-font);
  font-size: 0.6875rem;
  font-weight: 650;
  vertical-align: 2px;
}
.domain {
  color: var(--pl-faint);
}
.disabled .local {
  color: var(--pl-muted);
}
.note {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  margin-top: 2px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--pl-ink);
  font: inherit;
  font-size: 0.8125rem;
  text-align: left;
  cursor: text;
}
.note span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.note.empty {
  color: var(--pl-faint);
}
.note-icon {
  flex: none;
  opacity: 0;
  color: var(--pl-muted);
}
.note:hover .note-icon,
.note:focus-visible .note-icon {
  opacity: 1;
}
.note:focus-visible {
  outline: 2px solid var(--pl-blue);
  outline-offset: 2px;
  border-radius: 3px;
}
.note-edit {
  max-width: 360px;
  margin-top: 2px;
}
.stats {
  min-width: 0;
  font-size: 0.8125rem;
  white-space: nowrap;
}
.stats .muted {
  margin-top: 2px;
  color: var(--pl-muted);
  overflow: hidden;
  text-overflow: ellipsis;
}
.unread {
  color: var(--pl-blue);
  font-weight: 650;
}
.alias {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin-right: 10px;
  padding-right: 12px;
  border-right: 1px solid var(--pl-line);
  color: var(--pl-muted);
  font-size: 0.8125rem;
  white-space: nowrap;
}
.help {
  cursor: help;
}
.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 9px;
  background: none;
  color: var(--pl-muted);
  font-size: 1.0625rem;
  cursor: pointer;
}
.icon-btn:hover {
  background: var(--pl-sunken);
  color: var(--pl-ink);
}
.status-btn {
  margin-left: 6px;
}
.icon-btn:focus-visible {
  outline: 2px solid var(--pl-blue);
  outline-offset: -2px;
}
@media (max-width: 719px) {
  .item {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'who'
      'stats'
      'actions';
    gap: 6px 12px;
    padding: 12px 10px 12px 16px;
  }
  .who {
    grid-area: who;
  }
  .stats {
    grid-area: stats;
    display: flex;
    gap: 10px;
  }
  .stats .muted {
    margin-top: 0;
  }
  .actions {
    grid-area: actions;
  }
  .alias {
    margin-right: auto;
    border-right: 0;
  }
  .note-icon {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .item.fresh {
    animation: none;
  }
}
</style>
