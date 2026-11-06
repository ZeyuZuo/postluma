<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import type { SentMessageDetail } from '../../shared/api'
import { outboxApi } from '@/api/outbox'
import MailArticle from '@/components/MailArticle.vue'
import TextBody from '@/components/TextBody.vue'

/** A sent message, laid out like received mail: plain text, and the avatar is the first recipient's. */
const props = defineProps<{ id: string; showBack?: boolean }>()
defineEmits<{ back: [] }>()

const { t } = useI18n()
const message = ref<SentMessageDetail | null>(null)
const loading = ref(false)
const failed = ref(false)

const mail = computed(() =>
  message.value ? { subject: message.value.subject, who: message.value.to[0] ?? '', time: message.value.createdAt } : null,
)

async function load(id: string): Promise<void> {
  loading.value = true
  failed.value = false
  let detail: SentMessageDetail | null = null
  try {
    detail = (await outboxApi.get(id)).message
  } catch {
    failed.value = id === props.id
  }
  if (id !== props.id) return // a newer selection owns the view
  message.value = detail
  loading.value = false
}

watch(() => props.id, (id) => void load(id), { immediate: true })
</script>

<template>
  <MailArticle :mail="mail" :loading="loading" :failed="failed" :show-back="showBack" @back="$emit('back')">
    <template v-if="message" #who>
      <p>{{ t('compose.to') }} <span class="pl-mono address">{{ message.to.join(', ') }}</span></p>
      <p>{{ t('compose.from') }} <span class="pl-mono">{{ message.fromAddress }}</span></p>
      <p :class="{ failed: message.status === 'failed' }">
        {{ t(`compose.status.${message.status}`) }}<template v-if="message.error"> · {{ t(`sendErrors.${message.error}`) }}</template>
      </p>
    </template>

    <TextBody :text="message?.text ?? ''" />
  </MailArticle>
</template>

<style scoped>
p {
  color: var(--pl-muted);
}
.address {
  color: var(--pl-ink);
}
.failed {
  color: var(--pl-danger);
}
</style>
