import type { Mailer } from './types'

/**
 * Records instead of sending (MAIL_PROVIDER=log): local development and e2e. Logs metadata only,
 * never the body or recipients.
 */
export function logMailer(): Mailer {
  return {
    name: 'log',
    configured: true,
    async send(mail) {
      console.log('[mail:log] would send', { from: mail.from, recipients: mail.to.length, subject: mail.subject.length })
      return { ok: true, id: `log-${crypto.randomUUID()}` }
    },
    async domainStatus() {
      return 'verified'
    },
  }
}
