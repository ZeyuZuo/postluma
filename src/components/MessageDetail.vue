<script setup lang="ts">
import {
  ArrowBackOutline,
  AttachOutline,
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
import CodeChip from '@/components/CodeChip.vue'
import MailFrame from '@/components/MailFrame.vue'
import TextBody from '@/components/TextBody.vue'
import { formatDateTime } from '@/lib/format'
import { prepareMailHtml } from '@/lib/mail-html'
import { forgetOriginal, loadOriginal, saveFile, type OriginalMail } from '@/lib/original-mail'
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
      <header class="head">
        <div class="toolbar">
          <NButton v-if="showBack" quaternary size="small" @click="emit('back')">
            <template #icon><NIcon><ArrowBackOutline /></NIcon></template>
            {{ t('inbox.back') }}
          </NButton>
          <span class="spacer" />
          <a v-if="message.hasRaw" class="n-button-like" :href="messageApi.rawUrl(message.id)" download="message.eml">
            <NButton quaternary size="small" tag="span">
              <template #icon><NIcon><DownloadOutline /></NIcon></template>
              {{ t('inbox.downloadOriginal') }}
            </NButton>
          </a>
          <NButton quaternary size="small" @click="markUnread">
            <template #icon><NIcon><MailUnreadOutline /></NIcon></template>
            {{ t('inbox.markUnread') }}
          </NButton>
          <NButton quaternary size="small" @click="confirmDelete">
            <template #icon><NIcon><TrashOutline /></NIcon></template>
            {{ t('inbox.delete') }}
          </NButton>
        </div>
        <h2 class="subject">{{ message.subject || t('inbox.noSubject') }}</h2>
        <dl class="meta">
          <dt>{{ t('inbox.from') }}</dt>
          <dd>
            <span v-if="message.fromName" class="name">{{ message.fromName }}</span>
            <span class="pl-mono addr">{{ message.fromAddress }}</span>
          </dd>
          <dt>{{ t('inbox.to') }}</dt>
          <dd>
            <span class="pl-mono addr">{{ message.toAddress }}</span>
            <span v-if="message.mailboxStatus === 'disabled'" class="tag">{{ t('inbox.disabledMailbox') }}</span>
          </dd>
          <dt>{{ t('inbox.received') }}</dt>
          <dd>{{ formatDateTime(message.receivedAt) }}</dd>
          <template v-if="message.envelopeFrom && message.envelopeFrom !== message.fromAddress">
            <dt>
              {{ t('inbox.deliveredBy') }}
              <NTooltip>
                <template #trigger><NIcon class="hint"><InformationCircleOutline /></NIcon></template>
                {{ t('inbox.deliveredByHint') }}
              </NTooltip>
            </dt>
            <dd><span class="pl-mono addr">{{ message.envelopeFrom }}</span></dd>
          </template>
        </dl>
      </header>

      <section v-if="message.verificationCode" class="code-card">
        <span class="code-label">{{ t('inbox.code') }}</span>
        <CodeChip :code="message.verificationCode" size="lg" />
      </section>

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

      <section v-if="files.length" class="attachments">
        <h3>{{ t('inbox.attachments') }}</h3>
        <ul>
          <li v-for="(file, i) in files" :key="i">
            <NIcon><AttachOutline /></NIcon>
            <span class="file">{{ file.filename || file.contentType }}</span>
            <span class="size">{{ formatSize(file.size) }}</span>
            <NButton v-if="message.hasRaw" text size="small" type="primary" :loading="originalLoading" @click="download(i)">
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
  height: 100%;
  min-width: 0;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
}
.spacer {
  flex: 1;
}
.subject {
  margin: 0 0 12px;
  font-size: 1.375rem;
  font-weight: 650;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.meta {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 16px;
  margin: 0;
  font-size: 0.875rem;
}
.meta dt {
  color: var(--pl-muted);
  white-space: nowrap;
}
.meta dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.name {
  margin-right: 8px;
  font-weight: 600;
}
.addr {
  font-size: 0.8125rem;
}
.hint {
  vertical-align: -2px;
  cursor: help;
}
.tag {
  margin-left: 8px;
  padding: 0 6px;
  border-radius: 4px;
  background: var(--pl-line);
  color: var(--pl-muted);
  font-size: 0.75rem;
}
.code-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 18px;
  border: 1px solid color-mix(in srgb, var(--pl-mark) 60%, var(--pl-line));
  border-radius: 10px;
  background: color-mix(in srgb, var(--pl-mark) 10%, var(--pl-surface));
}
.code-label {
  color: var(--pl-muted);
  font-size: 0.875rem;
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
  min-height: 420px;
  display: flex;
  flex-direction: column;
}
.body > * {
  flex: 1;
}
.attachments h3 {
  margin: 0 0 8px;
  font-size: 0.9375rem;
}
.attachments ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.attachments li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 0.875rem;
}
.file {
  overflow-wrap: anywhere;
}
.n-button-like {
  text-decoration: none;
}
.size,
.note {
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.note {
  margin: 4px 0 0;
}
.failed {
  color: var(--pl-muted);
  text-align: center;
  padding: 48px 0;
}
@media (max-width: 600px) {
  .meta {
    grid-template-columns: 1fr;
    gap: 0;
  }
  .meta dd {
    margin-bottom: 6px;
  }
}
</style>
