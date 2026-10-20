<script setup lang="ts">
import { CopyOutline, CreateOutline, HelpCircleOutline } from '@vicons/ionicons5'
import { NButton, NIcon, NInput, NSwitch, NTooltip, useDialog, useMessage } from 'naive-ui'
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import { MAILBOX_COUNT_CAP, NOTE_MAX, type PublicMailbox } from '../../shared/api'
import { errorCodeOf } from '@/api/client'
import { mailboxApi } from '@/api/mailboxes'
import { copyText } from '@/composables/useClipboard'
import { formatCount, formatDateTime, formatRelative } from '@/lib/format'

const props = defineProps<{ mailbox: PublicMailbox; fresh?: boolean }>()
const emit = defineEmits<{ changed: [mailbox: PublicMailbox] }>()

const { t } = useI18n()
const message = useMessage()
const dialog = useDialog()

const editing = ref(false)
const draft = ref('')
const saving = ref(false)
const noteInput = ref<InstanceType<typeof NInput> | null>(null)
const savingSubaddress = ref(false)

/** "box+shop@example.com": built here because vue-i18n can't hold '@' in messages. */
const subaddressExample = computed(() => props.mailbox.address.replace('@', '+shop@'))

async function copy(text = props.mailbox.address): Promise<void> {
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

async function setStatus(status: 'active' | 'disabled'): Promise<void> {
  try {
    const { mailbox } = await mailboxApi.update(props.mailbox.id, { status })
    message.success(t(status === 'active' ? 'mailboxes.enabledToast' : 'mailboxes.disabledToast', { address: mailbox.address }))
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

function confirmDisable(): void {
  dialog.warning({
    title: t('mailboxes.disableTitle'),
    content: t('mailboxes.disableBody', { address: props.mailbox.address }),
    positiveText: t('mailboxes.disable'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => setStatus('disabled'),
  })
}
</script>

<template>
  <li class="item" :class="{ fresh, disabled: mailbox.status === 'disabled' }">
    <div class="main">
      <div class="address-line">
        <span class="address pl-mono"><span class="local">{{ local }}</span><span class="domain">@{{ domain }}</span></span>
        <NButton quaternary circle size="small" :aria-label="t('home.copyAddressLabel', { address: mailbox.address })" @click="copy()">
          <template #icon><NIcon><CopyOutline /></NIcon></template>
        </NButton>
        <button
          v-if="mailbox.status === 'active' && mailbox.acceptSubaddress"
          type="button"
          class="alias"
          :title="subaddressExample"
          @click="copy(subaddressExample)"
        >
          {{ t('home.copyAlias') }} <span class="pl-mono">+shop</span>
        </button>
      </div>

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

      <p class="meta">
        <span :title="formatDateTime(mailbox.createdAt)">
          {{ t('mailboxes.createdAt', { time: formatRelative(mailbox.createdAt) }) }}
        </span>
        <span v-if="mailbox.lastReceivedAt" :title="formatDateTime(mailbox.lastReceivedAt)">
          {{ t('home.lastReceived', { time: formatRelative(mailbox.lastReceivedAt) }) }}
        </span>
        <span>{{ t('mailboxes.messages', { n: formatCount(mailbox.messageCount, MAILBOX_COUNT_CAP) }, mailbox.messageCount) }}</span>
        <span v-if="mailbox.unreadCount > 0" class="unread">{{ t('mailboxes.unread', { n: formatCount(mailbox.unreadCount, MAILBOX_COUNT_CAP) }) }}</span>
        <label v-if="mailbox.status === 'active'" class="subaddress">
          <NSwitch size="small" :value="mailbox.acceptSubaddress" :loading="savingSubaddress" @update:value="setSubaddress" />
          <span>{{ t('mailboxes.subaddress') }}</span>
          <NTooltip>
            <template #trigger>
              <NIcon class="help" :aria-label="t('mailboxes.subaddressHelp')"><HelpCircleOutline /></NIcon>
            </template>
            {{ t('mailboxes.subaddressHelp') }}
            <span class="pl-mono">{{ subaddressExample }}</span>
          </NTooltip>
        </label>
      </p>
    </div>

    <div class="actions">
      <RouterLink v-if="mailbox.messageCount > 0" class="view-mail" :to="{ name: 'inbox', query: { mailbox: mailbox.id } }">
        {{ t('mailboxes.viewMail') }} →
      </RouterLink>
      <NButton v-if="mailbox.status === 'active'" size="small" quaternary @click="confirmDisable">{{ t('mailboxes.disable') }}</NButton>
      <NButton v-else size="small" type="primary" secondary @click="setStatus('active')">{{ t('mailboxes.enable') }}</NButton>
    </div>
  </li>
</template>

<style scoped>
.item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 18px 14px 20px;
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
.main {
  flex: 1;
  min-width: 0;
}
.address-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 6px;
}
.address {
  font-size: 1rem;
  overflow-wrap: anywhere;
}
.local {
  font-weight: 700;
}
.domain {
  color: var(--pl-faint);
}
.disabled .local {
  color: var(--pl-muted);
}
.alias {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--pl-line);
  border-radius: 999px;
  background: none;
  color: var(--pl-ink);
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}
.alias .pl-mono {
  color: var(--pl-muted);
}
.alias:hover {
  border-color: color-mix(in srgb, var(--pl-blue) 45%, var(--pl-line));
}
.alias:focus-visible {
  outline: 2px solid var(--pl-blue);
  outline-offset: 2px;
}
.note {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  margin: 2px 0 0;
  padding: 2px 0;
  border: 0;
  background: none;
  color: var(--pl-ink);
  font: inherit;
  font-size: 0.875rem;
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
  max-width: 420px;
  margin-top: 4px;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 16px;
  margin: 6px 0 0;
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.unread {
  color: var(--pl-blue);
  font-weight: 650;
}
.subaddress {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.help {
  cursor: help;
}
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.view-mail {
  color: var(--pl-blue);
  font-size: 0.875rem;
  text-decoration: none;
}
.view-mail:hover {
  text-decoration: underline;
}
@media (max-width: 600px) {
  .item {
    flex-direction: column;
    align-items: stretch;
    padding: 14px 16px;
  }
  .actions {
    justify-content: flex-end;
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
