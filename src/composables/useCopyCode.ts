import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'

import type { MessageSummary } from '../../shared/api'
import { messageApi } from '@/api/messages'
import { copyText } from '@/composables/useClipboard'
import { adjustUnread } from '@/stores/inbox'

/** The fields a copy or open needs; `isRead` is updated in place so lists reflect it immediately. */
export type CodeMessage = Pick<MessageSummary, 'id' | 'isRead' | 'mailboxStatus'>

/** Copying a code or opening a link is reading the message: mark it read (the badge follows). */
export async function markHandled(message?: CodeMessage): Promise<void> {
  if (!message || message.isRead) return
  message.isRead = true
  if (message.mailboxStatus === 'active') adjustUnread(-1)
  try {
    await messageApi.setRead(message.id, true)
  } catch {
    // The read state syncs on the next open or recount.
  }
}

/** Copies a verification code and marks its message read. */
export function useCopyCode() {
  const { t } = useI18n()
  const toast = useMessage()

  return async function copyCode(code: string, message?: CodeMessage): Promise<void> {
    if (!(await copyText(code))) {
      toast.warning(t('common.copyFailed'))
      return
    }
    toast.success(t('inbox.codeCopied', { code }))
    await markHandled(message)
  }
}
