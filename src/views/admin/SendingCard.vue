<script setup lang="ts">
import { NButton, NCard, NInput, NSelect, NSwitch, NTag, useMessage } from 'naive-ui'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { RECIPIENT_PATTERN, type AdminDomain } from '../../../shared/api'
import { adminApi } from '@/api/admin'
import { errorCodeOf } from '@/api/client'
import { adminDomainApi } from '@/api/mailboxes'
import { useAdminSending } from '@/composables/useAdminSending'

/**
 * The service-wide sending switch (off by default), the provider's state and a test send. Users
 * still need their own permission and a domain allowed to send (the other admin tabs).
 */
const { t } = useI18n()
const toast = useMessage()
const { status, load, set } = useAdminSending()
const saving = ref(false)
const domains = ref<AdminDomain[]>([])
const testDomain = ref<string | null>(null)
const testTo = ref('')
const testing = ref(false)

const sendingDomains = computed(() => domains.value.filter((d) => d.canSend).map((d) => ({ value: d.id, label: d.domain })))
const testValid = computed(() => RECIPIENT_PATTERN.test(testTo.value.trim().toLowerCase()) && !!testDomain.value)

onMounted(async () => {
  await load(true)
  try {
    domains.value = (await adminDomainApi.list()).items
    testDomain.value = sendingDomains.value[0]?.value ?? null
  } catch {
    // The test form just stays empty.
  }
})

async function setEnabled(enabled: boolean | null): Promise<void> {
  saving.value = true
  try {
    set(await adminApi.setSending(enabled))
    toast.success(t('admin.settings.saved'))
  } catch (err) {
    toast.error(t(`errors.${errorCodeOf(err)}`))
  } finally {
    saving.value = false
  }
}

async function sendTest(): Promise<void> {
  if (!testValid.value || !testDomain.value) return
  testing.value = true
  try {
    const res = await adminApi.sendTest(testDomain.value, testTo.value.trim())
    if (res.ok) toast.success(t('admin.sending.testSent', { to: testTo.value.trim() }))
    else toast.error(t(`sendErrors.${res.error}`))
  } catch (err) {
    toast.error(t(`errors.${errorCodeOf(err)}`))
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <NCard v-if="status" :title="t('admin.sending.title')">
    <div class="rows">
      <div class="switch-row">
        <NSwitch :value="status.enabled" :loading="saving" @update:value="setEnabled" />
        <span>{{ t('admin.sending.enabled') }}</span>
      </div>
      <p class="hint">{{ t('admin.sending.enabledHint') }}</p>
      <p class="default">
        {{ t('admin.settings.deployDefault', { value: status.defaultEnabled ? t('admin.settings.on') : t('admin.settings.off') }) }}
        <NButton v-if="status.overridden" text type="primary" size="tiny" @click="setEnabled(null)">{{ t('admin.settings.reset') }}</NButton>
      </p>

      <div class="facts">
        <span>{{ t('admin.sending.provider') }}: <b>{{ status.provider }}</b></span>
        <NTag size="small" :bordered="false" :type="status.configured ? 'success' : 'error'">
          {{ status.configured ? t('admin.sending.configured') : t('admin.sending.notConfigured') }}
        </NTag>
        <span>{{ t('admin.sending.usage', { used: status.usedToday, max: status.perDay }) }}</span>
        <span>{{ t('admin.sending.limits', { perUser: status.perUserPerDay, recipients: status.maxRecipients }) }}</span>
      </div>
      <p v-if="!status.configured" class="hint warn">{{ t('admin.sending.notConfiguredHint') }}</p>

      <template v-if="status.enabled">
        <p class="label">{{ t('admin.sending.test') }}</p>
        <p v-if="!sendingDomains.length" class="hint">{{ t('admin.sending.testNoDomain') }}</p>
        <form v-else class="test" @submit.prevent="sendTest">
          <NSelect v-model:value="testDomain" :options="sendingDomains" class="test-domain" />
          <NInput v-model:value="testTo" :placeholder="t('admin.sending.testTo')" :input-props="{ type: 'email', autocapitalize: 'off', spellcheck: false }" />
          <NButton attr-type="submit" :disabled="!testValid" :loading="testing">{{ t('admin.sending.testSend') }}</NButton>
        </form>
      </template>
    </div>
  </NCard>
</template>

<style scoped>
.rows {
  display: grid;
  gap: 8px;
}
.switch-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
}
.hint,
.default {
  margin: 0;
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
.hint.warn {
  color: #b4243f;
}
.default {
  display: flex;
  align-items: center;
  gap: 8px;
}
.facts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 16px;
  margin-top: 8px;
  font-size: 0.875rem;
}
.label {
  margin: 12px 0 0;
  font-weight: 600;
}
.test {
  display: grid;
  grid-template-columns: minmax(0, 200px) minmax(0, 1fr) auto;
  gap: 8px;
}
@media (max-width: 600px) {
  .test {
    grid-template-columns: 1fr;
  }
}
</style>
