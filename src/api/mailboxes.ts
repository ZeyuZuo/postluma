import type { AdminDomain, DomainHealth, MailboxListResponse, MailboxStatus, PublicDomain, PublicMailbox } from '../../shared/api'
import { http } from './client'

export const mailboxApi = {
  list: (params: { status: MailboxStatus; q?: string; cursor?: string | null }) => {
    const query = new URLSearchParams({ status: params.status })
    if (params.q) query.set('q', params.q)
    if (params.cursor) query.set('cursor', params.cursor)
    return http.get<MailboxListResponse>(`/api/mailboxes?${query}`)
  },
  create: (body: { domainId: string; localPart?: string; note?: string }) =>
    http.post<{ mailbox: PublicMailbox }>('/api/mailboxes', body),
  update: (id: string, body: { note?: string | null; status?: MailboxStatus; acceptSubaddress?: boolean }) =>
    http.patch<{ mailbox: PublicMailbox }>(`/api/mailboxes/${encodeURIComponent(id)}`, body),
  domains: () => http.get<{ items: PublicDomain[] }>('/api/domains'),
}

export const adminDomainApi = {
  list: () => http.get<{ items: AdminDomain[] }>('/api/admin/domains'),
  create: (domain: string) => http.post<{ id: string }>('/api/admin/domains', { domain }),
  setEnabled: (id: string, enabled: boolean) =>
    http.patch<void>(`/api/admin/domains/${encodeURIComponent(id)}`, { enabled }),
  remove: (id: string) => http.delete<void>(`/api/admin/domains/${encodeURIComponent(id)}`),
  setCanSend: (id: string, canSend: boolean) =>
    http.patch<void>(`/api/admin/domains/${encodeURIComponent(id)}`, { canSend }),
  health: (id: string) => http.get<{ health: DomainHealth }>(`/api/admin/domains/${encodeURIComponent(id)}/health`),
}
