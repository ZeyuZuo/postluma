/**
 * The deploy-time service mode (docs/MODES_DESIGN.md) and the Turnstile site key. Both come from the
 * public settings so they are known before sign-in: the login page hides "register" in personal mode
 * and renders the Turnstile widget with that key.
 */
import { readonly, ref } from 'vue'

import type { ServiceMode } from '../../shared/api'
import { authApi } from '@/api/auth'

const mode = ref<ServiceMode | null>(null)
const siteKey = ref<string | null>(null)
let pending: Promise<ServiceMode> | null = null

export const serviceMode = readonly(mode)
/** The Turnstile site key the Worker publishes (`TURNSTILE_SITE_KEY`); see `turnstileSiteKey()`. */
export const publishedSiteKey = readonly(siteKey)

/** Loads once per page load; a failed request counts as `temporary` but is asked again next time. */
export function loadServiceMode(): Promise<ServiceMode> {
  if (mode.value) return Promise.resolve(mode.value)
  pending ??= authApi
    .publicSettings()
    .then((s) => {
      siteKey.value = s.turnstileSiteKey
      return (mode.value = s.mode)
    })
    .catch(() => 'temporary' as const)
    .finally(() => {
      pending = null
    })
  return pending
}

export function isPersonal(): boolean {
  return mode.value === 'personal'
}
