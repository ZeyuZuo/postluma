/** Personal mode (SERVICE_MODE=personal): one administrator, no sign-up, no user management. */
import { expect, test } from '@playwright/test'

import { PASSWORD, createAccount, signIn } from './helpers'

test('the login page offers no sign-up, and /register leads back to it', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible()
  await expect(page.locator('a[href="/register"]')).toHaveCount(0)
  await expect(page.locator('.tagline')).toHaveText('你自己的邮箱，部署在 Cloudflare 上')
  await page.goto('/register')
  await expect(page).toHaveURL(/\/login$/)
})

test('the admin panel has no users tab and no sign-up settings', async ({ page, context }) => {
  await signIn(context, { admin: true })
  await page.goto('/admin')
  await expect(page.locator('.n-tabs-tab')).toHaveText(['收信域名', '系统设置', '统计', '操作记录'])
  await expect(page.locator('.n-tabs-tab--active')).toHaveText('收信域名')
  await page.locator('.n-tabs-tab[data-name="settings"]').click()
  await expect(page.getByText('邮件保留天数')).toBeVisible()
  await expect(page.getByText('开放注册')).toHaveCount(0)
  await expect(page.getByText('默认地址配额')).toHaveCount(0)
})

test('an account that is not an administrator is told who can sign in', async ({ page }) => {
  const username = await createAccount({ admin: false })
  await page.goto('/login')
  await page.locator('input[autocomplete="username"]').fill(username)
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByText('这个站点是个人邮箱，只有管理员能登录。')).toBeVisible()
})
