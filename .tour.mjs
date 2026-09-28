import { chromium } from '@playwright/test'
const out = process.argv[2]
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const p = await ctx.newPage()
p.on('pageerror', e => console.log('PAGEERROR', e.message))
await p.goto('http://localhost:3100/admin/login', { waitUntil: 'networkidle' })
await p.locator('input[type=email]').fill('admin@local.test')
await p.locator('input[type=password]').fill('localpass123')
await p.locator('button[type=submit]').click()
await p.waitForLoadState('networkidle')
await p.waitForTimeout(1500)
console.log('after login:', p.url())
const shots = process.argv.slice(3)
for (const s of shots) {
  const [name, path] = s.split('=')
  await p.goto('http://localhost:3100' + path, { waitUntil: 'networkidle' })
  await p.waitForTimeout(800)
  await p.screenshot({ path: `${out}/${name}.png` })
  console.log(name, '->', p.url())
}
await b.close()
