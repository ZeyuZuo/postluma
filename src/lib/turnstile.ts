import { publishedSiteKey } from '@/stores/mode'

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string
  reset(widgetId: string): void
  remove(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

/** Baked in at build time by deployments that predate the Worker publishing the key. */
const BUILD_TIME_SITE_KEY: string = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? ''

/** The widget key: the one the Worker publishes, else the build-time `VITE_TURNSTILE_SITE_KEY`. */
export function turnstileSiteKey(): string {
  return publishedSiteKey.value ?? BUILD_TIME_SITE_KEY
}

export function turnstileEnabled(): boolean {
  return turnstileSiteKey() !== ''
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let loading: Promise<TurnstileApi> | undefined

export function loadTurnstile(): Promise<TurnstileApi> {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing')))
    script.onerror = () => {
      loading = undefined
      reject(new Error('turnstile failed to load'))
    }
    document.head.appendChild(script)
  })
  return loading
}
