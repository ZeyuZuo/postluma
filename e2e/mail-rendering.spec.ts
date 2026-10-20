/**
 * Hostile HTML mail: nothing may run, and nothing may reach the network until the user loads
 * images — and then only images. Vectors follow common tracker/XSS tricks (srcset, CSS url(),
 * @import, image-set, CSS escapes, <base>, meta refresh, fonts, embeds, forms, javascript: links).
 */
import { expect, test } from '@playwright/test'

import { createMailbox, deliver, mime, signIn } from './helpers'

const T = 'https://tracker.invalid'
const HOSTILE = `
<style>@import "${T}/import";</style>
<style>.set{background-image:image-set("${T}/imageset" 1x)} @font-face{font-family:trk;src:url(${T}/font)}</style>
<link rel="stylesheet" href="${T}/link">
<meta http-equiv="refresh" content="0;url=${T}/refresh">
<base href="${T}/base/">
<p id="marker">hostile-mail-rendered</p>
<script>parent.__pwned = 'script'</script>
<img src="x" onerror="parent.__pwned = 'onerror'">
<a id="js" href="javascript:parent.__pwned='link'">js link</a>
<a id="good" href="https://example.org/ok">good link</a>
<form id="form" action="${T}/form"><input name="a"><button>go</button></form>
<iframe src="${T}/iframe"></iframe>
<iframe srcdoc="&lt;img src=${T}/srcdoc&gt;"></iframe>
<svg onload="parent.__pwned = 'svg'"><image href="${T}/svgimage"></image></svg>
<object data="${T}/object"></object>
<video poster="${T}/poster"></video>
<input type="image" src="${T}/inputimage">
<img id="remote" src="${T}/img">
<img srcset="${T}/srcset 1x">
<picture><source srcset="${T}/picture"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></picture>
<table background="${T}/background"><tr><td>t</td></tr></table>
<div style="background:url(${T}/cssurl)">css</div>
<div style="background:u\\72l(${T}/escaped)">escaped</div>
<div class="set">set</div>
<p style="font-family:trk">font</p>
<img src="relative.png">
`

/** Requests that must never happen, even after "load images" (only images are allowed then). */
const NEVER = ['import', 'link', 'refresh', 'base', 'form', 'iframe', 'srcdoc', 'object', 'font', 'svgimage']

test('hostile HTML runs nothing and loads nothing until images are allowed', async ({ page, context }) => {
  await signIn(context)
  const box = await createMailbox(context.request)
  await deliver(context.request, box.address, mime({ to: box.address, subject: 'Hostile mail', html: HOSTILE }))

  const hits: string[] = []
  await context.route(`${T}/**`, (route) => {
    hits.push(new URL(route.request().url()).pathname.slice(1))
    return route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') })
  })
  const dialogs: string[] = []
  page.on('dialog', (d) => {
    dialogs.push(d.message())
    void d.dismiss()
  })

  await page.goto('/inbox')
  await page.getByText('Hostile mail').first().click()
  const frame = page.frameLocator('iframe[title="Hostile mail"]')
  await expect(frame.locator('#marker')).toHaveText('hostile-mail-rendered')
  await page.waitForTimeout(1500)

  expect(hits, 'no request before "load images"').toEqual([])
  expect(await page.evaluate(() => (window as unknown as { __pwned?: string }).__pwned)).toBeUndefined()
  expect(dialogs).toEqual([])
  await expect(frame.locator('#js')).not.toHaveAttribute('href', /.*/)
  await expect(frame.locator('form, iframe, svg, object, video, input, script')).toHaveCount(0)
  await expect(frame.locator('#good')).toHaveAttribute('target', '_blank')
  await expect(frame.locator('#good')).toHaveAttribute('rel', /noopener/)

  await page.getByRole('button', { name: '加载图片' }).click()
  await expect.poll(() => hits).toContain('img')
  await page.waitForTimeout(1000)
  expect(hits.filter((h) => NEVER.includes(h)), 'only images after "load images"').toEqual([])
  expect(await page.evaluate(() => (window as unknown as { __pwned?: string }).__pwned)).toBeUndefined()
})
