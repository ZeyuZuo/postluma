<script setup lang="ts">
import { NAlert, NButton, NForm, NFormItem, NInput, NResult, type FormInst, type FormRules } from 'naive-ui'
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import { PASSWORD_MIN, USERNAME_MAX, USERNAME_MIN, USERNAME_PATTERN } from '../../../shared/api'
import { authApi } from '@/api/auth'
import { errorCodeOf } from '@/api/client'
import TurnstileWidget from '@/components/TurnstileWidget.vue'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { turnstileEnabled } from '@/lib/turnstile'

const { t } = useI18n()

const formRef = ref<FormInst | null>(null)
const turnstile = ref<InstanceType<typeof TurnstileWidget> | null>(null)
const form = reactive({ username: '', password: '', confirm: '', turnstileToken: '' })
const submitting = ref(false)
const done = ref(false)
const registrationOpen = ref(true)
const errorCode = ref<string | null>(null)

onMounted(async () => {
  try {
    registrationOpen.value = (await authApi.publicSettings()).registrationOpen
  } catch {
    // Assume open; the server enforces the switch anyway.
  }
})

const rules = computed<FormRules>(() => ({
  username: {
    required: true,
    trigger: 'blur',
    validator: (_rule, value: string) => {
      const v = value.trim()
      return v.length >= USERNAME_MIN && v.length <= USERNAME_MAX && USERNAME_PATTERN.test(v)
        ? true
        : new Error(t('auth.usernameRule'))
    },
  },
  password: { required: true, min: PASSWORD_MIN, message: t('auth.passwordRule'), trigger: 'blur' },
  confirm: {
    required: true,
    trigger: ['blur', 'input'],
    validator: (_rule, value: string) => (value === form.password ? true : new Error(t('auth.passwordMismatch'))),
  },
}))
const canSubmit = computed(() => registrationOpen.value && (!turnstileEnabled || form.turnstileToken !== ''))

async function submit(): Promise<void> {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  submitting.value = true
  errorCode.value = null
  try {
    await authApi.register({
      username: form.username.trim(),
      password: form.password,
      turnstileToken: form.turnstileToken,
    })
    done.value = true
  } catch (err) {
    errorCode.value = errorCodeOf(err)
    turnstile.value?.reset()
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <AuthLayout>
    <div class="panel">
      <NResult v-if="done" status="success" :title="t('auth.registerTitle')" :description="t('auth.registerDone')">
        <template #footer>
          <RouterLink class="switch" :to="{ name: 'login' }">{{ t('auth.toLogin') }}</RouterLink>
        </template>
      </NResult>
      <template v-else>
        <h1>{{ t('auth.registerTitle') }}</h1>
        <NAlert v-if="!registrationOpen" type="info" :show-icon="false" class="alert">
          {{ t('auth.registrationClosed') }}
        </NAlert>
        <NAlert v-else-if="errorCode" type="error" :show-icon="false" class="alert">
          {{ t(`errors.${errorCode}`) }}
        </NAlert>
        <NForm
          ref="formRef"
          :model="form"
          :rules="rules"
          :disabled="!registrationOpen"
          size="large"
          @submit.prevent="submit"
        >
          <NFormItem path="username" :label="t('auth.username')">
            <NInput
              v-model:value="form.username"
              :placeholder="t('auth.usernameRule')"
              :input-props="{ autocomplete: 'username', autocapitalize: 'off' }"
            />
          </NFormItem>
          <NFormItem path="password" :label="t('auth.password')">
            <NInput
              v-model:value="form.password"
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
          <TurnstileWidget v-if="registrationOpen" ref="turnstile" v-model="form.turnstileToken" action="register" />
          <NButton type="primary" attr-type="submit" block :loading="submitting" :disabled="!canSubmit">
            {{ t('auth.register') }}
          </NButton>
        </NForm>
        <RouterLink class="switch" :to="{ name: 'login' }">{{ t('auth.toLogin') }}</RouterLink>
      </template>
    </div>
  </AuthLayout>
</template>

<style scoped>
.panel {
  width: min(360px, 100%);
}
h1 {
  margin: 0 0 24px;
  font-size: 1.625rem;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.alert {
  margin-bottom: 20px;
}
.switch {
  display: inline-block;
  margin-top: 20px;
  color: var(--pl-blue);
  font-size: 0.875rem;
  text-decoration: none;
}
.switch:hover,
.switch:focus-visible {
  text-decoration: underline;
}
</style>
