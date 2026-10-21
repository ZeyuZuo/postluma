<script setup lang="ts">
import { NButton, NInput, NSelect, useMessage } from 'naive-ui'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { RECIPIENT_PATTERN, SEND_SUBJECT_MAX, type MessageDetail, type PublicMailbox, type SentMessageDetail } from '../../shared/api'
import { errorCodeOf } from '@/api/client'
import { mailboxApi } from '@/api/mailboxes'
import { outboxApi } from '@/api/outbox'
import { currentMailboxId } from '@/stores/current'
import { loadOutboxStatus, outbox } from '@/stores/outbox'

/**
 * Plain-text compose, new or reply. Only the user's own addresses on sending domains are offered;
 * a reply starts from the address it was sent to, quotes the original and threads with it.
 */
const props = defineProps<{ replyTo?: MessageDetail | null; fromId?: string }>()
const emit = defineEmits<{ sent: [message: SentMessageDetail]; cancel: [] }>()

const QUOTE_CHARS = 4_000

const { t } = useI18n()
const toast = useMessage()
const mailboxes = ref<PublicMailbox[]>([])
const from = ref<string | null>(null)
const to = ref(props.replyTo ? props.replyTo.fromAddress : '')
const subject = ref(props.replyTo ? replySubject(props.replyTo.subject) : '')
const text = ref(props.replyTo ? `\n\n${quote(props.replyTo)}` : '')
const sending = ref(false)
const loaded = ref(false)
// One key per compose: a double click or a retry after a timeout never sends twice.
const idempotencyKey = crypto.randomUUID().replace(/-/g, '')

function replySubject(s: string): string {
  return /^re:/i.test(s.trim()) ? s.trim() : `Re: ${s.trim()}`.slice(0, SEND_SUBJECT_MAX)
}

function quote(m: MessageDetail): string {
  const body = (m.textBody ?? m.snippet ?? '').trim().slice(0, QUOTE_CHARS)
  const lines = body.split(/\r?\n/).map((l) => `> ${l}`)
  return `${t('compose.quoteHeader', { who: m.fromName || m.fromAddress })}\n${lines.join('\n')}`
}

const recipients = computed(() =>
  to.value
    .split(/[\s,;，；]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
)
const badRecipient = computed(() => recipients.value.find((r) => !RECIPIENT_PATTERN.test(r)) ?? null)
const maxRecipients = computed(() => outbox.status?.maxRecipients ?? 1)
const remaining = computed(() => outbox.status?.remaining ?? 0)
const options = computed(() => mailboxes.value.map((m) => ({ value: m.id, label: m.note ? `${m.address} · ${m.note}` : m.address })))
const problem = computed(() => {
  if (!from.value) return t('compose.noFrom')
  if (!recipients.value.length) return t('compose.needRecipient')
  if (badRecipient.value) return t('compose.badRecipient', { address: badRecipient.value })
  if (recipients.value.length > maxRecipients.value) return t('compose.tooMany', { n: maxRecipients.value })
  if (!subject.value.trim()) return t('compose.needSubject')
  if (!text.value.trim()) return t('compose.needText')
  if (remaining.value <= 0) return t('errors.send_quota_exceeded')
  return null
})

onMounted(async () => {
  await loadOutboxStatus(true)
  const allowed = new Set(outbox.status?.mailboxIds ?? [])
  try {
    const res = await mailboxApi.list({ status: 'active' })
    mailboxes.value = res.items.filter((m) => allowed.has(m.id))
  } catch {
    mailboxes.value = []
  }
  // A reply goes out from the address it was sent to; else the chosen one; else the current address.
  const preferred = props.replyTo?.mailboxId ?? props.fromId ?? currentMailboxId().value
  from.value = mailboxes.value.find((m) => m.id === preferred)?.id ?? mailboxes.value[0]?.id ?? null
  loaded.value = true
})

async function send(): Promise<void> {
  if (problem.value || !from.value || sending.value) return
  sending.value = true
  try {
    const { message } = await outboxApi.send({
      mailboxId: from.value,
      to: recipients.value,
      subject: subject.value.trim(),
      text: text.value,
      replyToId: props.replyTo?.id,
      idempotencyKey,
    })
    void loadOutboxStatus(true)
    if (message.status === 'failed') {
      toast.error(t(`sendErrors.${message.error ?? 'provider_unavailable'}`))
      return
    }
    toast.success(t('compose.sent'))
    emit('sent', message)
  } catch (err) {
    toast.error(t(`errors.${errorCodeOf(err)}`))
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <form class="compose" @submit.prevent="send">
    <h2 class="title">{{ replyTo ? t('compose.replyTitle') : t('compose.newTitle') }}</h2>
    <p v-if="loaded && !mailboxes.length" class="blocked">{{ t('compose.noFromHint') }}</p>
    <label class="field">
      <span>{{ t('compose.from') }}</span>
      <NSelect v-model:value="from" :options="options" :placeholder="t('compose.noFrom')" />
    </label>
    <label class="field">
      <span>{{ t('compose.to') }}</span>
      <NInput v-model:value="to" :placeholder="t('compose.toPlaceholder', { n: maxRecipients })" :input-props="{ autocapitalize: 'off', spellcheck: false }" />
    </label>
    <label class="field">
      <span>{{ t('compose.subject') }}</span>
      <NInput v-model:value="subject" :maxlength="SEND_SUBJECT_MAX" />
    </label>
    <label class="field">
      <span class="visually-hidden">{{ t('compose.body') }}</span>
      <NInput v-model:value="text" type="textarea" :autosize="{ minRows: 8, maxRows: 18 }" :placeholder="t('compose.bodyPlaceholder')" />
    </label>
    <div class="foot">
      <span class="meta">{{ problem ?? t('compose.remaining', { n: remaining }) }}</span>
      <NButton quaternary @click="emit('cancel')">{{ t('common.cancel') }}</NButton>
      <button type="submit" class="pl-btn primary" :disabled="Boolean(problem) || sending">{{ sending ? t('compose.sending') : t('compose.send') }}</button>
    </div>
    <p class="note">{{ t('compose.plainTextNote') }}</p>
  </form>
</template>

<style scoped>
.compose {
  display: grid;
  gap: 12px;
}
.title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
}
.field {
  display: grid;
  gap: 4px;
}
.field > span:not(.visually-hidden) {
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.foot {
  display: flex;
  align-items: center;
  gap: 8px;
}
.meta {
  flex: 1;
  min-width: 0;
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.blocked {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--pl-sunken);
  color: var(--pl-ink);
  font-size: 0.875rem;
  line-height: 1.6;
}
.note {
  margin: 0;
  color: var(--pl-faint);
  font-size: 0.75rem;
}
</style>
