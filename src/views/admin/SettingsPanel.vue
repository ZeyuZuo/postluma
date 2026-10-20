<script setup lang="ts">
import { NButton, NCard, NForm, NFormItem, NInputNumber, NSpin, NSwitch, useDialog, useMessage } from 'naive-ui'
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { SETTING_RANGES, type AdminSettings } from '../../../shared/api'
import { adminApi } from '@/api/admin'
import { errorCodeOf } from '@/api/client'

const { t } = useI18n()
const toast = useMessage()
const dialog = useDialog()

const settings = ref<AdminSettings | null>(null)
const form = reactive<{ registrationOpen: boolean; defaultMailboxQuota: number | null; retentionDays: number | null }>({
  registrationOpen: true,
  defaultMailboxQuota: 10,
  retentionDays: 30,
})
const MAX_BATCHES_PER_CLICK = 10
const saving = ref(false)
const cleanupDays = ref(30)
const cleaning = ref(false)

function apply(s: AdminSettings): void {
  settings.value = s
  Object.assign(form, { registrationOpen: s.registrationOpen, defaultMailboxQuota: s.defaultMailboxQuota, retentionDays: s.retentionDays })
}

onMounted(async () => {
  try {
    apply(await adminApi.settings())
  } catch (err) {
    toast.error(t(`errors.${errorCodeOf(err)}`))
  }
})

/** Only fields the admin actually changed become overrides; a cleared number means "unchanged". */
function changes(): Partial<Record<'registrationOpen' | 'defaultMailboxQuota' | 'retentionDays', boolean | number>> {
  const s = settings.value
  if (!s) return {}
  const out: Partial<Record<'registrationOpen' | 'defaultMailboxQuota' | 'retentionDays', boolean | number>> = {}
  if (form.registrationOpen !== s.registrationOpen) out.registrationOpen = form.registrationOpen
  if (form.defaultMailboxQuota !== null && form.defaultMailboxQuota !== s.defaultMailboxQuota) out.defaultMailboxQuota = form.defaultMailboxQuota
  if (form.retentionDays !== null && form.retentionDays !== s.retentionDays) out.retentionDays = form.retentionDays
  return out
}

async function save(): Promise<void> {
  const patch = changes()
  if (Object.keys(patch).length === 0) {
    toast.success(t('admin.settings.saved'))
    return
  }
  saving.value = true
  try {
    apply(await adminApi.updateSettings(patch))
    toast.success(t('admin.settings.saved'))
  } catch (err) {
    toast.error(t(`errors.${errorCodeOf(err)}`))
  } finally {
    saving.value = false
  }
}

async function reset(key: 'registrationOpen' | 'defaultMailboxQuota' | 'retentionDays'): Promise<void> {
  try {
    apply(await adminApi.updateSettings({ [key]: null }))
    toast.success(t('admin.settings.saved'))
  } catch (err) {
    toast.error(t(`errors.${errorCodeOf(err)}`))
  }
}

const show = (v: boolean | number, key: string) =>
  typeof v === 'boolean' ? t(v ? 'admin.settings.on' : 'admin.settings.off') : key === 'retentionDays' && v === 0 ? t('admin.settings.forever') : String(v)

