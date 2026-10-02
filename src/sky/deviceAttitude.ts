import { Euler, Quaternion, Vector3 } from 'three'
import { OBSERVER } from './observer'

const DEG = Math.PI / 180

type CompassEvent = DeviceOrientationEvent & {
  /** iOS: degrees clockwise from magnetic north. */
  webkitCompassHeading?: number
  /** iOS: error in degrees, or -1 while the compass has no fix. */
  webkitCompassAccuracy?: number
}

type PermissionApi = { requestPermission?: () => Promise<PermissionState> }

export type AttitudeStart = 'ready' | 'denied' | 'insecure' | 'unavailable'

const ORIENTATION_EVENTS = ['deviceorientationabsolute', 'deviceorientation'] as const

/** Phones and tablets, whose motion sensors can steer the sky. */
export function canFollowDevice() {
  return typeof DeviceOrientationEvent !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
}

/** LAN http is not a secure context; the phone will refuse to share its compass. */
export function httpsUrlForSensors() {
  if (window.isSecureContext) return null
  return `https://${location.host}/`
}

const euler = new Euler()
const outOfTheBack = new Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2)
const screenTurn = new Quaternion()
const zAxis = new Vector3(0, 0, 1)

/**
 * Camera rotation in the sky's world frame (+x east, +y up, -z north) for W3C
 * orientation angles measured from north. The view looks out of the back of
 * the phone and stays upright however the screen is turned.
 */
export function attitudeFromAngles(alpha: number, beta: number, gamma: number, screenAngle: number, out = new Quaternion()) {
  euler.set(beta * DEG, alpha * DEG, -gamma * DEG, 'YXZ')
  return out.setFromEuler(euler).multiply(outOfTheBack).multiply(screenTurn.setFromAxisAngle(zAxis, -screenAngle * DEG))
}

const wrap180 = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180

/**
 * iOS pairs a compass heading with angles whose zero heading is arbitrary. The
 * compass follows the top edge while the phone lies flat and the camera once it
 * is raised, but which one it uses past upright is undocumented. So it is only
 * trusted where the two agree. Returns the heading (degrees clockwise, in the
 * arbitrary frame) the compass reading belongs to. `sure` is false for the
 * raised-camera guess, which only stands in until a trusted pose comes along.
 */
export function compassReference(alpha: number, beta: number, gamma: number) {
  const [sa, ca] = [Math.sin(alpha * DEG), Math.cos(alpha * DEG)]
  const [sb, cb] = [Math.sin(beta * DEG), Math.cos(beta * DEG)]
  const [sg, cg] = [Math.sin(gamma * DEG), Math.cos(gamma * DEG)]
  // Horizontal (east, north) parts of the top edge and of the camera's line of sight.
  const topE = -sa * cb
  const topN = ca * cb
  const backE = -ca * sg - sa * sb * cg
  const backN = -sa * sg + ca * sb * cg
  const top = Math.atan2(topE, topN) / DEG
  const back = Math.atan2(backE, backN) / DEG
  const backLength = Math.hypot(backE, backN)
  const topLength = Math.hypot(topE, topN)
  if (backLength < 0.35 && cb > 0.5) return { heading: top, sure: true }
  if (backLength > 0.35 && topLength > 0.35) {
    const gap = wrap180(back - top)
    if (Math.abs(gap) < 18) return { heading: top + gap / 2, sure: true }
  }
  if (backLength > 0.35) return { heading: back, sure: false }
  if (topLength > 0.25) return { heading: top, sure: false }
  return null
}

function screenAngle() {
  const legacy = (window as { orientation?: unknown }).orientation
  return typeof legacy === 'number' ? legacy : (screen.orientation?.angle ?? 0)
}

const scratch = new Quaternion()

/** Which way the phone's camera looks, from its motion sensors, against true north. */
export class DeviceAttitude {
  private attitude = new Quaternion()
  private ready = false
  /** iOS: degrees from the arbitrary zero of the angles to magnetic north. */
  private offset: number | null = null
  private offsetSure = false
  private previous = new Quaternion()
  private previousTime = 0
  private settle: ((ready: boolean) => void) | null = null
  private timer = 0
  /** Once an absolute event arrives, ignore relative ones so the two don't fight. */
  private haveAbsolute = false

  /** Asks for motion access, which iOS only allows during a tap, then waits for a reading tied to north. */
  async start(): Promise<AttitudeStart> {
    if (!window.isSecureContext) return 'insecure'
    const api = DeviceOrientationEvent as unknown as PermissionApi
    if (typeof api.requestPermission === 'function') {
      const state = await api.requestPermission().catch(() => 'denied')
      if (state !== 'granted') return 'denied'
    }
    for (const name of ORIENTATION_EVENTS) window.addEventListener(name, this.onOrientation)
    const ready = await new Promise<boolean>((resolve) => {
      this.settle = resolve
      this.timer = window.setTimeout(() => resolve(false), 8000)
    })
    if (!ready) this.stop()
    return ready ? 'ready' : 'unavailable'
  }

  stop() {
    for (const name of ORIENTATION_EVENTS) window.removeEventListener(name, this.onOrientation)
    window.clearTimeout(this.timer)
    this.settle?.(false)
    this.settle = null
  }

  read(out: Quaternion) {
    if (this.ready) out.copy(this.attitude)
    return this.ready
  }

  private onOrientation = (event: Event) => {
    const e = event as CompassEvent
    if (e.alpha === null || e.beta === null || e.gamma === null) return
    if (e.absolute) this.haveAbsolute = true
    else if (this.haveAbsolute) return
    let alpha = e.alpha
    if (!e.absolute) {
      this.calibrate(e, e.alpha, e.beta, e.gamma)
      if (this.offset === null) return
      alpha -= this.offset
    }
    attitudeFromAngles(alpha - OBSERVER.magneticDeclination, e.beta, e.gamma, screenAngle(), this.attitude)
    this.ready = true
    if (this.settle) {
      window.clearTimeout(this.timer)
      this.settle(true)
      this.settle = null
    }
  }

  private calibrate(e: CompassEvent, alpha: number, beta: number, gamma: number) {
    const raw = attitudeFromAngles(alpha, beta, gamma, 0, scratch)
    const seconds = Math.max(1, e.timeStamp - this.previousTime) / 1000
    const turnRate = raw.angleTo(this.previous) / DEG / seconds
    this.previous.copy(raw)
    this.previousTime = e.timeStamp

    const compass = e.webkitCompassHeading
    if (typeof compass !== 'number' || Number.isNaN(compass)) return
    // The compass lags behind quick turns.
    if (turnRate > 30 && this.offset !== null) return
    const reference = compassReference(alpha, beta, gamma)
    if (!reference || (this.offsetSure && !reference.sure)) return
    const sample = compass - reference.heading
    if (this.offset === null || (reference.sure && !this.offsetSure)) this.offset = sample
    else this.offset += wrap180(sample - this.offset) * 0.05
    this.offsetSure ||= reference.sure
  }
}

/** Keeps the screen awake while the phone is held up. Returns the release. */
export function keepScreenOn() {
  let lock: WakeLockSentinel | undefined
  let released = false
  navigator.wakeLock?.request('screen').then(
    (sentinel) => {
      if (released) sentinel.release().catch(() => {})
      else lock = sentinel
    },
    () => {},
  )
  return () => {
    released = true
    lock?.release().catch(() => {})
  }
}
