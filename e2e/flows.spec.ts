/** The main user flows in a real browser, plus layout checks at phone width. */
import { readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'

import { createMailbox, deliver, mime, part, signIn, uid } from './helpers'

test('home: creating copies the address and makes it current; its code is copied and marked read', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await signIn(context)
  const older = await createMailbox(context.request)
  await page.goto('/')
  await page.getByRole('button', { name: '自定义地址' }).click()
  const local = uid('home')
  await page.locator('#new-local-part').fill(local)
  await page.keyboard.press('Enter')
  await expect(page.locator('section.current .address .local')).toHaveText(local)
  const address = await page.evaluate(() => navigator.clipboard.readText())
  expect(address).toBe(`${local}@e2e.test`)
  await expect(page.locator('section.current .status')).toContainText('每 10 秒')

  await deliver(context.request, address, mime({ to: address, subject: 'Your Acme code', text: 'Your verification code is 615204.' }))
  // The boosted poll runs every 10 s.
  await expect(page.locator('section.current .mail')).toContainText('Your Acme code', { timeout: 30_000 })
  const block = page.locator('.code-block')
  await expect(block.locator('.code-digits')).toHaveText('615204')
  await expect(block).toHaveClass(/fresh/)
  await block.click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('615204')
  await expect(block).not.toHaveClass(/fresh/)
  const mail = await context.request.get('/api/messages?code=1')
  expect(((await mail.json()) as { items: { isRead: boolean }[] }).items[0]?.isRead).toBe(true)

  // Mail opens in a dialog on the home page.
  await page.locator('section.current .mail-link').first().click()
  await expect(page.locator('.mail-dialog .subject')).toHaveText('Your Acme code')
  await expect(page).toHaveURL(/\/$/)
  await page.locator('.mail-dialog .dialog-close').click()
  await expect(page.locator('.mail-dialog')).toHaveCount(0)

  // Picking another address in the list makes it current, and the choice survives a reload.
  await page.locator('.pick', { hasText: older.address.split('@')[0] }).click()
  await expect(page.locator('section.current .address .local')).toHaveText(older.address.split('@')[0])
  await page.reload()
  await expect(page.locator('section.current .address .local')).toHaveText(older.address.split('@')[0])

  // With an older address current, a custom one still becomes current and joins the list.
  await page.getByRole('button', { name: '自定义地址' }).click()
  const another = uid('again')
  await page.locator('#new-local-part').fill(another)
  await page.keyboard.press('Enter')
  await expect(page.locator('section.current .address .local')).toHaveText(another)
  await expect(page.locator('.pick', { hasText: another })).toHaveCount(1)
})

test('inbox: filters, j/k navigation and Esc', async ({ page, context }) => {
  await signIn(context)
  const box = await createMailbox(context.request)
  await deliver(context.request, box.address, mime({ to: box.address, subject: 'Plain newsletter', text: 'Hello there.' }))
  await deliver(context.request, box.address, mime({ to: box.address, subject: 'Login code', text: 'Your code is 482913.' }))

  await page.goto('/inbox')
  await expect(page.locator('.row')).toHaveCount(2)
  await page.locator('.row').first().click()
  await expect(page.locator('.drawer .subject')).toHaveText('Login code')
  await page.locator('body').press('j')
  await expect(page.locator('.drawer .subject')).toHaveText('Plain newsletter')
  await page.locator('body').press('Escape')
  await expect(page.locator('.drawer')).toHaveCount(0)

  await page.getByRole('button', { name: '验证码', exact: true }).click()
  await expect(page).toHaveURL(/filter=code/)
  await expect(page.locator('.row')).toHaveCount(1)
  await expect(page.locator('.row')).toContainText('482913')
})

test('addresses: disabling is immediate and can be undone', async ({ page, context }) => {
  await signIn(context)
  const box = await createMailbox(context.request)
  await page.goto('/mailboxes')
  const row = page.locator('li.item', { hasText: box.address.split('@')[0] })
  await row.getByRole('button', { name: '更多操作' }).click()
  await page.getByText('停用', { exact: true }).click()
  await expect(row).toHaveCount(0)
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(page.locator('li.item', { hasText: box.address.split('@')[0] })).toHaveCount(1)
})

test('attachments, inline images and long bodies come from the original in R2', async ({ page, context }) => {
  await signIn(context)
  const box = await createMailbox(context.request)
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEklEQVR4nGP8z8DAwMDAxMDAAAAg9AIDWBb8CQAAAABJRU5ErkJggg==',
    'base64',
  )
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(4096, 7), Buffer.from('\n%%EOF\n')])
  const html = `<p>Inline:</p><img id="logo" src="cid:logo@e2e" width="40" height="40"><p>${'filler '.repeat(50_000)}</p><p id="end">END-OK</p>`
  await deliver(
    context.request,
    box.address,
    mime({
      to: box.address,
      subject: 'Big mail with files',
      html,
      extraParts: [
        part({ type: 'image/png', content: png, filename: 'logo.png', cid: 'logo@e2e', inline: true }),
        part({ type: 'application/pdf', content: pdf, filename: 'invoice.pdf' }),
      ].join('\n'),
    }),
  )

  await page.goto('/inbox')
  await page.getByText('Big mail with files').first().click()
  const frame = page.frameLocator('iframe[title="Big mail with files"]')
  await expect(frame.locator('#end')).toHaveText('END-OK') // beyond the 256 KB parse window
  await expect(frame.locator('#logo')).toHaveAttribute('src', /^data:image\/png;base64,/)
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下载' }).click()])
  expect(download.suggestedFilename()).toBe('invoice.pdf')
  expect(readFileSync(await download.path()).equals(pdf)).toBe(true)
})

test('no horizontal scrolling at phone width', async ({ page, context }) => {
  await signIn(context)
  const box = await createMailbox(context.request)
  await deliver(context.request, box.address, mime({ to: box.address, subject: 'x'.repeat(200), text: 'y '.repeat(400) }))
  await page.setViewportSize({ width: 390, height: 844 })
  for (const path of ['/', '/inbox', '/mailboxes', '/mailboxes/disabled', '/account']) {
    await page.goto(path)
    await page.waitForTimeout(800)
    const result = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth
      // Content cut off by an ancestor that clips (ellipsis, scroll boxes) is not visible overflow.
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
})
