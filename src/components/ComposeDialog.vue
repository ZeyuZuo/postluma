<script setup lang="ts">
import { CloseOutline } from '@vicons/ionicons5'
import { NIcon, NModal } from 'naive-ui'
import { useI18n } from 'vue-i18n'

import ComposePanel from '@/components/ComposePanel.vue'

/** New mail in a centered dialog (home page, address rows); `fromId` presets the sender. */
defineProps<{ show: boolean; fromId?: string }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
</script>

<template>
  <NModal :show="show" :auto-focus="false" transform-origin="center" @update:show="(v: boolean) => { if (!v) emit('close') }">
    <div class="compose-dialog" role="dialog" :aria-label="t('compose.newTitle')">
      <button type="button" class="dialog-close" :aria-label="t('inbox.close')" @click="emit('close')">
        <NIcon><CloseOutline /></NIcon>
      </button>
      <ComposePanel v-if="show" :from-id="fromId" @sent="emit('close')" @cancel="emit('close')" />
    </div>
  </NModal>
</template>

<style scoped>
.compose-dialog {
  position: relative;
  width: min(680px, calc(100vw - 32px));
  max-height: calc(100dvh - 64px);
  padding: 20px 28px 24px;
  box-sizing: border-box;
  overflow: auto;
  border-radius: 16px;
  background: var(--pl-surface);
  box-shadow: 0 24px 60px rgb(0 0 0 / 0.22);
}
.compose-dialog :deep(.compose > .title) {
  padding-left: 32px;
  line-height: 34px;
}
.dialog-close {
  position: absolute;
  top: 21px;
  left: 18px;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  background: var(--pl-surface);
  color: var(--pl-muted);
  font-size: 20px;
  cursor: pointer;
}
.dialog-close:hover {
  background: var(--pl-sunken);
  color: var(--pl-ink);
}
@media (max-width: 600px) {
  .compose-dialog {
    width: 100vw;
    max-height: 100dvh;
    height: 100dvh;
    padding: 16px;
    border-radius: 0;
  }
}
</style>
