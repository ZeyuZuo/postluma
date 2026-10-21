<script setup lang="ts">
import { NInputNumber, NModal, NSwitch, useMessage } from 'naive-ui'
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import type { AdminUser } from '../../../shared/api'
import { adminApi } from '@/api/admin'
import { errorCodeOf } from '@/api/client'

/** One user's sending permission and daily quota override (null = the deploy default). */
const props = defineProps<{ user: AdminUser | null; defaultQuota: number }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const toast = useMessage()
const canSend = ref(false)
const quota = ref<number | null>(null)

watch(
  () => props.user,
  (user) => {
    canSend.value = user?.canSend ?? false
    quota.value = user?.sendQuota ?? null
  },
  { immediate: true },
)

async function save(): Promise<boolean> {
  const user = props.user
  if (!user) return true
  try {
    await adminApi.setUserSending(user.id, canSend.value, quota.value)
    user.canSend = canSend.value
    user.sendQuota = quota.value
    toast.success(t('admin.users.sendingSaved'))
    emit('close')
    return true
  } catch (err) {
    toast.error(t(`errors.${errorCodeOf(err)}`))
    return false
  }
}
</script>

<template>
  <NModal
    :show="!!user"
    preset="dialog"
    :title="user ? t('admin.users.sendingTitle', { name: user.username }) : ''"
    :positive-text="t('admin.settings.save')"
    :negative-text="t('common.cancel')"
    @positive-click="save"
    @update:show="(v: boolean) => !v && emit('close')"
  >
    <div class="form">
      <label class="row"><NSwitch v-model:value="canSend" />{{ t('admin.users.sendingAllow') }}</label>
      <label class="field">
        <span>{{ t('admin.users.sendingQuota') }}</span>
        <NInputNumber v-model:value="quota" clearable :min="0" :max="10000" :placeholder="String(defaultQuota)" :disabled="!canSend" />
      </label>
      <p class="hint">{{ t('admin.users.sendingQuotaHint', { n: defaultQuota }) }}</p>
    </div>
  </NModal>
</template>

<style scoped>
.form {
  display: grid;
  gap: 10px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.field {
  display: grid;
  gap: 6px;
}
.hint {
  margin: 0;
  color: var(--pl-muted);
  font-size: 0.8125rem;
}
</style>
