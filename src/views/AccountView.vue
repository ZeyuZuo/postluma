<script setup lang="ts">
import { NButton, NCard, NForm, NFormItem, NInput, NSelect, useMessage, type FormInst, type FormRules } from 'naive-ui'
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { PASSWORD_MIN, type Locale } from '../../shared/api'
import { authApi } from '@/api/auth'
import { errorCodeOf } from '@/api/client'
import { LOCALES, applyLocale } from '@/i18n'
import { session, setUser } from '@/stores/session'

const { t } = useI18n()
const message = useMessage()

const formRef = ref<FormInst | null>(null)
const form = reactive({ currentPassword: '', newPassword: '', confirm: '' })
const saving = ref(false)

const rules = computed<FormRules>(() => ({
  currentPassword: { required: true, message: t('auth.required'), trigger: 'blur' },
  newPassword: { required: true, min: PASSWORD_MIN, message: t('auth.passwordRule'), trigger: 'blur' },
  confirm: {
    required: true,
    trigger: ['blur', 'input'],
    validator: (_rule, value: string) => (value === form.newPassword ? true : new Error(t('auth.passwordMismatch'))),
  },
}))

async function changePassword(): Promise<void> {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  saving.value = true
  try {
    await authApi.changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword })
    Object.assign(form, { currentPassword: '', newPassword: '', confirm: '' })
    message.success(t('account.passwordChanged'))
  } catch (err) {
    message.error(t(`errors.${errorCodeOf(err)}`))
  } finally {
    saving.value = false
  }
}

const localeValue = computed(() => session.user?.locale ?? 'auto')
const localeOptions = computed(() => [
  { value: 'auto', label: t('language.auto') },
  ...Object.entries(LOCALES).map(([value, l]) => ({ value, label: l.label })),
])

async function changeLocale(value: string): Promise<void> {
  const locale = value === 'auto' ? null : (value as Locale)
  applyLocale(locale)
  try {
    setUser((await authApi.updateProfile({ locale })).user)
    message.success(t('account.languageSaved'))
  } catch (err) {
    message.error(t(`errors.${errorCodeOf(err)}`))
  }
}
</script>

<template>
  <div class="account">
    <NCard :title="t('account.passwordSection')">
      <NForm ref="formRef" :model="form" :rules="rules" class="narrow" @submit.prevent="changePassword">
        <NFormItem path="currentPassword" :label="t('account.currentPassword')">
          <NInput
            v-model:value="form.currentPassword"
            type="password"
            show-password-on="click"
            :input-props="{ autocomplete: 'current-password' }"
          />
        </NFormItem>
        <NFormItem path="newPassword" :label="t('account.newPassword')">
          <NInput
            v-model:value="form.newPassword"
            type="password"
            show-password-on="click"
            :placeholder="t('auth.passwordRule')"
            :input-props="{ autocomplete: 'new-password' }"
          />
        </NFormItem>
        <NFormItem path="confirm" :label="t('auth.confirmPassword')">
          <NInput
            v-model:value="form.confirm"
            type="password"
            show-password-on="click"
            :input-props="{ autocomplete: 'new-password' }"
          />
        </NFormItem>
        <NButton type="primary" attr-type="submit" :loading="saving">{{ t('account.savePassword') }}</NButton>
      </NForm>
    </NCard>
    <NCard :title="t('account.languageSection')">
      <NSelect class="narrow" :value="localeValue" :options="localeOptions" @update:value="changeLocale" />
    </NCard>
  </div>
</template>

<style scoped>
.account {
  display: grid;
  gap: 20px;
}
.narrow {
  max-width: 400px;
}
</style>
