/** The configured mail provider (MAIL_PROVIDER). Cloudflare's send_email binding is planned (9.7). */
import type { AppConfig } from '../config'
import { logMailer } from './log'
import { resendMailer } from './resend'
import type { Mailer } from './types'

export type { DomainSendStatus, Mailer, OutgoingMail, SendErrorCode, SendResult } from './types'

export function getMailer(env: Env, config: AppConfig): Mailer {
  switch (config.sending.provider) {
    case 'log':
      return logMailer()
    case 'resend':
      return resendMailer((env as { RESEND_API_KEY?: string }).RESEND_API_KEY)
  }
}
