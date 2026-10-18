<script setup lang="ts">
import { NAlert, NButton, NForm, NFormItem, NInput, type FormInst, type FormRules } from 'naive-ui'
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { authApi } from '@/api/auth'
import { errorCodeOf } from '@/api/client'
import TurnstileWidget from '@/components/TurnstileWidget.vue'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { safeRedirect } from '@/lib/redirect'
import { turnstileEnabled } from '@/lib/turnstile'
import { setUser } from '@/stores/session'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const formRef = ref<FormInst | null>(null)
const turnstile = ref<InstanceType<typeof TurnstileWidget> | null>(null)
const form = reactive({ username: '', password: '', turnstileToken: '' })
const submitting = ref(false)
const errorCode = ref<string | null>(null)

const rules = computed<FormRules>(() => ({
  username: { required: true, message: t('auth.required'), trigger: 'blur' },
  password: { required: true, message: t('auth.required'), trigger: 'blur' },
}))
const canSubmit = computed(() => !turnstileEnabled || form.turnstileToken !== '')

async function submit(): Promise<void> {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  submitting.value = true
  errorCode.value = null
  try {
    const { user } = await authApi.login(form)
    setUser(user)
    await router.replace(safeRedirect(route.query.redirect))
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
      <h1>{{ t('auth.loginTitle') }}</h1>
      <NAlert v-if="errorCode" type="error" :show-icon="false" class="alert">
        {{ t(`errors.${errorCode}`) }}
      </NAlert>
      <NForm ref="formRef" :model="form" :rules="rules" size="large" @submit.prevent="submit">
        <NFormItem path="username" :label="t('auth.username')">
          <NInput v-model:value="form.username" :input-props="{ autocomplete: 'username', autocapitalize: 'off' }" />
        </NFormItem>
        <NFormItem path="password" :label="t('auth.password')">
          <NInput
            v-model:value="form.password"
            type="password"
            show-password-on="click"
            :input-props="{ autocomplete: 'current-password' }"
          />
        </NFormItem>
        <TurnstileWidget ref="turnstile" v-model="form.turnstileToken" action="login" />
        <NButton type="primary" attr-type="submit" block :loading="submitting" :disabled="!canSubmit">
          {{ t('auth.login') }}
        </NButton>
      </NForm>
      <RouterLink class="switch" :to="{ name: 'register' }">{{ t('auth.toRegister') }}</RouterLink>
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
