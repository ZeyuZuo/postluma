import { expect, test } from '@playwright/test'

import { createMailbox, deliver, mime, signIn } from './helpers'

test('star from the row, filter starred mail, and unstar from the detail', async ({ page, context }) => {
  await signIn(context, { admin: true })
  const box = await createMailbox(context.request)
  const subject = 'Keep this message'
  await deliver(context.request, box.address, mime({ to: box.address, subject, text: 'A message to keep.' }))

  await page.goto('/inbox')
  const row = page.locator('.row', { hasText: subject })
  const [starred] = await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'PATCH' && res.url().includes('/api/messages/')),
    row.getByRole('button', { name: '收藏', exact: true }).click(),
  ])
  expect(starred.status()).toBe(204)
  await expect(row.getByRole('button', { name: '取消收藏', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.drawer')).toHaveCount(0)
  await expect(page).toHaveURL(/\/inbox$/)

  const [filtered] = await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'GET' && new URL(res.url()).searchParams.get('starred') === '1'),
    page.getByRole('group', { name: '筛选' }).getByRole('button', { name: '收藏', exact: true }).click(),
  ])
  expect(filtered.status()).toBe(200)
  await expect(page).toHaveURL(/filter=starred/)
  await expect(row).toBeVisible()
  await row.click()
  const detail = page.locator('.drawer')
  await expect(detail.getByText('已收藏，不会被自动清理')).toBeVisible()
  const [unstarred] = await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'PATCH' && res.request().postDataJSON()?.starred === false),
    detail.getByRole('button', { name: '取消收藏', exact: true }).click(),
  ])
  expect(unstarred.status()).toBe(204)
  await expect(detail.getByText('已收藏，不会被自动清理')).toHaveCount(0)
  await expect(row.getByRole('button', { name: '收藏', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await detail.locator('.close').click()
  await expect(page.locator('.drawer')).toHaveCount(0)
  const [reloaded] = await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'GET' && new URL(res.url()).searchParams.get('starred') === '1'),
    page.reload(),
  ])
  expect(reloaded.status()).toBe(200)
  await expect(page.getByRole('group', { name: '筛选' }).getByRole('button', { name: '收藏', exact: true }))
    .toHaveAttribute('aria-pressed', 'true')
  await expect(row).toHaveCount(0)
})

test('a starred inbox has no horizontal scrolling at phone width', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(context, { admin: true })
  const box = await createMailbox(context.request)
  await deliver(context.request, box.address, mime({ to: box.address, subject: 'x'.repeat(200), text: 'y '.repeat(400) }))
  await page.goto('/inbox')
  const row = page.locator('.row')
  await expect(row).toHaveCount(1)
  const [starred] = await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'PATCH' && res.url().includes('/api/messages/')),
    row.getByRole('button', { name: '收藏', exact: true }).click(),
  ])
  expect(starred.status()).toBe(204)
  await page.reload()
  await expect(row.getByRole('button', { name: '取消收藏', exact: true })).toHaveAttribute('aria-pressed', 'true')
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
  expect(result.doc, '/inbox').toBeLessThanOrEqual(390)
  expect(result.over, '/inbox').toEqual([])
})
