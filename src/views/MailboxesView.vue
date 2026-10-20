<script setup lang="ts">
import { NButton, useMessage } from 'naive-ui'
import { h, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import type { MailboxStatus, PublicMailbox } from '../../shared/api'
import { errorCodeOf } from '@/api/client'
import { mailboxApi } from '@/api/mailboxes'
import AddressCommand from '@/components/AddressCommand.vue'
import MailboxListPanel from '@/components/MailboxListPanel.vue'
import { useMailboxList } from '@/composables/useMailboxList'

/** Addresses in use (with the command bar) and disabled ones, as two tabs of one page. */
const props = defineProps<{ status: MailboxStatus }>()

const { t } = useI18n()
const list = useMailboxList(props.status)
const { items, quota, query, nextCursor, loading, loadingMore } = list
const freshId = ref<string | null>(null)
const toast = useMessage()
const UNDO_MS = 8000

onMounted(() => void list.reload())

function onCreated(mailbox: PublicMailbox): void {
  freshId.value = mailbox.id
  list.prepend(mailbox)
  if (quota.value) quota.value = { ...quota.value, used: quota.value.used + 1 }
}

function adjustQuota(delta: number): void {
  if (quota.value) quota.value = { ...quota.value, used: quota.value.used + delta }
}

function onChanged(mailbox: PublicMailbox): void {
  const leaving = mailbox.status !== props.status
  list.apply(mailbox)
  if (!leaving) return
  // Only active addresses use quota: disabling frees a slot, re-enabling takes one.
  adjustQuota(mailbox.status === 'active' ? 1 : -1)
  if (mailbox.status === 'disabled') offerUndo(mailbox)
}

/** Disabling happens at once; this toast can take it back (re-checking the quota). */
function offerUndo(mailbox: PublicMailbox): void {
  const notice = toast.info(
    () =>
      h('span', { class: 'undo-toast' }, [
        t('mailboxes.disabledToast', { address: mailbox.address }),
        h(NButton, { text: true, type: 'primary', style: 'margin-left: 12px', onClick: () => void undo() }, () => t('common.undo')),
      ]),
    { duration: UNDO_MS, closable: true },
  )
  async function undo(): Promise<void> {
    notice.destroy()
    try {
      const { mailbox: restored } = await mailboxApi.update(mailbox.id, { status: 'active' })
      list.prepend(restored)
      adjustQuota(1)
      toast.success(t('mailboxes.enabledToast', { address: restored.address }))
    } catch (err) {
      toast.error(t(`errors.${errorCodeOf(err)}`))
    }
  }
}
</script>

<template>
  <div class="page">
    <nav class="tabs" :aria-label="t('mailboxes.tabsLabel')">
      <RouterLink
        :to="{ name: 'mailboxes' }"
        class="tab"
        :class="{ on: status === 'active' }"
        :aria-current="status === 'active' ? 'page' : undefined"
      >
        {{ t('mailboxes.tabActive') }}
        <span v-if="quota" class="count">{{ quota.used }}</span>
      </RouterLink>
      <RouterLink
        :to="{ name: 'mailboxes-disabled' }"
        class="tab"
        :class="{ on: status === 'disabled' }"
        :aria-current="status === 'disabled' ? 'page' : undefined"
      >
        {{ t('mailboxes.tabDisabled') }}
      </RouterLink>
    </nav>

    <section v-if="status === 'active'" class="command-panel" :aria-label="t('home.newAddress')">
      <AddressCommand :quota="quota" @created="onCreated" />
    </section>
    <p v-else class="intro">{{ t('mailboxes.disabledIntro') }}</p>

    <MailboxListPanel
      v-model:query="query"
      :items="items"
      :loading="loading"
      :loading-more="loadingMore"
      :has-more="!!nextCursor"
      :empty-text="t(status === 'active' ? 'mailboxes.emptyActive' : 'mailboxes.emptyDisabled')"
      :fresh-id="freshId"
      @changed="onChanged"
      @more="list.loadMore"
    />
  </div>
</template>

<style scoped>
.page {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 22px;
}
.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--pl-line);
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 42px;
  padding: 0 14px;
  color: var(--pl-muted);
  font-weight: 500;
  text-decoration: none;
  box-shadow: inset 0 -2px 0 transparent;
}
.tab:hover {
  color: var(--pl-ink);
}
.tab.on {
  color: var(--pl-ink);
  font-weight: 700;
  box-shadow: inset 0 -2px 0 var(--pl-signal);
}
.tab:focus-visible {
  outline: 2px solid var(--pl-blue);
  outline-offset: -2px;
  border-radius: 6px;
}
.count {
  min-width: 20px;
  padding: 0 6px;
  box-sizing: border-box;
  border-radius: 999px;
  background: var(--pl-sunken);
  color: var(--pl-muted);
  font-size: 0.75rem;
  font-weight: 650;
  line-height: 20px;
  text-align: center;
}
.command-panel {
  padding: 22px 24px;
  border: 1px solid var(--pl-line);
  border-radius: 18px;
  background: var(--pl-surface);
}
.intro {
  max-width: 64ch;
  margin: 0;
  color: var(--pl-muted);
  line-height: 1.7;
}
@media (max-width: 600px) {
  .command-panel {
    padding: 16px;
  }
}
</style>
