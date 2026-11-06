import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * What the inbox and Sent share around their list: the open message lives in the URL (`/<page>/:id`),
 * new mail takes its place in the drawer, and the same keys work on both pages: j/k move through the
 * list, Esc closes the message and / focuses the search box (if the page has one), never while typing.
 */
export function useMailDrawer(page: 'inbox' | 'sent', items: () => readonly { id: string }[], focusSearch?: () => void) {
  const route = useRoute()
  const router = useRouter()

  const selectedId = computed(() => (route.name === page && typeof route.params.id === 'string' && route.params.id ? route.params.id : null))
  /** New mail in the drawer (sending only); opening a message replaces it. */
  const composing = ref(false)
  const drawerOpen = computed(() => composing.value || selectedId.value !== null)
  watch(selectedId, (id) => {
    if (id) composing.value = false
  })

  function open(id: string): void {
    void router.push({ name: page, params: { id }, query: route.query })
  }

  function closeDetail(): void {
    void router.push({ name: page, params: {}, query: route.query })
  }

  function compose(): void {
    if (selectedId.value) closeDetail()
    composing.value = true
  }

  function closeDrawer(): void {
    composing.value = false
    if (selectedId.value) closeDetail()
  }

  function onKey(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const target = e.target as HTMLElement | null
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
    if (e.key === '/' && focusSearch) {
      e.preventDefault()
      focusSearch()
    } else if (e.key === 'Escape' && selectedId.value) {
      closeDetail()
    } else if (e.key === 'j' || e.key === 'k') {
      const list = items()
      const index = list.findIndex((m) => m.id === selectedId.value)
      const next = list[index === -1 ? 0 : index + (e.key === 'j' ? 1 : -1)]
      if (!next) return
      open(next.id)
      void nextTick(() => document.querySelector(`[data-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: 'nearest' }))
    }
  }
  onMounted(() => window.addEventListener('keydown', onKey))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

  return { selectedId, composing, drawerOpen, open, closeDetail, compose, closeDrawer }
}
