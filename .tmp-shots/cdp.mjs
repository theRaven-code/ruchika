// Temporary helper: drives headless Chrome over CDP to screenshot the sky at phone size.
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

export async function openPhone({ url = 'http://localhost:5173/', width = 390, height = 844, port = 9333 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'sky-shot-'))
  const chrome = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    '--no-first-run',
    `--window-size=${width},${height}`,
    'about:blank',
  ])
  chrome.stderr.on('data', () => {})

  let wsUrl
  for (let i = 0; i < 50 && !wsUrl; i++) {
    await sleep(200)
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl
    } catch {}
  }
  if (!wsUrl) throw new Error('no page target')

  const ws = new WebSocket(wsUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  let id = 0
  const pending = new Map()
  const logs = []
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
    } else if (msg.method === 'Runtime.exceptionThrown') {
      logs.push('EXCEPTION ' + JSON.stringify(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text))
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id
      pending.set(msgId, { resolve, reject })
      ws.send(JSON.stringify({ id: msgId, method, params }))
    })

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true })
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await send('Page.navigate', { url })

  return {
    send,
    logs,
    async evaluate(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
      return r.result.value
    },
    async shot(file) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(file, Buffer.from(data, 'base64'))
    },
    async close() {
      ws.close()
      chrome.kill('SIGKILL')
    },
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
