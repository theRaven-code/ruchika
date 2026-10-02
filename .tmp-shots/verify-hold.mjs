import { openPhone, sleep } from './cdp.mjs'

const page = await openPhone()
await sleep(9000)

const landing = await page.evaluate(`({
  hold: document.querySelector('.sky-intro__hold')?.innerText ?? null,
  holdWidth: document.querySelector('.sky-intro__hold')?.getBoundingClientRect().width ?? null,
  holdHeight: document.querySelector('.sky-intro__hold')?.getBoundingClientRect().height ?? null,
  focus: document.querySelector('.sky-intro__focus')?.innerText ?? null,
  explore: document.querySelector('.sky-intro__explore')?.innerText ?? null,
})`)
console.log('landing', landing)
await page.shot(new URL('./hold-landing.png', import.meta.url).pathname)

await page.evaluate(`document.querySelector('.sky-intro__hold').click()`)
await page.evaluate(`
  const fire = () => {
    window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', {
      alpha: 200, beta: 45, gamma: 0, absolute: true,
    }))
  }
  fire()
  window.__holdFire = setInterval(fire, 80)
`)
await sleep(2500)
const pointing = await page.evaluate(`document.querySelector('.sky-pointing')?.innerText ?? null`)
console.log('pointing', pointing)
await page.shot(new URL('./hold-pointing.png', import.meta.url).pathname)

await page.evaluate(`document.querySelector('.sky-pointing button')?.click()`)
await sleep(900)
const back = await page.evaluate(`({
  hold: document.querySelector('.sky-intro__hold')?.innerText ?? null,
  opacity: getComputedStyle(document.querySelector('.sky-intro') ?? document.body).opacity,
})`)
console.log('back', back)
await page.shot(new URL('./hold-back.png', import.meta.url).pathname)
await page.evaluate(`clearInterval(window.__holdFire)`)

await page.close()

const desktop = await openPhone({ width: 1280, height: 800, port: 9334 })
await desktop.send('Emulation.setDeviceMetricsOverride', {
  width: 1280,
  height: 800,
  deviceScaleFactor: 1,
  mobile: false,
})
await desktop.send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 0 })
await desktop.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'fine' }] })
await sleep(6000)
const desk = await desktop.evaluate(`({
  coarse: matchMedia('(pointer: coarse)').matches,
  hold: !!document.querySelector('.sky-intro__hold'),
  hint: document.querySelector('.sky-intro__hint')?.textContent ?? null,
  introClass: document.querySelector('.sky-intro')?.className ?? null,
})`)
console.log('desktop', desk)
await desktop.shot(new URL('./hold-desktop.png', import.meta.url).pathname)
await desktop.close()
