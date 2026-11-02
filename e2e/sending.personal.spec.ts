/** Sending (personal mode only): invisible while off; the administrator switches it on for a domain. */
import { expect, test } from '@playwright/test'

import { createMailbox, deliver, E2E_DOMAIN_ID, mime, signIn, sql } from './helpers'

test('admin: sending stays hidden until switched on, then a domain is allowed', async ({ page, context }) => {
  await signIn(context, { admin: true })
  const status = async () => (await (await context.request.get('/api/outbox/status')).json()) as { canSend: boolean }
  expect(await status()).toMatchObject({ canSend: false })

  await page.goto('/admin')
  await page.locator('.n-tabs-tab[data-name="domains"]').click()
  const domainRow = page.locator('li.item', { hasText: 'e2e.test' })
  await expect(domainRow).toBeVisible()
  await expect(domainRow.getByText('可发信')).toHaveCount(0)

  await page.locator('.n-tabs-tab[data-name="settings"]').click()
  const card = page.locator('.n-card', { hasText: '允许发信（总开关）' })
  await card.locator('.n-switch').first().click()
  await expect(card.getByText('发送测试信')).toBeVisible()
  await expect(card.getByText('用户')).toHaveCount(0)

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
  // Both switches on (the admin flow is covered above).
  sql(
    "INSERT INTO settings (key, value, updated_at) VALUES ('sending_enabled', 'true', 0) ON CONFLICT (key) DO UPDATE SET value = 'true';" +
      ` UPDATE domains SET can_send = 1 WHERE id = '${E2E_DOMAIN_ID}';`,
  )
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

  await page.getByRole('link', { name: '已发送' }).click()
  await expect(page.locator('.sent .row')).toHaveCount(2)
  await expect(page.locator('.sent .row').first()).toContainText('friend@example.org +1')
  await page.locator('.sent .row', { hasText: 'Re: Question' }).click()
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
