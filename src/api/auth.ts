import type { Locale, PublicSettings, PublicUser } from '../../shared/api'
import { http } from './client'

export const authApi = {
  me: () => http.get<{ user: PublicUser }>('/api/auth/me'),
  login: (body: { username: string; password: string; turnstileToken?: string }) =>
    http.post<{ user: PublicUser }>('/api/auth/login', body),
  register: (body: { username: string; password: string; turnstileToken?: string }) =>
    http.post<{ status: 'pending' }>('/api/auth/register', body),
  logout: () => http.post<void>('/api/auth/logout'),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    http.post<void>('/api/auth/password', body),
  updateProfile: (body: { locale: Locale | null }) => http.patch<{ user: PublicUser }>('/api/auth/me', body),
  publicSettings: () => http.get<PublicSettings>('/api/settings/public'),
}
