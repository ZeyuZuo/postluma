import { createRouter, createWebHistory } from 'vue-router'

import { i18n } from '@/i18n'
import AppLayout from '@/layouts/AppLayout.vue'
import { loadSession, session, setUser } from '@/stores/session'

declare module 'vue-router' {
  interface RouteMeta {
    /** Reachable without a session. */
    public?: boolean
    /** Signed-in users are sent home instead (login/register). */
    guestOnly?: boolean
    admin?: boolean
    titleKey?: string
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/auth/LoginView.vue'),
      meta: { public: true, guestOnly: true, titleKey: 'auth.loginTitle' },
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('@/views/auth/RegisterView.vue'),
      meta: { public: true, guestOnly: true, titleKey: 'auth.registerTitle' },
    },
    {
      path: '/',
      component: AppLayout,
      children: [
        { path: '', name: 'home', component: () => import('@/views/HomeView.vue'), meta: { titleKey: 'nav.home' } },
        { path: 'inbox/:id?', name: 'inbox', component: () => import('@/views/InboxView.vue'), meta: { titleKey: 'nav.inbox' } },
        { path: 'sent/:id?', name: 'sent', component: () => import('@/views/SentView.vue'), meta: { titleKey: 'compose.sentTab' } },
        // One view, two tabs: addresses in use and disabled ones (history still readable).
        {
          path: 'mailboxes',
          name: 'mailboxes',
          component: () => import('@/views/MailboxesView.vue'),
          props: { status: 'active' },
          meta: { titleKey: 'nav.mailboxes' },
        },
        {
          path: 'mailboxes/disabled',
          name: 'mailboxes-disabled',
          component: () => import('@/views/MailboxesView.vue'),
          props: { status: 'disabled' },
          meta: { titleKey: 'nav.disabled' },
        },
        {
          path: 'account',
          name: 'account',
          component: () => import('@/views/AccountView.vue'),
          meta: { titleKey: 'nav.account' },
        },
        {
          path: 'admin',
          name: 'admin',
          component: () => import('@/views/admin/AdminView.vue'),
          meta: { admin: true, titleKey: 'nav.admin' },
        },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  if (!session.loaded) await loadSession().catch(() => setUser(null))
  if (to.meta.public) return session.user && to.meta.guestOnly ? { name: 'home' } : true
  if (!session.user) return { name: 'login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } }
  if (to.meta.admin && session.user.role !== 'admin') return { name: 'home' }
  return true
})

router.afterEach((to) => {
  const title = to.meta.titleKey ? i18n.global.t(to.meta.titleKey) : ''
  document.title = title ? `${title} | PostLuma` : 'PostLuma'
})

export default router
