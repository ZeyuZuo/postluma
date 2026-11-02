import { expect, test, type Page } from '@playwright/test'

import { createMailbox, deliver, E2E_DOMAIN_ID, mime, signIn, sql, uid } from './helpers'

async function setCatchAll(page: Page, enabled: boolean): Promise<void> {
  await page.goto('/admin')
  await page.locator('.n-tabs-tab[data-name="domains"]').click()
  const row = page.locator('li.item', { hasText: 'e2e.test' })
  const control = row.locator('label', { hasText: 'catch-all 自动建地址' }).getByRole('switch')
  await expect(control).toBeVisible()
  if ((await control.getAttribute('aria-checked')) !== String(enabled)) {
    await control.click()
    await expect(page.getByText(enabled ? 'e2e.test 已开启 catch-all' : 'e2e.test 已关闭 catch-all')).toBeVisible()
  }
  await expect(control).toHaveAttribute('aria-checked', String(enabled))
}

test('catch-all creates an address on its first message and labels it', async ({ page, context }) => {
  await signIn(context, { admin: true })
  const manual = await createMailbox(context.request)
  const local = `shop${uid('')}`
  const address = `${local}@e2e.test`
  const subject = `Catch-all ${uid('')}`

  try {
    await setCatchAll(page, true)
    await deliver(context.request, address, mime({ to: address, subject, text: 'Delivered to a new address.' }))

    await page.goto('/mailboxes')
    const row = page.locator('li.item', { hasText: local })
    await expect(row.locator('.address')).toContainText(address)
    await expect(row.getByText('自动创建', { exact: true })).toBeVisible()

    await page.goto('/inbox')
    await expect(page.locator('.row', { hasText: subject })).toBeVisible()

    await page.goto('/')
    await expect(page.locator('section.current .address .local')).toHaveText(manual.address.split('@')[0])
  } finally {
    await setCatchAll(page, false)
  }
})

test('catch-all controls and addresses have no horizontal scrolling at phone width', async ({ page, context }) => {
  await signIn(context, { admin: true })
  await page.setViewportSize({ width: 390, height: 844 })
  const local = `shop${uid('')}`
  const address = `${local}@e2e.test`

  try {
    await setCatchAll(page, true)
    await deliver(context.request, address, mime({ to: address, subject: 'Phone layout', text: 'A new address.' }))

    for (const path of ['/admin', '/mailboxes']) {
      await page.goto(path)
      if (path === '/admin') {
        await page.locator('.n-tabs-tab[data-name="domains"]').click()
        const row = page.locator('li.item', { hasText: 'e2e.test' })
        await expect(row.getByText('catch-all 自动建地址')).toBeVisible()
        // The switches wrap below the domain instead of squeezing it to one character per line.
        expect((await row.locator('.name').boundingBox())!.height).toBeLessThan(30)
      } else {
        await expect(page.locator('li.item', { hasText: local }).getByText('自动创建', { exact: true })).toBeVisible()
      }
      await page.waitForTimeout(800)
      const result = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth
        // Content clipped by an ancestor is not visible overflow.
        const clipped = (el: Element) => {
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            if (getComputedStyle(p).overflowX !== 'visible' && p.getBoundingClientRect().right <= vw + 1) return true
          }
          return false
        }
        const over = [...document.querySelectorAll('main *')].filter((el) => el.getBoundingClientRect().right > vw + 1 && !clipped(el))
        return { doc: document.documentElement.scrollWidth, over: over.slice(0, 3).map((el) => `${el.tagName}.${el.className}`) }
      })
      expect(result.doc, path).toBeLessThanOrEqual(390)
      expect(result.over, path).toEqual([])
    }
  } finally {
    await setCatchAll(page, false)
  }
})

test('the home page keeps an address made by hand current when catch-all fills the first page', async ({ page, context }) => {
  await signIn(context, { admin: true })
  const older = await createMailbox(context.request, uid('old'))
  const newer = await createMailbox(context.request, uid('new'))
  const { user } = (await (await context.request.get('/api/auth/me')).json()) as { user: { id: string } }
  // 55 newer addresses from catch-all push both off the first page of 50.
  const from = Date.now() + 60_000
  sql(
    Array.from({ length: 55 }, (_, i) => {
      const at = from + i
      return `INSERT INTO mailboxes (id, user_id, domain_id, address, status, auto_created, created_at, updated_at)
        VALUES ('${uid('auto')}', '${user.id}', '${E2E_DOMAIN_ID}', '${uid('auto')}@e2e.test', 'active', 1, ${at}, ${at});`
    }).join(' '),
  )

  await page.goto('/')
  await expect(page.locator('section.current .address .local')).toHaveText(newer.address.split('@')[0])

  // An address remembered as current is still found when it isn't on the first page.
  await page.evaluate(([key, id]) => localStorage.setItem(key, id), [`postluma.current.${user.id}`, older.id])
  await page.reload()
  await expect(page.locator('section.current .address .local')).toHaveText(older.address.split('@')[0])
})
