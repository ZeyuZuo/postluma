import { useMessage } from 'naive-ui'
import { ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import type { PublicMailbox } from '../../shared/api'
import { errorCodeOf } from '@/api/client'
import { mailboxApi } from '@/api/mailboxes'
import { copyText } from '@/composables/useClipboard'
import { useDomains } from '@/composables/useDomains'
import { setCurrentMailbox } from '@/stores/current'

/**
 * The address created most recently, for lists to add. A shared signal rather than a component
 * event: making the new address current can unmount the form that created it, and Vue drops events
 * from unmounted components.
 */
export const createdMailbox = shallowRef<PublicMailbox | null>(null)

/**
 * Creating an address always does the same three things: create it on the chosen domain, copy it
 * (it is about to be pasted into a sign-up form) and make it the current address.
 */
export function useCreateMailbox() {
  const { t } = useI18n()
  const toast = useMessage()
  const { domainId } = useDomains()
  const busy = ref(false)

  async function create(localPart?: string): Promise<PublicMailbox | null> {
    if (!domainId.value || busy.value) return null
    busy.value = true
    try {
      const { mailbox } = await mailboxApi.create({ domainId: domainId.value, localPart })
      const copied = await copyText(mailbox.address)
      toast.success(t(copied ? 'mailboxes.generated' : 'mailboxes.createdNoCopy', { address: mailbox.address }))
      // Lists add it before it becomes current, so the home page never falls back to another address.
      createdMailbox.value = mailbox
      setCurrentMailbox(mailbox.id)
      return mailbox
    } catch (err) {
      toast.error(t(`errors.${errorCodeOf(err)}`))
      return null
    } finally {
      busy.value = false
    }
  }

  return { create, busy }
}
