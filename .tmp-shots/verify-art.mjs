import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sleep } from './cdp.mjs'

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const port = 9340
const profile = mkdtempSync(join(tmpdir(), 'sky-art-'))
const chrome = spawn(chromePath, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--hide-scrollbars',
  '--ignore-certificate-errors',
  '--no-first-run',
  '--window-size=1280,800',
  'about:blank',
])

let wsUrl
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200)
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl
  } catch {}
}
if (!wsUrl) throw new Error('no page')

const ws = new WebSocket(wsUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
const logs = []
const requests = []
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    logs.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
  } else if (msg.method === 'Runtime.exceptionThrown') {
    logs.push('EXCEPTION ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text))
  } else if (msg.method === 'Network.responseReceived') {
    const url = msg.params.response.url
    if (url.includes('/sky/art/')) requests.push({ url, status: msg.params.response.status })
  }
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const msgId = ++id
    pending.set(msgId, { resolve, reject })
    ws.send(JSON.stringify({ id: msgId, method, params }))
  })

await send('Runtime.enable')
await send('Network.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: 'https://localhost:5174/' })
await sleep(8000)

const before = await send('Runtime.evaluate', {
  expression: `({
    artBtn: !!document.querySelector('button[title="Constellation Art"]'),
    explore: !!document.querySelector('.sky-intro__explore'),
  })`,
  returnByValue: true,
})
console.log('before', before.result.value)

await send('Runtime.evaluate', {
  expression: `document.querySelector('.sky-intro__explore')?.click()`,
  userGesture: true,
})
await sleep(400)
await send('Runtime.evaluate', {
  expression: `{
    document.querySelector('button[title="Constellation Art"]')?.click()
    document.querySelector('button[title="Constellations"]')?.click()
  }`,
  userGesture: true,
})
await sleep(2500)

const after = await send('Runtime.evaluate', {
  expression: `({
    pressed: document.querySelector('button[title="Constellation Art"]')?.getAttribute('aria-pressed'),
  })`,
  returnByValue: true,
})
console.log('after', after.result.value)
console.log('art requests', requests.length, requests.slice(0, 5))
console.log('logs', logs.join('\n'))

const { data } = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(new URL('./art-toggle.png', import.meta.url).pathname, Buffer.from(data, 'base64'))

ws.close()
chrome.kill('SIGKILL')
