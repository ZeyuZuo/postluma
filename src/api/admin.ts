import type {
  AdminSettings,
  AdminStats,
  AdminUserAction,
  AdminUserListResponse,
  AuditListResponse,
  BatchDeleteResponse,
  UserStatus,
} from '../../shared/api'
import { http } from './client'

const enc = encodeURIComponent

export const adminApi = {
  users(params: { status?: UserStatus | null; q?: string; cursor?: string | null } = {}) {
    const query = new URLSearchParams()
    if (params.status) query.set('status', params.status)
    if (params.q) query.set('q', params.q)
    if (params.cursor) query.set('cursor', params.cursor)
    return http.get<AdminUserListResponse>(`/api/admin/users?${query}`)
  },
  act: (id: string, action: AdminUserAction) => http.post<{ status: UserStatus }>(`/api/admin/users/${enc(id)}/action`, { action }),
  setQuota: (id: string, mailboxQuota: number | null) => http.patch<void>(`/api/admin/users/${enc(id)}/quota`, { mailboxQuota }),
  messageCount: (id: string) => http.get<{ count: number }>(`/api/admin/users/${enc(id)}/message-count`),
  purgeMessages: (id: string) => http.post<BatchDeleteResponse>(`/api/admin/users/${enc(id)}/purge-messages`),
  deleteUser: (id: string) => http.delete<void>(`/api/admin/users/${enc(id)}`),
  settings: () => http.get<AdminSettings>('/api/admin/settings'),
  updateSettings: (body: Partial<Record<'registrationOpen' | 'defaultMailboxQuota' | 'retentionDays', boolean | number | null>>) =>
    http.patch<AdminSettings>('/api/admin/settings', body),
  stats: () => http.get<AdminStats>('/api/admin/stats'),
  audit: (cursor?: string | null) => http.get<AuditListResponse>(`/api/admin/audit${cursor ? `?cursor=${enc(cursor)}` : ''}`),
  cleanup: (olderThanDays: number) => http.post<BatchDeleteResponse>('/api/admin/cleanup', { olderThanDays }),
}
