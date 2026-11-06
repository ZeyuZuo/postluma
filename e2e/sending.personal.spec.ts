/** Sending (personal mode only): invisible while off; the administrator switches it on for a domain. */
import { expect, test, type Page } from '@playwright/test'

import { base, createMailbox, deliver, E2E_DOMAIN_ID, mime, signIn, sql, uid, type Mailbox } from './helpers'

/** Both switches on. The first test needs them off, and the database is shared: keep it first. */
function enableSending(): void {
  sql(
    "INSERT INTO settings (key, value, updated_at) VALUES ('sending_enabled', 'true', 0) ON CONFLICT (key) DO UPDATE SET value = 'true';" +
      ` UPDATE domains SET can_send = 1 WHERE id = '${E2E_DOMAIN_ID}';`,
  )
}

async function send(page: Page, box: Mailbox, subject: string, to = ['friend@example.org']): Promise<void> {
  const res = await page.context().request.post('/api/outbox', {
    headers: { origin: base() },
    data: { mailboxId: box.id, to, subject, text: `Body of ${subject}`, idempotencyKey: uid('key') },
  })
  expect(res.status(), await res.text()).toBe(201)
}

test('admin: sending stays hidden until switched on, then a domain is allowed', async ({ page, context }) => {
  await signIn(context, { admin: true })
  const status = async () => (await (await context.request.get('/api/outbox/status')).json()) as { canSend: boolean }
  expect(await status()).toMatchObject({ canSend: false })

  await page.goto('/admin')
  const sentLink = page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '发件箱' })
  await expect(sentLink).toHaveCount(0)
  await page.locator('.n-tabs-tab[data-name="domains"]').click()
  const domainRow = page.locator('li.item', { hasText: 'e2e.test' })
  await expect(domainRow).toBeVisible()
  await expect(domainRow.getByText('可发信')).toHaveCount(0)

  await page.locator('.n-tabs-tab[data-name="settings"]').click()
  const card = page.locator('.n-card', { hasText: '允许发信（总开关）' })
  await card.locator('.n-switch').first().click()
  await expect(card.getByText('发送测试信')).toBeVisible()
  await expect(card.getByText('用户')).toHaveCount(0)
  await expect(sentLink, 'no reload needed').toBeVisible()

  await page.locator('.n-tabs-tab[data-name="domains"]').click()
  await domainRow.locator('label', { hasText: '可发信' }).locator('.n-switch').click()
  await expect(page.getByText('e2e.test 已允许发信')).toBeVisible()

  // The administrator always may send; an address on the domain is all that is missing.
  await createMailbox(context.request)
  expect(await status()).toMatchObject({ canSend: true })
})

test('admin: reply to a message, compose a new one, find both under Sent', async ({ page, context }) => {
  await signIn(context, { admin: true })
  const box = await createMailbox(context.request)
  enableSending()
  await deliver(context.request, box.address, mime({ to: box.address, subject: 'Question about your order', text: 'Can you confirm the size?' }))

  await page.goto('/inbox')
  await page.locator('.row').first().click()
  await page.getByRole('button', { name: '回复' }).click()
  const reply = page.locator('form.compose')
  await expect(reply.getByLabel('收件人')).toHaveValue('sender@example.org')
  await expect(reply.getByLabel('主题')).toHaveValue('Re: Question about your order')
  await reply.locator('textarea').fill('Yes, size M.')
  await reply.getByRole('button', { name: '发送' }).click()
  await expect(page.getByText('邮件已发送')).toBeVisible()
  await expect(reply).toHaveCount(0)

  await page.locator('.drawer .close').click()
  await page.getByRole('button', { name: '写邮件' }).click()
  const compose = page.locator('form.compose')
  await compose.getByLabel('收件人').fill('friend@example.org, other@example.net')
  await compose.getByLabel('主题').fill('Hello from PostLuma')
  await compose.locator('textarea').fill('Just testing.')
  await compose.getByRole('button', { name: '发送' }).click()
  await expect(page.getByText('邮件已发送')).toBeVisible()

  await page.getByRole('link', { name: '发件箱' }).click()
  await expect(page.locator('.row')).toHaveCount(2)
  await expect(page.locator('.row').first()).toContainText('friend@example.org +1')
  await page.locator('.row', { hasText: 'Re: Question' }).click()
  await expect(page.locator('.drawer')).toContainText('Yes, size M.')

  // Home: compose from the current address.
  await page.goto('/')
  await page.locator('section.current').getByRole('button', { name: '写邮件' }).click()
  await expect(page.locator('.compose-dialog form.compose')).toContainText(box.address)
  await page.keyboard.press('Escape')

  // Addresses: a row that can send opens compose with itself as the sender.
  await page.goto('/mailboxes')
  await page.getByRole('button', { name: `用 ${box.address} 写邮件` }).click()
  await expect(page.locator('.compose-dialog form.compose')).toContainText(box.address)
})

test('sent mail has a page of its own and opens the way received mail does', async ({ page, context }) => {
  await signIn(context, { admin: true })
  const box = await createMailbox(context.request)
  enableSending()
  await send(page, box, 'Older note')
  await send(page, box, 'Newer note')

  // A destination in the navigation, not a filter of the inbox.
  await page.goto('/inbox')
  await expect(page.locator('.segmented')).not.toContainText('发件箱')
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '发件箱' }).click()
  await expect(page).toHaveURL(/\/sent$/)
  await expect(page.locator('.topnav-link.active')).toHaveText('发件箱')
  await expect(page.locator('.row')).toHaveCount(2)

  // The drawer has its full size from the first frame, however long the message takes to load.
  await page.route(/\/api\/outbox\/(?!status)/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400))
    await route.continue()
  })
  await page.locator('.row', { hasText: 'Newer note' }).click()
  const drawer = page.locator('.drawer')
  await expect(drawer).toBeVisible()
  const opening = (await drawer.boundingBox())!
  await expect(drawer.locator('.subject')).toHaveText('Newer note')
  await expect(drawer).toContainText('Body of Newer note')
  const loaded = (await drawer.boundingBox())!
  expect(loaded.height, 'no jump when the message arrives').toBe(opening.height)
  expect(loaded.width, 'reads as wide as received mail').toBe(880)

  // The same keys as the inbox, and the drawer leaves through the same transition.
  await page.locator('body').press('j')
  await expect(drawer.locator('.subject')).toHaveText('Older note')
  await page.locator('body').press('Escape')
  await expect(drawer).toHaveClass(/drawer-leave-active/)
  await expect(drawer).toHaveCount(0)
  await expect(page).toHaveURL(/\/sent$/)
})

test('sent mail at phone width: a tab of its own, a list, one message, and back', async ({ page, context }) => {
  await signIn(context, { admin: true })
  const box = await createMailbox(context.request)
  enableSending()
  await send(page, box, 'y'.repeat(120), ['a-very-long-recipient-name@example.org', 'another-long-recipient@example.net'])
  await page.setViewportSize({ width: 390, height: 844 })

  await page.goto('/sent')
  await expect(page.locator('.tabbar .tab.active')).toContainText('发件箱')
  await expect(page.locator('.row')).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  await page.locator('.row').click()
  await expect(page.locator('.drawer')).toContainText('another-long-recipient@example.net')
  await expect(page.locator('.row')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.getByRole('button', { name: '返回' }).click()
  await expect(page.locator('.row')).toHaveCount(1)
})
