<script setup lang="ts">
import {
  ArrowBackOutline,
  CopyOutline,
  DocumentOutline,
  DownloadOutline,
  InformationCircleOutline,
  MailUnreadOutline,
  TrashOutline,
} from '@vicons/ionicons5'
import { NAlert, NButton, NIcon, NSpin, NTooltip, useDialog, useMessage } from 'naive-ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import type { MessageDetail } from '../../shared/api'
import { errorCodeOf } from '@/api/client'
import { messageApi } from '@/api/messages'
import MailFrame from '@/components/MailFrame.vue'
import TextBody from '@/components/TextBody.vue'
import { copyText } from '@/composables/useClipboard'
import { formatDateTime } from '@/lib/format'
import { prepareMailHtml } from '@/lib/mail-html'
import { forgetOriginal, loadOriginal, saveFile, toDataUri, type OriginalMail } from '@/lib/original-mail'
import { adjustUnread } from '@/stores/inbox'

const props = defineProps<{ id: string; showBack?: boolean }>()
const emit = defineEmits<{ back: []; deleted: [id: string]; readChanged: [id: string, isRead: boolean] }>()

const { t } = useI18n()
const toast = useMessage()
const dialog = useDialog()

const message = ref<MessageDetail | null>(null)
const loading = ref(false)
const failed = ref(false)
const allowRemoteImages = ref(false)
/** The original message, parsed in the browser (attachments, inline images); loaded on demand. */
const original = ref<OriginalMail | null>(null)
const originalLoading = ref(false)

/** Inline images are fetched automatically for messages up to this size, on request beyond it. */
const AUTO_ORIGINAL_BYTES = 3 * 1024 * 1024
/** A truncated body is completed from the original automatically up to this size. */
const AUTO_FULL_BODY_BYTES = 10 * 1024 * 1024

/** The complete body once the original is parsed; until then, what the server kept. */
const htmlBody = computed(() => (original.value ? original.value.html : message.value?.htmlBody) ?? null)
const textBody = computed(() => (original.value ? original.value.text : message.value?.textBody) ?? null)
/** Only a message whose original we haven't read may still be missing part of its body. */
const bodyIncomplete = computed(() => Boolean(message.value?.isTruncated) && !original.value)
const prepared = computed(() => (htmlBody.value ? prepareMailHtml(htmlBody.value, original.value?.inlineImages) : null))
/** Server metadata until the original is parsed; then the complete list, with content. */
const files = computed(() => original.value?.files ?? message.value?.attachments.filter((a) => !a.inline) ?? [])
const imagesBlocked = computed(
  () =>
    (prepared.value?.hasRemoteImages && !allowRemoteImages.value) ||
    (prepared.value?.hasInlineImages && message.value?.hasRaw && !original.value),
)

/** Raster image attachments get a thumbnail once the original is parsed (data: URI, CSP-safe). */
const PREVIEW_TYPE = /^image\/(?:png|jpe?g|gif|webp)$/
const PREVIEW_MAX_BYTES = 2 * 1024 * 1024
const previews = computed(() =>
  (original.value?.files ?? []).map((f) =>
    PREVIEW_TYPE.test(f.contentType.toLowerCase()) && f.size <= PREVIEW_MAX_BYTES ? toDataUri(f.contentType.toLowerCase(), f.content) : null,
  ),
)

const initial = computed(() => (message.value?.fromName || message.value?.fromAddress || '?').trim().slice(0, 1).toUpperCase())
/** "box+shop@example.com" → box / +shop / @example.com, so the alias part can be highlighted. */
const toParts = computed(() => {
  const address = message.value?.toAddress ?? ''
  const at = address.lastIndexOf('@')
  const local = at === -1 ? address : address.slice(0, at)
  const plus = local.indexOf('+')
  return {
    base: plus === -1 ? local : local.slice(0, plus),
    tag: plus === -1 ? '' : local.slice(plus),
    domain: at === -1 ? '' : address.slice(at),
  }
})

async function copyCode(code: string): Promise<void> {
  if (await copyText(code)) toast.success(t('inbox.codeCopied', { code }))
  else toast.warning(t('common.copyFailed'))
}

