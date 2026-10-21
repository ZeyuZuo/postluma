import type { OutboxListResponse, OutboxStatus, SendMailInput, SentMessageDetail } from '../../shared/api'
import { http } from './client'

export const outboxApi = {
  status: () => http.get<OutboxStatus>('/api/outbox/status'),
  list: (cursor?: string | null) => http.get<OutboxListResponse>(`/api/outbox${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  get: (id: string) => http.get<{ message: SentMessageDetail }>(`/api/outbox/${encodeURIComponent(id)}`),
  send: (body: SendMailInput) => http.post<{ message: SentMessageDetail }>('/api/outbox', body),
}
