import { openPhone, sleep } from './cdp.mjs'

const page = await openPhone()
await sleep(22000)
await page.shot(new URL('./baseline.png', import.meta.url).pathname)
console.log(await page.evaluate(`JSON.stringify({ coarse: matchMedia('(pointer: coarse)').matches, abs: 'ondeviceorientationabsolute' in window, secure: isSecureContext })`))
console.log(page.logs.join('\n'))
await page.close()