async function ensureOriginal(): Promise<OriginalMail | null> {
  const current = message.value
  if (!current?.hasRaw) return null
  if (original.value) return original.value
  originalLoading.value = true
  try {
    const parsed = await loadOriginal(current.id)
    if (message.value?.id === current.id) original.value = parsed
    return parsed
  } catch (err) {
    toast.error(t(`errors.${errorCodeOf(err)}`))
    return null
  } finally {
    originalLoading.value = false
  }
}

async function loadImages(): Promise<void> {
  allowRemoteImages.value = true
  await ensureOriginal()
}

async function download(index: number): Promise<void> {
  const parsed = await ensureOriginal()
  const file = parsed?.files[index]
  if (file) saveFile(file.content, file.filename || t('inbox.attachmentFallbackName', { n: index + 1 }))
}

/** The badge only counts active mailboxes, so only their messages move it. */
function adjustBadge(m: MessageDetail, delta: number): void {
  if (m.mailboxStatus === 'active') adjustUnread(delta)
}

async function load(id: string): Promise<void> {
  loading.value = true
  failed.value = false
  allowRemoteImages.value = false
  original.value = null
  let detail: MessageDetail
  try {
    detail = (await messageApi.get(id)).message
  } catch {
    if (id !== props.id) return // a newer selection owns the view
    failed.value = true
    message.value = null
    loading.value = false
    return
  }
  if (id !== props.id) return
  message.value = detail
  loading.value = false
  const hasInline = detail.attachments.some((a) => a.inline)
  if (
    detail.hasRaw &&
    ((hasInline && detail.size <= AUTO_ORIGINAL_BYTES) || (detail.isTruncated && detail.size <= AUTO_FULL_BODY_BYTES))
  ) {
    void ensureOriginal()
  }
  if (detail.isRead) return
  try {
    await messageApi.setRead(id, true)
    if (message.value?.id === id) message.value.isRead = true
    adjustBadge(detail, -1)
    emit('readChanged', id, true)
  } catch {
    // Not fatal: the message stays readable; the badge self-corrects on the next recount.
  }
}

watch(() => props.id, (id) => void load(id), { immediate: true })

async function markUnread(): Promise<void> {
  if (!message.value) return
  try {
    await messageApi.setRead(message.value.id, false)
    message.value.isRead = false
    adjustBadge(message.value, 1)
    emit('readChanged', message.value.id, false)
  } catch (err) {
    toast.error(t(`errors.${errorCodeOf(err)}`))
  }
}

