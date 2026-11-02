/**
 * The deploy-time service mode (docs/MODES_DESIGN.md). It comes from the public settings so it is
 * known before sign-in: the login page hides "register" in personal mode.
 */
import { readonly, ref } from 'vue'

import type { ServiceMode } from '../../shared/api'
import { authApi } from '@/api/auth'

const mode = ref<ServiceMode | null>(null)
let pending: Promise<ServiceMode> | null = null

export const serviceMode = readonly(mode)

/** Loads once per page load; a failed request counts as `temporary` but is asked again next time. */
export function loadServiceMode(): Promise<ServiceMode> {
  if (mode.value) return Promise.resolve(mode.value)
  pending ??= authApi
    .publicSettings()
    .then((s) => (mode.value = s.mode))
    .catch(() => 'temporary' as const)
    .finally(() => {
      pending = null
    })
  return pending
}

export function isPersonal(): boolean {
  return mode.value === 'personal'
}
