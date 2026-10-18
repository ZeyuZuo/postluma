<script setup lang="ts">
import { TrashOutline } from '@vicons/ionicons5'
import { NButton, NIcon, NInput, NSpin, NSwitch, NTooltip, useDialog, useMessage } from 'naive-ui'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { DOMAIN_PATTERN, type AdminDomain } from '../../../shared/api'
import { errorCodeOf } from '@/api/client'
import { adminDomainApi } from '@/api/mailboxes'

const { t } = useI18n()
const message = useMessage()
const dialog = useDialog()

const domains = ref<AdminDomain[]>([])
const loading = ref(true)
const draft = ref('')
const adding = ref(false)
const normalized = computed(() => draft.value.trim().toLowerCase())
const invalid = computed(() => draft.value.trim() !== '' && !DOMAIN_PATTERN.test(normalized.value))

async function reload(): Promise<void> {
  loading.value = true
  try {
    domains.value = (await adminDomainApi.list()).items
  } catch (err) {
    message.error(t(`errors.${errorCodeOf(err)}`))
  } finally {
    loading.value = false
  }
}

onMounted(reload)

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
      <ul v-if="domains.length" class="list">
        <li v-for="domain in domains" :key="domain.id" class="item">
          <div class="main">
            <span class="name pl-mono" :class="{ off: !domain.enabled }">{{ domain.domain }}</span>
            <span class="count">{{ t('admin.domains.mailboxCount', { n: domain.mailboxCount }) }}</span>
          </div>
          <label class="switch">
            <NSwitch :value="domain.enabled" size="small" @update:value="(v: boolean) => toggle(domain, v)" />
            {{ t('admin.domains.enabled') }}
          </label>
          <NTooltip :disabled="domain.mailboxCount === 0">
            <template #trigger>
              <span>
                <NButton
                  quaternary
                  circle
                  size="small"
                  :disabled="domain.mailboxCount > 0"
                  :aria-label="t('admin.domains.delete')"
                  @click="confirmDelete(domain)"
                >
                  <template #icon><NIcon><TrashOutline /></NIcon></template>
                </NButton>
              </span>
            </template>
            {{ t('admin.domains.inUse') }}
          </NTooltip>
        </li>
      </ul>
      <p v-else-if="!loading" class="empty">{{ t('admin.domains.empty') }}</p>
    </NSpin>
  </section>
</template>

<style scoped>
.intro {
  max-width: 70ch;
  margin: 0 0 20px;
  color: var(--pl-muted);
  line-height: 1.7;
}
.add {
  display: grid;
  grid-template-columns: minmax(0, 360px) auto;
  justify-content: start;
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
.item {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 12px 20px;
  border-top: 1px solid var(--pl-line);
}
.item:first-child {
  border-top: 0;
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 16px;
}
.name {
  overflow-wrap: anywhere;
}
.name.off {
  color: var(--pl-muted);
  text-decoration: line-through;
}
.count {
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--pl-muted);
  font-size: 0.875rem;
  cursor: pointer;
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
  .item {
    flex-wrap: wrap;
    gap: 8px 16px;
    padding: 12px 16px;
  }
}
</style>
