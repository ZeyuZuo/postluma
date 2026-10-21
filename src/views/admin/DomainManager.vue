<script setup lang="ts">
import { NButton, NCollapse, NCollapseItem, NInput, NSpin, useDialog, useMessage } from 'naive-ui'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { DOMAIN_PATTERN, type AdminDomain, type DomainHealth } from '../../../shared/api'
import { errorCodeOf } from '@/api/client'
import { adminDomainApi } from '@/api/mailboxes'
import { useAdminSending } from '@/composables/useAdminSending'
import DomainRow from './DomainRow.vue'

const { t } = useI18n()
const message = useMessage()
const dialog = useDialog()

const { status: sending, load: loadSending } = useAdminSending()
const domains = ref<AdminDomain[]>([])
const loading = ref(true)
const draft = ref('')
const adding = ref(false)
const normalized = computed(() => draft.value.trim().toLowerCase())
const invalid = computed(() => draft.value.trim() !== '' && !DOMAIN_PATTERN.test(normalized.value))
// Disabled domains live in their own collapsed section so the main list stays short.
const enabledDomains = computed(() => domains.value.filter((d) => d.enabled))
const disabledDomains = computed(() => domains.value.filter((d) => !d.enabled))

/** MX check per domain id; 'checking' while a lookup runs. */
const health = ref<Record<string, DomainHealth | 'checking'>>({})

async function check(domain: AdminDomain): Promise<void> {
  if (health.value[domain.id] === 'checking') return
  health.value[domain.id] = 'checking'
  try {
    health.value[domain.id] = (await adminDomainApi.health(domain.id)).health
  } catch {
    health.value[domain.id] = { status: 'error', mx: [], checkedAt: Date.now() }
  }
}

async function reload(): Promise<void> {
  loading.value = true
  try {
    domains.value = (await adminDomainApi.list()).items
    for (const d of domains.value) if (!health.value[d.id]) void check(d)
  } catch (err) {
    message.error(t(`errors.${errorCodeOf(err)}`))
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void reload()
  void loadSending(true)
})

/** Switching on is checked against the provider (the domain must be verified there). */
async function setCanSend(domain: AdminDomain, canSend: boolean): Promise<void> {
  try {
    await adminDomainApi.setCanSend(domain.id, canSend)
    domain.canSend = canSend
    message.success(t(canSend ? 'admin.domains.canSendOn' : 'admin.domains.canSendOff', { domain: domain.domain }))
  } catch (err) {
    message.error(t(`errors.${errorCodeOf(err)}`))
  }
}

async function add(): Promise<void> {
  if (!normalized.value || invalid.value) return
  adding.value = true
  try {
    await adminDomainApi.create(normalized.value)
    message.success(t('admin.domains.added', { domain: normalized.value }))
    draft.value = ''
    await reload()
  } catch (err) {
    message.error(t(`errors.${errorCodeOf(err)}`))
  } finally {
    adding.value = false
  }
}

async function toggle(domain: AdminDomain, enabled: boolean): Promise<void> {
  try {
    await adminDomainApi.setEnabled(domain.id, enabled)
    domain.enabled = enabled
    message.success(t(enabled ? 'admin.domains.enabledToast' : 'admin.domains.disabledToast', { domain: domain.domain }))
  } catch (err) {
    message.error(t(`errors.${errorCodeOf(err)}`))
  }
}

function confirmDelete(domain: AdminDomain): void {
  dialog.warning({
    title: t('admin.domains.deleteTitle', { domain: domain.domain }),
    content: t('admin.domains.deleteBody'),
    positiveText: t('admin.domains.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        await adminDomainApi.remove(domain.id)
        message.success(t('admin.domains.deleted', { domain: domain.domain }))
        await reload()
      } catch (err) {
        message.error(t(`errors.${errorCodeOf(err)}`))
      }
    },
  })
}
</script>

<template>
  <section class="domains">
    <p class="intro">{{ t('admin.domains.intro') }}</p>

    <form class="add" @submit.prevent="add">
      <NInput
        v-model:value="draft"
        :placeholder="t('admin.domains.placeholder')"
        :status="invalid ? 'error' : undefined"
        :input-props="{ autocapitalize: 'off', spellcheck: false, 'aria-label': t('admin.domains.add') }"
      />
      <NButton type="primary" attr-type="submit" :disabled="!draft.trim() || invalid" :loading="adding">
        {{ t('admin.domains.add') }}
      </NButton>
      <p v-if="invalid" class="error">{{ t('admin.domains.invalid') }}</p>
    </form>

    <NSpin :show="loading" :delay="150">
      <ul v-if="enabledDomains.length" class="list">
        <DomainRow v-for="domain in enabledDomains" :key="domain.id" :domain="domain" :health="health[domain.id]" :sending="sending?.enabled" @check="check(domain)" @can-send="(v) => setCanSend(domain, v)" @toggle="(v) => toggle(domain, v)" @remove="confirmDelete(domain)" />
      </ul>
      <p v-else-if="!loading" class="empty">{{ t('admin.domains.empty') }}</p>
      <p class="note">{{ t('admin.domains.routingNote') }}</p>

      <NCollapse v-if="disabledDomains.length" class="disabled-section">
        <NCollapseItem :title="t('admin.domains.disabledSection', { n: disabledDomains.length })" name="disabled">
          <p class="disabled-hint">{{ t('admin.domains.disabledHint') }}</p>
          <ul class="list">
            <DomainRow v-for="domain in disabledDomains" :key="domain.id" :domain="domain" :health="health[domain.id]" :sending="sending?.enabled" @check="check(domain)" @can-send="(v) => setCanSend(domain, v)" @toggle="(v) => toggle(domain, v)" @remove="confirmDelete(domain)" />
          </ul>
        </NCollapseItem>
      </NCollapse>
    </NSpin>
  </section>
</template>

<style scoped>
.domains {
  max-width: 720px;
  margin: 0 auto;
}
.intro {
  margin: 0 0 16px;
  color: var(--pl-muted);
  line-height: 1.7;
}
.add {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px 12px;
  margin-bottom: 20px;
}
.add :deep(input) {
  font-family: var(--pl-mono);
}
.error {
  grid-column: 1 / -1;
  margin: 0;
  color: #d03050;
  font-size: 0.8125rem;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--pl-line);
  border-radius: 10px;
  background: var(--pl-surface);
}
.note {
  margin: 10px 0 0;
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.disabled-section {
  margin-top: 24px;
}
.disabled-hint {
  margin: 0 0 12px;
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.empty {
  margin: 0;
  padding: 40px 16px;
  border: 1px dashed var(--pl-line);
  border-radius: 10px;
  color: var(--pl-muted);
  text-align: center;
}
@media (max-width: 600px) {
  .add {
    grid-template-columns: 1fr;
  }
}
</style>