function confirmDelete(): void {
  const current = message.value
  if (!current) return
  dialog.warning({
    title: t('inbox.deleteTitle'),
    content: t('inbox.deleteBody'),
    positiveText: t('inbox.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        await messageApi.remove(current.id)
        forgetOriginal(current.id)
        if (!current.isRead) adjustBadge(current, -1)
        toast.success(t('inbox.deleted'))
        emit('deleted', current.id)
      } catch (err) {
        toast.error(t(`errors.${errorCodeOf(err)}`))
      }
    },
  })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <NSpin :show="loading" :delay="150" class="spin">
    <article v-if="message" class="detail">
      <div class="toolbar">
        <NButton v-if="showBack" quaternary size="small" @click="emit('back')">
          <template #icon><NIcon><ArrowBackOutline /></NIcon></template>
          {{ t('inbox.back') }}
        </NButton>
        <span class="spacer" />
        <NTooltip v-if="message.hasRaw">
          <template #trigger>
            <a class="icon-btn" :href="messageApi.rawUrl(message.id)" download="message.eml" :aria-label="t('inbox.downloadOriginal')">
              <NIcon><DownloadOutline /></NIcon>
            </a>
          </template>
          {{ t('inbox.downloadOriginal') }}
        </NTooltip>
        <NTooltip>
          <template #trigger>
            <button type="button" class="icon-btn" :aria-label="t('inbox.markUnread')" @click="markUnread">
              <NIcon><MailUnreadOutline /></NIcon>
            </button>
          </template>
          {{ t('inbox.markUnread') }}
        </NTooltip>
        <NTooltip>
          <template #trigger>
            <button type="button" class="icon-btn danger" :aria-label="t('inbox.delete')" @click="confirmDelete">
              <NIcon><TrashOutline /></NIcon>
            </button>
          </template>
          {{ t('inbox.delete') }}
        </NTooltip>
      </div>

      <h2 class="subject">{{ message.subject || t('inbox.noSubject') }}</h2>

      <div class="sender">
        <span class="avatar" aria-hidden="true">{{ initial }}</span>
        <div class="who">
          <p class="from">
            <span v-if="message.fromName" class="name">{{ message.fromName }}</span>
            <span class="pl-mono addr">{{ message.fromAddress }}</span>
          </p>
          <p class="to">
            {{ t('inbox.sentTo') }}
            <span class="pl-mono addr">{{ toParts.base }}<mark v-if="toParts.tag" class="tag-part">{{ toParts.tag }}</mark>{{ toParts.domain }}</span>
            <span v-if="message.mailboxNote" class="note-tag">{{ message.mailboxNote }}</span>
            <span v-if="message.mailboxStatus === 'disabled'" class="tag">{{ t('inbox.disabledMailbox') }}</span>
          </p>
          <p v-if="message.envelopeFrom && message.envelopeFrom !== message.fromAddress" class="via">
            {{ t('inbox.deliveredBy') }} <span class="pl-mono">{{ message.envelopeFrom }}</span>
            <NTooltip>
              <template #trigger><NIcon class="hint" :aria-label="t('inbox.deliveredByHint')"><InformationCircleOutline /></NIcon></template>
              {{ t('inbox.deliveredByHint') }}
            </NTooltip>
          </p>
        </div>
        <time class="when" :datetime="new Date(message.receivedAt).toISOString()">{{ formatDateTime(message.receivedAt) }}</time>
      </div>

      <button
        v-if="message.verificationCode"
        type="button"
        class="code-card"
        :aria-label="t('home.copyCodeLabel', { code: message.verificationCode })"
        @click="copyCode(message.verificationCode)"
      >
        <span class="code-label">{{ t('inbox.code') }}</span>
        <span class="code-digits">{{ message.verificationCode }}</span>
        <span class="code-action"><NIcon><CopyOutline /></NIcon>{{ t('inbox.clickToCopy') }}</span>
      </button>

      <NAlert v-if="bodyIncomplete && !originalLoading" type="warning" :show-icon="false" class="notice">
        <div class="notice-row">
          <span>{{ message.hasRaw ? t('inbox.truncatedWithOriginal', { size: formatSize(message.size) }) : t('inbox.truncated') }}</span>
          <NButton v-if="message.hasRaw" size="small" secondary @click="ensureOriginal">{{ t('inbox.loadFullMessage') }}</NButton>
        </div>
      </NAlert>
      <NAlert v-if="imagesBlocked" type="info" :show-icon="false" class="notice">
        <div class="notice-row">
          <span>{{ t(prepared?.hasRemoteImages && !allowRemoteImages ? 'inbox.remoteBlocked' : 'inbox.inlineNotLoaded') }}</span>
          <NButton size="small" secondary :loading="originalLoading" @click="loadImages">{{ t('inbox.loadImages') }}</NButton>
        </div>
      </NAlert>

      <div class="body">
        <MailFrame v-if="prepared" :html="prepared.html" :allow-remote-images="allowRemoteImages" :title="message.subject || t('inbox.noSubject')" />
        <TextBody v-else :text="textBody ?? message.snippet" />
      </div>

      <section v-if="files.length" class="attachments" :aria-label="t('inbox.attachments')">
        <ul>
          <li v-for="(file, i) in files" :key="i" class="file-card">
            <img v-if="previews[i]" :src="previews[i]!" alt="" class="thumb" />
            <span v-else class="file-icon" aria-hidden="true"><NIcon><DocumentOutline /></NIcon></span>
            <span class="file-meta">
              <span class="file-name">{{ file.filename || file.contentType }}</span>
              <span class="file-size">{{ formatSize(file.size) }}</span>
            </span>
            <NButton v-if="message.hasRaw" size="small" secondary :loading="originalLoading" @click="download(i)">
              {{ t('inbox.downloadAttachment') }}
            </NButton>
          </li>
        </ul>
        <p v-if="!message.hasRaw" class="note">{{ t('inbox.attachmentNotStored') }}</p>
      </section>
    </article>
    <p v-else-if="failed" class="failed">{{ t('inbox.loadFailed') }}</p>
  </NSpin>
