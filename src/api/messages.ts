import type { InboxSummary, MessageDetail, MessageListResponse } from '../../shared/api'
import { http } from './client'

export interface MessageQuery {
  mailbox?: string | null
  q?: string
  cursor?: string | null
  since?: number
  unread?: boolean
  code?: boolean
  limit?: number
}

export const messageApi = {
  list(params: MessageQuery = {}) {
    const query = new URLSearchParams()
    if (params.mailbox) query.set('mailbox', params.mailbox)
    if (params.q) query.set('q', params.q)
    if (params.cursor) query.set('cursor', params.cursor)
    if (params.since !== undefined) query.set('since', String(params.since))
    if (params.unread) query.set('unread', '1')
    if (params.code) query.set('code', '1')
    if (params.limit) query.set('limit', String(params.limit))
    return http.get<MessageListResponse>(`/api/messages?${query}`)
  },
  get: (id: string) => http.get<{ message: MessageDetail }>(`/api/messages/${encodeURIComponent(id)}`),
  rawUrl: (id: string) => `/api/messages/${encodeURIComponent(id)}/raw`,
  raw: (id: string) => http.binary(`/api/messages/${encodeURIComponent(id)}/raw`),
  setRead: (id: string, isRead: boolean) => http.patch<void>(`/api/messages/${encodeURIComponent(id)}`, { isRead }),
  remove: (id: string) => http.delete<void>(`/api/messages/${encodeURIComponent(id)}`),
  markAllRead: (mailboxId?: string | null) =>
    http.post<{ updated: number }>('/api/messages/mark-read', mailboxId ? { mailboxId } : {}),
  summary(params: { known?: number; recount?: boolean } = {}) {
    const query = new URLSearchParams()
    if (params.known !== undefined) query.set('known', String(params.known))
    if (params.recount) query.set('recount', '1')
    return http.get<InboxSummary>(`/api/messages/summary?${query}`)
  },
}
