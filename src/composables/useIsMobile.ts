import { onBeforeUnmount, ref } from 'vue'

const QUERY = '(max-width: 767px)'

export function useIsMobile() {
  const media = window.matchMedia(QUERY)
  const isMobile = ref(media.matches)
  const update = (e: MediaQueryListEvent) => (isMobile.value = e.matches)
  media.addEventListener('change', update)
  onBeforeUnmount(() => media.removeEventListener('change', update))
  return isMobile
}
