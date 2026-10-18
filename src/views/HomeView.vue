<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import type { PublicMailbox } from '../../shared/api'
import MailboxCreator from '@/components/MailboxCreator.vue'
import MailboxItem from '@/components/MailboxItem.vue'
import { useMailboxList } from '@/composables/useMailboxList'
import { session } from '@/stores/session'

const RECENT_COUNT = 5

const { t } = useI18n()
const list = useMailboxList('active')
const { items, quota } = list
const freshId = ref<string | null>(null)
const recent = computed(() => items.value.slice(0, RECENT_COUNT))

onMounted(() => void list.reload())

function onCreated(mailbox: PublicMailbox): void {
  freshId.value = mailbox.id
  list.prepend(mailbox)
  if (quota.value) quota.value = { ...quota.value, used: quota.value.used + 1 }
}

function onChanged(mailbox: PublicMailbox): void {
  list.apply(mailbox)
  if (mailbox.status === 'disabled' && quota.value) quota.value = { ...quota.value, used: quota.value.used - 1 }
}
</script>

<template>
  <div class="home">
    <h2 class="greeting">{{ t('home.greeting', { name: session.user?.username }) }}</h2>
    <MailboxCreator :quota="quota" @created="onCreated" />
    <section v-if="recent.length" class="recent">
      <header>
        <h3>{{ t('mailboxes.recent') }}</h3>
        <RouterLink :to="{ name: 'mailboxes' }">{{ t('mailboxes.viewAll') }}</RouterLink>
      </header>
      <ul class="list">
        <MailboxItem
          v-for="mailbox in recent"
          :key="mailbox.id"
          :mailbox="mailbox"
          :fresh="mailbox.id === freshId"
          @changed="onChanged"
        />
      </ul>
    </section>
  </div>
</template>

<style scoped>
.home {
  display: grid;
  gap: 24px;
}
.greeting {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 650;
}
.recent header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10px;
}
.recent h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}
.recent a {
  color: var(--pl-blue);
  font-size: 0.875rem;
  text-decoration: none;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--pl-line);
  border-radius: 10px;
  background: var(--pl-surface);
}
</style>
