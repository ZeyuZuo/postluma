<script setup lang="ts">
import { NSelect, useMessage } from 'naive-ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import { isValidLocalPart, normalizeLocalPart, type MailboxQuota, type PublicDomain, type PublicMailbox } from '../../shared/api'
import { errorCodeOf } from '@/api/client'
import { mailboxApi } from '@/api/mailboxes'
import { copyText } from '@/composables/useClipboard'
import { session } from '@/stores/session'

/**
 * The command bar: an empty prefix creates a random address, a typed one a custom address.
 * Either way the new address is copied, ready to paste into the sign-up form.
 */
const props = defineProps<{ quota: MailboxQuota | null }>()
const emit = defineEmits<{ created: [mailbox: PublicMailbox] }>()

const { t } = useI18n()
const message = useMessage()

const DOMAIN_KEY = 'postluma.domain'
const domains = ref<PublicDomain[]>([])
const domainsLoaded = ref(false)
const domainId = ref<string | null>(null)
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

const domainOptions = computed(() => domains.value.map((d) => ({ value: d.id, label: d.domain })))
const selectedDomain = computed(() => domains.value.find((d) => d.id === domainId.value))
const quotaFull = computed(() => !!props.quota && props.quota.used >= props.quota.limit)
const normalized = computed(() => normalizeLocalPart(localPart.value))
const custom = computed(() => normalized.value !== '')
const invalid = computed(() => custom.value && !isValidLocalPart(normalized.value))
const canCreate = computed(() => !!domainId.value && !quotaFull.value && !busy.value && !invalid.value)

async function submit(): Promise<void> {
  if (!domainId.value || !canCreate.value) return
  busy.value = true
  try {
    const { mailbox } = await mailboxApi.create({
      domainId: domainId.value,
      localPart: custom.value ? normalized.value : undefined,
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
  <div class="command">
    <p v-if="domainsLoaded && domains.length === 0" class="notice">
      {{ session.user?.role === 'admin' ? t('mailboxes.noDomainsAdmin') : t('mailboxes.noDomains') }}
      <RouterLink v-if="session.user?.role === 'admin'" :to="{ name: 'admin' }">{{ t('mailboxes.addDomainLink') }}</RouterLink>
    </p>
    <form v-else class="bar" @submit.prevent="submit">
      <div class="field" :class="{ invalid }">
        <label class="visually-hidden" for="new-local-part">{{ t('home.prefixLabel') }}</label>
        <input
          id="new-local-part"
          v-model="localPart"
          class="local"
          :placeholder="t('home.prefixPlaceholder')"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          maxlength="64"
          :aria-invalid="invalid"
          aria-describedby="new-local-part-hint"
        />
        <span class="at" aria-hidden="true">@</span>
        <NSelect
          v-if="domains.length > 1"
          v-model:value="domainId"
          class="domain"
          :bordered="false"
          :options="domainOptions"
          :aria-label="t('mailboxes.domain')"
          :consistent-menu-width="false"
        />
        <span v-else class="domain-single">{{ selectedDomain?.domain }}</span>
      </div>
      <button type="submit" class="go" :disabled="!canCreate">
        <span>{{ custom ? t('home.createCopy') : t('home.generateCopy') }}</span>
        <kbd>Enter</kbd>
      </button>
    </form>
    <p id="new-local-part-hint" class="hint" :class="{ error: invalid }">
      <template v-if="quotaFull">{{ t('mailboxes.quotaFull') }}</template>
      <template v-else-if="invalid">{{ t('mailboxes.localPartRule') }}</template>
      <template v-else>{{ t('home.prefixHint') }}</template>
      <span v-if="quota" class="quota">{{ t('mailboxes.quota', { used: quota.used, limit: quota.limit }) }}</span>
    </p>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.field {
  flex: 1 1 420px;
  min-width: 0;
  display: flex;
  align-items: center;
  height: 60px;
  padding: 0 8px 0 18px;
  border: 1px solid var(--pl-line);
  border-radius: 12px;
  background: var(--pl-sunken);
  font-family: var(--pl-mono);
  font-size: 1.5rem;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.field:focus-within {
  border-color: var(--pl-blue);
  box-shadow: 0 0 0 3px var(--pl-blue-soft);
}
.field.invalid {
  border-color: var(--pl-danger);
}
.local {
  flex: 1 1 auto;
  min-width: 4ch;
  border: 0;
  background: transparent;
  color: var(--pl-ink);
  font: inherit;
  font-weight: 700;
  outline: none;
}
.local::placeholder {
  color: var(--pl-faint);
  font-family: var(--pl-font);
  font-weight: 400;
  font-size: 1.0625rem;
}
.at {
  color: var(--pl-faint);
  padding: 0 4px;
}
.domain {
  width: auto;
  min-width: 180px;
  font-size: 1rem;
}
.domain :deep(.n-base-selection),
.domain :deep(.n-base-selection-label) {
  background: transparent;
}
.domain :deep(.n-base-selection-label) {
  font-family: var(--pl-mono);
  color: var(--pl-muted);
}
.domain-single {
  color: var(--pl-muted);
  font-size: 1rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.go {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 60px;
  padding: 0 24px;
  border: 0;
  border-radius: 12px;
  background: var(--pl-signal);
  color: #13161b;
  font: inherit;
  font-size: 1rem;
  font-weight: 700;
  cursor: pointer;
  transition: filter 0.15s, transform 0.05s;
}
.go:hover:not(:disabled) {
  filter: brightness(1.04);
}
.go:active:not(:disabled) {
  transform: translateY(1px);
}
.go:focus-visible {
  outline: 2px solid var(--pl-ink);
  outline-offset: 2px;
}
.go:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
kbd {
  padding: 2px 6px;
  border-radius: 5px;
  background: rgb(0 0 0 / 0.12);
  font-family: var(--pl-mono);
  font-size: 0.75rem;
  font-weight: 500;
}
.hint {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 10px 2px 0;
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.hint.error {
  color: var(--pl-danger);
}
.quota {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
.notice {
  margin: 0;
  color: var(--pl-muted);
  line-height: 1.6;
}
.notice a {
  margin-left: 6px;
  color: var(--pl-blue);
}
@media (max-width: 600px) {
  .field {
    flex-basis: 100%;
    height: 52px;
    padding-left: 14px;
    font-size: 1.125rem;
  }
  .domain {
    min-width: 0;
    max-width: 52%;
  }
  .go {
    flex: 1;
    height: 50px;
  }
  kbd {
    display: none;
  }
}
</style>
