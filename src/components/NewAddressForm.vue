<script setup lang="ts">
import { NSelect } from 'naive-ui'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import { isValidLocalPart, normalizeLocalPart, type MailboxQuota, type PublicMailbox } from '../../shared/api'
import { useCreateMailbox } from '@/composables/useCreateMailbox'
import { useDomains } from '@/composables/useDomains'
import { session } from '@/stores/session'

/** One line: optional prefix @ domain, then create. An empty prefix makes a random address. */
const props = defineProps<{ quota: MailboxQuota | null; autofocus?: boolean }>()
const emit = defineEmits<{ created: [mailbox: PublicMailbox] }>()

const { t } = useI18n()
const { domains, loaded, domainId, selected } = useDomains()
const { create, busy } = useCreateMailbox()
const localPart = ref('')
const input = ref<HTMLInputElement | null>(null)

onMounted(() => {
  if (props.autofocus) input.value?.focus()
})

const domainOptions = computed(() => domains.value.map((d) => ({ value: d.id, label: d.domain })))
const quotaFull = computed(() => !!props.quota && props.quota.used >= props.quota.limit)
const normalized = computed(() => normalizeLocalPart(localPart.value))
const custom = computed(() => normalized.value !== '')
const invalid = computed(() => custom.value && !isValidLocalPart(normalized.value))

async function submit(): Promise<void> {
  if (invalid.value || quotaFull.value) return
  const mailbox = await create(custom.value ? normalized.value : undefined)
  if (!mailbox) return
  localPart.value = ''
  emit('created', mailbox)
}
</script>

<template>
  <div class="new-address">
    <p v-if="loaded && domains.length === 0" class="hint">
      {{ session.user?.role === 'admin' ? t('mailboxes.noDomainsAdmin') : t('mailboxes.noDomains') }}
      <RouterLink v-if="session.user?.role === 'admin'" :to="{ name: 'admin' }">{{ t('mailboxes.addDomainLink') }}</RouterLink>
    </p>
    <template v-else>
      <form class="row" @submit.prevent="submit">
        <div class="field" :class="{ invalid }">
          <label class="visually-hidden" for="new-local-part">{{ t('home.prefixLabel') }}</label>
          <input
            id="new-local-part"
            ref="input"
            v-model="localPart"
            :placeholder="t('home.prefixPlaceholder')"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            maxlength="64"
            :aria-invalid="invalid"
          />
          <span class="at" aria-hidden="true">@</span>
          <NSelect
            v-if="domains.length > 1"
            v-model:value="domainId"
            class="domain"
            size="small"
            :bordered="false"
            :options="domainOptions"
            :aria-label="t('mailboxes.domain')"
            :consistent-menu-width="false"
          />
          <span v-else class="domain-single">{{ selected?.domain }}</span>
        </div>
        <button type="submit" class="pl-btn primary" :disabled="busy || invalid || quotaFull || !domainId">
          {{ custom ? t('home.create') : t('home.createRandom') }}
        </button>
      </form>
      <p class="hint" :class="{ error: invalid || quotaFull }">
        <template v-if="quotaFull">{{ t('mailboxes.quotaFull') }}</template>
        <template v-else-if="invalid">{{ t('mailboxes.localPartRule') }}</template>
        <template v-else>{{ t('home.prefixHint') }}</template>
        <span v-if="quota" class="quota">{{ t('mailboxes.quota', { used: quota.used, limit: quota.limit }) }}</span>
      </p>
    </template>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.row .pl-btn {
  height: 42px;
}
.field {
  flex: 1 1 320px;
  min-width: 0;
  display: flex;
  align-items: center;
  height: 42px;
  padding: 0 4px 0 12px;
  border: 1px solid var(--pl-line);
  border-radius: 10px;
  background: var(--pl-surface);
  font-family: var(--pl-mono);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.field:focus-within {
  border-color: var(--pl-blue);
  box-shadow: 0 0 0 3px var(--pl-blue-soft);
}
.field.invalid {
  border-color: var(--pl-danger);
}
input {
  flex: 1 1 auto;
  min-width: 4ch;
  border: 0;
  background: transparent;
  color: var(--pl-ink);
  font: inherit;
  font-weight: 700;
  outline: none;
}
input::placeholder {
  color: var(--pl-faint);
  font-family: var(--pl-font);
  font-weight: 400;
}
.at {
  color: var(--pl-faint);
  padding: 0 2px;
}
.domain {
  width: auto;
  min-width: 150px;
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
  padding-right: 10px;
  color: var(--pl-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hint {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 8px 2px 0;
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.hint.error {
  color: var(--pl-danger);
}
.hint a {
  color: var(--pl-blue);
}
.quota {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 600px) {
  .field {
    flex-basis: 100%;
  }
  .domain {
    min-width: 0;
    max-width: 55%;
  }
  .row .pl-btn {
    flex: 1;
  }
}
</style>