</template>

<style scoped>
.spin,
.spin :deep(.n-spin-content) {
  height: 100%;
}
.detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 100%;
  min-width: 0;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 36px;
}
.spacer {
  flex: 1;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border: 0;
  border-radius: 9px;
  background: none;
  color: var(--pl-muted);
  font-size: 1.125rem;
  cursor: pointer;
}
.icon-btn:hover {
  background: var(--pl-sunken);
  color: var(--pl-ink);
}
.icon-btn.danger:hover {
  color: var(--pl-danger);
}
.icon-btn:focus-visible {
  outline: 2px solid var(--pl-blue);
  outline-offset: -2px;
}
.subject {
  margin: 0;
  font-size: 1.375rem;
  font-weight: 750;
  line-height: 1.3;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}
.sender {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.avatar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--pl-ink);
  color: var(--pl-surface);
  font-weight: 700;
}
.who {
  flex: 1;
  min-width: 0;
  font-size: 0.8125rem;
}
.who p {
  margin: 0;
  overflow-wrap: anywhere;
}
.from {
  font-size: 0.875rem;
}
.name {
  margin-right: 8px;
  font-weight: 700;
}
.addr {
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.to,
.via {
  color: var(--pl-muted);
}
.to .addr {
  color: var(--pl-ink);
}
.tag-part {
  padding: 0 2px;
  border-radius: 4px;
  background: var(--pl-blue-soft);
  color: var(--pl-blue);
}
.note-tag {
  margin-left: 8px;
  padding: 0 6px;
  border-radius: 4px;
  background: var(--pl-sunken);
  color: var(--pl-ink);
  font-size: 0.75rem;
}
.tag {
  margin-left: 8px;
  padding: 0 6px;
  border-radius: 4px;
  background: var(--pl-sunken);
  color: var(--pl-muted);
  font-size: 0.75rem;
}
.hint {
  margin-left: 2px;
  vertical-align: -2px;
  cursor: help;
}
.when {
  flex: none;
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.code-card {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 18px;
  width: 100%;
  padding: 14px 18px;
  border: 1px solid var(--pl-code-line);
  border-radius: 14px;
  background: var(--pl-code-bg);
  color: var(--pl-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: box-shadow 0.15s;
}
.code-card:hover {
  box-shadow: 0 0 0 1px var(--pl-code-line);
}
.code-card:focus-visible {
  outline: 2px solid var(--pl-blue);
  outline-offset: 2px;
}
.code-label {
  color: var(--pl-muted);
  font-size: 0.8125rem;
  font-weight: 600;
}
.code-digits {
  font-family: var(--pl-mono);
  font-size: 2.125rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  line-height: 1.1;
  overflow-wrap: anywhere;
}
:root[data-theme='dark'] .code-digits {
  color: var(--pl-signal);
}
.code-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.notice-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
}
.body {
  flex: 1;
  min-height: 360px;
  display: flex;
  flex-direction: column;
}
.body > * {
  flex: 1;
}
.attachments ul {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr));
  gap: 10px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.file-card {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--pl-line);
  border-radius: 12px;
}
.thumb,
.file-icon {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 8px;
}
.thumb {
  object-fit: cover;
  background: var(--pl-sunken);
}
.file-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--pl-sunken);
  color: var(--pl-muted);
  font-size: 1.25rem;
}
.file-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.875rem;
}
.file-size,
.note {
  color: var(--pl-muted);
  font-size: 0.75rem;
}
.note {
  margin: 6px 0 0;
}
.failed {
  color: var(--pl-muted);
  text-align: center;
  padding: 48px 0;
}
@media (max-width: 600px) {
  .sender {
    flex-wrap: wrap;
  }
  .when {
    width: 100%;
    padding-left: 52px;
  }
  .code-digits {
    font-size: 1.75rem;
  }
}
</style>
