import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'

import type { MessageSummary } from '../../shared/api'
import { messageApi } from '@/api/messages'
import { copyText } from '@/composables/useClipboard'
import { adjustUnread } from '@/stores/inbox'

/** The fields a copy needs; `isRead` is updated in place so lists reflect it immediately. */
export type CodeMessage = Pick<MessageSummary, 'id' | 'verificationCode' | 'isRead' | 'mailboxStatus'>

/**
 * Copies a verification code. Copying the code is reading the message, so an unread message is
 * marked read too (and the unread badge follows).
 */
export function useCopyCode() {
  const { t } = useI18n()
  const toast = useMessage()

  return async function copyCode(code: string, message?: CodeMessage): Promise<void> {
    if (!(await copyText(code))) {
      toast.warning(t('common.copyFailed'))
      return
    }
    toast.success(t('inbox.codeCopied', { code }))
    if (!message || message.isRead) return
    message.isRead = true
    if (message.mailboxStatus === 'active') adjustUnread(-1)
    try {
      await messageApi.setRead(message.id, true)
    } catch {
      // Still copied; the read state syncs on the next open or recount.
    }
  }
}