function confirmCleanup(): void {
  const days = cleanupDays.value
  dialog.error({
    title: t('admin.settings.cleanupTitle', { days }),
    content: t('admin.settings.cleanupBody'),
    positiveText: t('admin.settings.cleanupRun'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => {
      void runCleanup(days)
    },
  })
}

async function runCleanup(days: number): Promise<void> {
  cleaning.value = true
  const progress = toast.loading(t('admin.settings.cleanupProgress', { n: 0 }), { duration: 0 })
  let total = 0
  try {
    let done = false
    for (let i = 0; i < MAX_BATCHES_PER_CLICK && !done; i++) {
      const batch = await adminApi.cleanup(days)
      total += batch.deleted
      progress.content = t('admin.settings.cleanupProgress', { n: total })
      if (batch.budgetExhausted) {
        toast.warning(t('admin.settings.budgetExhausted', { n: total }), { duration: 8000 })
        return
      }
      done = batch.done
    }
    if (done) toast.success(t('admin.settings.cleanupDone', { n: total }))
    else toast.info(t('admin.settings.cleanupContinue', { n: total }), { duration: 8000 })
  } catch (err) {
    toast.error(t(`errors.${errorCodeOf(err)}`))
  } finally {
    progress.destroy()
    cleaning.value = false
  }
}
</script>

<template>
  <NSpin :show="!settings" :delay="150">
    <div class="settings">
      <p class="intro">{{ t('admin.settings.intro') }}</p>
      <NCard v-if="settings">
        <NForm label-placement="top" class="form" @submit.prevent="save">
          <NFormItem :label="t('admin.settings.registration')">
            <div class="field">
              <NSwitch v-model:value="form.registrationOpen" />
              <p class="hint">{{ t('admin.settings.registrationHint') }}</p>
              <p class="default">
                {{ t('admin.settings.deployDefault', { value: show(settings.defaults.registrationOpen, 'registrationOpen') }) }}
                <NButton v-if="settings.overridden.registrationOpen" text type="primary" size="tiny" @click="reset('registrationOpen')">{{ t('admin.settings.reset') }}</NButton>
              </p>
            </div>
          </NFormItem>
          <NFormItem :label="t('admin.settings.defaultQuota')">
            <div class="field">
              <NInputNumber v-model:value="form.defaultMailboxQuota" class="number" :min="SETTING_RANGES.defaultMailboxQuota.min" :max="SETTING_RANGES.defaultMailboxQuota.max" />
              <p class="hint">{{ t('admin.settings.defaultQuotaHint') }}</p>
              <p class="default">
                {{ t('admin.settings.deployDefault', { value: show(settings.defaults.defaultMailboxQuota, 'defaultMailboxQuota') }) }}
                <NButton v-if="settings.overridden.defaultMailboxQuota" text type="primary" size="tiny" @click="reset('defaultMailboxQuota')">{{ t('admin.settings.reset') }}</NButton>
              </p>
            </div>
          </NFormItem>
          <NFormItem :label="t('admin.settings.retention')">
            <div class="field">
              <NInputNumber v-model:value="form.retentionDays" class="number" :min="SETTING_RANGES.retentionDays.min" :max="settings.maxRetentionDays">
                <template #suffix>{{ t('admin.settings.days') }}</template>
              </NInputNumber>
              <p class="hint">{{ t('admin.settings.retentionHint') }} {{ t('admin.settings.retentionMax', { n: settings.maxRetentionDays }) }}</p>
              <p class="default">
                {{ t('admin.settings.deployDefault', { value: show(settings.defaults.retentionDays, 'retentionDays') }) }}
                <NButton v-if="settings.overridden.retentionDays" text type="primary" size="tiny" @click="reset('retentionDays')">{{ t('admin.settings.reset') }}</NButton>
              </p>
            </div>
          </NFormItem>
          <NButton type="primary" attr-type="submit" :loading="saving">{{ t('admin.settings.save') }}</NButton>
        </NForm>
      </NCard>

      <NCard :title="t('admin.settings.maintenance')" class="danger">
        <p class="hint">{{ t('admin.settings.maintenanceHint') }}</p>
        <div class="cleanup">
          <span>{{ t('admin.settings.cleanupDays') }}</span>
          <NInputNumber v-model:value="cleanupDays" class="number" :min="1" :max="3650">
            <template #suffix>{{ t('admin.settings.days') }}</template>
          </NInputNumber>
          <NButton type="error" secondary :loading="cleaning" :disabled="!cleanupDays" @click="confirmCleanup">{{ t('admin.settings.cleanupRun') }}</NButton>
        </div>
      </NCard>
    </div>
  </NSpin>
</template>

<style scoped>
.settings {
  display: grid;
  gap: 20px;
  max-width: 720px;
  margin: 0 auto;
}
.intro {
  margin: 0;
  color: var(--pl-muted);
  line-height: 1.7;
}
.form {
  display: grid;
  gap: 4px;
}
.field {
  display: grid;
  gap: 6px;
  justify-items: start;
}
.number {
  width: 180px;
}
.hint,
.default {
  margin: 0;
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.default {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cleanup {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
</style>
