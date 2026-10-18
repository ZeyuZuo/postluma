<script setup lang="ts">
import { AddOutline } from '@vicons/ionicons5'
import { NButton, NCheckbox, NIcon, NInput, NSelect, useMessage } from 'naive-ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import {
  isValidLocalPart,
  normalizeLocalPart,
  type MailboxQuota,
  type PublicDomain,
  type PublicMailbox,
} from '../../shared/api'
import { errorCodeOf } from '@/api/client'
import { mailboxApi } from '@/api/mailboxes'
import { copyText } from '@/composables/useClipboard'
import { session } from '@/stores/session'

const props = defineProps<{ quota: MailboxQuota | null }>()
const emit = defineEmits<{ created: [mailbox: PublicMailbox] }>()

const { t } = useI18n()
const message = useMessage()

const DOMAIN_KEY = 'postluma.domain'
const domains = ref<PublicDomain[]>([])
const domainsLoaded = ref(false)
const domainId = ref<string | null>(null)
const custom = ref(false)
const localPart = ref('')
const busy = ref(false)

onMounted(async () => {
  try {
    domains.value = (await mailboxApi.domains()).items
  } finally {
    domainsLoaded.value = true
  }
  let remembered: string | null = null
  try {
    remembered = localStorage.getItem(DOMAIN_KEY)
  } catch {
    // ignore
  }
  domainId.value = domains.value.find((d) => d.id === remembered)?.id ?? domains.value[0]?.id ?? null
})

watch(domainId, (id) => {
  try {
    if (id) localStorage.setItem(DOMAIN_KEY, id)
  } catch {
    // ignore
  }
})

const domainOptions = computed(() => domains.value.map((d) => ({ value: d.id, label: `@${d.domain}` })))
const selectedDomain = computed(() => domains.value.find((d) => d.id === domainId.value))
const quotaFull = computed(() => !!props.quota && props.quota.used >= props.quota.limit)
const normalized = computed(() => normalizeLocalPart(localPart.value))
const customInvalid = computed(() => localPart.value !== '' && !isValidLocalPart(normalized.value))
const canCreate = computed(() => !!domainId.value && !quotaFull.value && !busy.value)

async function submit(useCustom: boolean): Promise<void> {
  if (!domainId.value) return
  if (useCustom && !isValidLocalPart(normalized.value)) return
  busy.value = true
  try {
    const { mailbox } = await mailboxApi.create({
      domainId: domainId.value,
      localPart: useCustom ? normalized.value : undefined,
    })
    const copied = await copyText(mailbox.address)
    message.success(t(copied ? 'mailboxes.generated' : 'mailboxes.createdNoCopy', { address: mailbox.address }))
    localPart.value = ''
    emit('created', mailbox)
  } catch (err) {
    message.error(t(`errors.${errorCodeOf(err)}`))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="creator">
    <template v-if="domainsLoaded && domains.length === 0">
      <p class="notice">
        {{ session.user?.role === 'admin' ? t('mailboxes.noDomainsAdmin') : t('mailboxes.noDomains') }}
        <RouterLink v-if="session.user?.role === 'admin'" :to="{ name: 'admin' }">{{ t('mailboxes.addDomainLink') }}</RouterLink>
      </p>
    </template>
    <template v-else>
      <div class="row">
        <NButton type="primary" size="large" :disabled="!canCreate" :loading="busy && !custom" @click="submit(false)">
          <template #icon><NIcon><AddOutline /></NIcon></template>
          {{ t('mailboxes.generate') }}
        </NButton>
        <NSelect
          v-if="domains.length > 1"
          v-model:value="domainId"
          class="domain"
          size="large"
          :options="domainOptions"
          :aria-label="t('mailboxes.domain')"
          :consistent-menu-width="false"
        />
        <span v-else-if="selectedDomain" class="domain-single pl-mono">@{{ selectedDomain.domain }}</span>
        <span v-if="quota" class="quota" :class="{ full: quotaFull }">
          {{ t('mailboxes.quota', { used: quota.used, limit: quota.limit }) }}
        </span>
      </div>

      <NCheckbox v-model:checked="custom" class="toggle">{{ t('mailboxes.customToggle') }}</NCheckbox>

      <form v-if="custom" class="custom" @submit.prevent="submit(true)">
        <NInput
          v-model:value="localPart"
          class="local"
          :placeholder="t('mailboxes.customPlaceholder')"
          :status="customInvalid ? 'error' : undefined"
          :input-props="{ autocapitalize: 'off', spellcheck: false, 'aria-label': t('mailboxes.customToggle') }"
        >
          <template #suffix>
            <span class="pl-mono suffix">@{{ selectedDomain?.domain }}</span>
          </template>
        </NInput>
        <NButton attr-type="submit" :disabled="!canCreate || !localPart || customInvalid" :loading="busy && custom">
          {{ t('mailboxes.create') }}
        </NButton>
        <p class="hint" :class="{ error: customInvalid }">{{ t('mailboxes.localPartRule') }}</p>
      </form>

      <p v-if="quotaFull" class="notice">{{ t('mailboxes.quotaFull') }}</p>
    </template>
  </section>
</template>

<style scoped>
.creator {
  padding: 20px;
  border: 1px solid var(--pl-line);
  border-radius: 10px;
  background: var(--pl-surface);
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.domain {
  width: 220px;
}
.domain-single {
  color: var(--pl-muted);
}
.quota {
  margin-left: auto;
  color: var(--pl-muted);
  font-size: 0.875rem;
  font-variant-numeric: tabular-nums;
}
.quota.full {
  color: #c2410c;
}
.toggle {
  margin-top: 16px;
}
.custom {
  display: grid;
  grid-template-columns: minmax(0, 420px) auto;
  justify-content: start;
  gap: 8px 12px;
  margin-top: 12px;
}
.local :deep(input) {
  font-family: var(--pl-mono);
}
.suffix {
  color: var(--pl-muted);
  font-size: 0.875rem;
}
.hint {
  grid-column: 1 / -1;
  margin: 0;
  font-size: 0.8125rem;
  color: var(--pl-muted);
}
.hint.error {
  color: #d03050;
}
.notice {
  margin: 12px 0 0;
  color: var(--pl-muted);
  font-size: 0.875rem;
  line-height: 1.6;
}
.notice:first-child {
  margin-top: 0;
}
.notice a {
  color: var(--pl-blue);
  margin-left: 6px;
}
@media (max-width: 600px) {
  .quota {
    margin-left: 0;
    width: 100%;
  }
  .custom {
    grid-template-columns: 1fr;
  }
}
</style>
