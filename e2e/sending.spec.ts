/** Phase 9 sending: invisible while off; an admin switches it on for a domain and a user. */
import { expect, test } from '@playwright/test'

import { signIn } from './helpers'

test('admin: sending stays hidden until switched on, then a domain and a user are allowed', async ({ page, context, browser }) => {
  const userContext = await browser.newContext({ baseURL: 'http://localhost:5188' })
  const username = await signIn(userContext)
  const status = async () => (await (await userContext.request.get('/api/outbox/status')).json()) as { canSend: boolean }
  expect(await status()).toMatchObject({ canSend: false })

  await signIn(context, { admin: true })
  await page.goto('/admin')
  await page.locator('.n-tabs-tab[data-name="domains"]').click()
  const domainRow = page.locator('li.item', { hasText: 'e2e.test' })
  await expect(domainRow).toBeVisible()
  await expect(domainRow.getByText('可发信')).toHaveCount(0)

  await page.locator('.n-tabs-tab[data-name="settings"]').click()
  const card = page.locator('.n-card', { hasText: '允许发信（总开关）' })
  await card.locator('.n-switch').first().click()
  await expect(card.getByText('发送测试信')).toBeVisible()

  await page.locator('.n-tabs-tab[data-name="domains"]').click()
  await domainRow.locator('label', { hasText: '可发信' }).locator('.n-switch').click()
  await expect(page.getByText('e2e.test 已允许发信')).toBeVisible()

  await page.locator('.n-tabs-tab[data-name="users"]').click()
  // Search across every status (the tab opens on "pending" when someone is waiting).
  await page.getByPlaceholder('搜索用户名').fill(username)
  const userRow = page.locator('li.item', { hasText: username })
  await userRow.getByRole('button', { name: '发信' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('label', { hasText: '允许发信' }).locator('.n-switch').click()
  await dialog.getByRole('button', { name: '保存设置' }).click()
  await expect(userRow.getByText('可发信')).toBeVisible()

  // The user now needs only an address on the domain to send.
  await userContext.request.post('/api/mailboxes', { headers: { origin: 'http://localhost:5188' }, data: { domainId: 'e2e-domain', localPart: `s${Date.now()}` } })
  expect(await status()).toMatchObject({ canSend: true })
  await userContext.close()
})
