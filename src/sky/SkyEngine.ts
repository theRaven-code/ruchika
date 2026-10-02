import {
  Group,
  Matrix3,
  Matrix4,
  PerspectiveCamera,
  Quaternion,
  Scene,
  ShaderMaterial,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
  type IUniform,
  type Mesh,
} from 'three'
import {
  azAltToWorld,
  celestialToWorld,
  computeBodies,
  createObserver,
  limitingMagnitude,
  smoothstep,
  worldToAzAlt,
  type BodyId,
  type BodyState,
  type Observer,
} from './astro'
import type { SkyData } from './data'
import { skyAsset } from './data'
import { LabelLayer, type Label } from './labels'
import { createBackground } from './layers/background'
import { createBodies } from './layers/bodies'
import { createConstellations, type ConstellationLabel } from './layers/constellations'
import { createAzimuthalGrid, createEquatorialGrid } from './layers/grids'
import { drawCelestialVerses, versePreludeSeconds } from './celestialVerses'
import { drawSkyQuote, shuffledQuoteOrder, SKY_QUOTES } from './skyQuotes'
import { CountdownRenderer, type CountdownPart } from './countdownRenderer'
import { createLandscape } from './layers/landscape'
import { createMeteors } from './layers/meteors'
import { createNameConstellation, framePoint, type SkyFrame } from './layers/nameConstellation'
import { createStars } from './layers/stars'
import { GLYPH_HEIGHT, layoutName } from './nameGlyphs'
import { presetTime, type TimePreset } from './time'

export type LayerKey =
  | 'name'
  | 'constellations'
  | 'art'
  | 'azimuthal'
  | 'equatorial'
  | 'atmosphere'
  | 'landscape'
  | 'milkyway'
  | 'labels'

export type LayerState = Record<LayerKey, boolean>

export type Selection = {
  name: string
  kind: string
  mag: number
  az: number
  alt: number
  ra: number
  dec: number
}

export type PointingStatus = 'waiting' | 'searching' | 'found' | 'hidden'

/** The phone held up to the sky, and where the name is in it. */
export type PointingInfo = {
  status: PointingStatus
  /** Where the centre of the name is right now. */
  az: number
  alt: number
  /** When and where the name next clears the skyline, while it is hidden. */
  rises: { time: Date; az: number } | null
  /** The Sun is up, so the daylight is lifted to show the stars. */
  daylight: boolean
}

/** Reports the camera rotation that matches the way the phone is pointing. */
export type AttitudeSource = { read(out: Quaternion): boolean }

export type SkyInfo = {
  time: Date
  speed: number
  az: number
  alt: number
  fov: number
  sunAlt: number
  selection: Selection | null
  /** Whether the name constellation is on screen and above the ridges. */
  nameVisible: boolean
  pointing: PointingInfo | null
}

/** A name written in stars, with a countdown hanging underneath it. */
export type Dedication = {
  name: string
  caption: string
  /** Countdown units, or null once the day itself has arrived. */
  countdown: () => CountdownPart[] | null
  celebration: { title: string; caption: string }
  /** Lines written into the landing sky, above the name. */
  verses: string[]
}

type Flight = {
  start: number
  duration: number
  from: Vector3
  to: Vector3
  fovFrom: number
  fovTo: number
  /** Extra field of view at mid-flight, for a gentle pull-back. */
  swell: number
  onDone?: () => void
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

const DEG = Math.PI / 180
const MIN_FOV = 2
const MAX_FOV = 150
const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const BODY_NAMES: Record<BodyId, string> = {
  Sun: 'Sun',
  Moon: 'Moon',
  Mercury: 'Mercury',
  Venus: 'Venus',
  Mars: 'Mars',
  Jupiter: 'Jupiter',
  Saturn: 'Saturn',
}

type SelectionTarget = { kind: 'star'; index: number } | { kind: 'body'; id: BodyId }

export class SkyEngine {
  onInfo?: (info: SkyInfo) => void

  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera()
  private celestial = new Group()
  private labelLayer: LabelLayer
  private observer: Observer
  private toWorld = new Matrix4()
  private toWorld3 = new Matrix3()
  private viewRot = new Matrix3()

  private shared = {
    uProjScale: { value: 1 },
    uAspect: { value: 1 },
    uViewport: { value: new Vector2(1, 1) },
    uCamRot: { value: new Matrix3() },
    uSunDir: { value: new Vector3(0, -1, 0) },
    uMoonDir: { value: new Vector3(0, -1, 0) },
    uMoonLight: { value: 0 },
    uExposure: { value: 1 },
    uPixelRatio: { value: 1 },
    uTime: { value: 0 },
    uTwinkle: { value: 1 },
    uExtinction: { value: 1 },
    uLimMag: { value: 6 },
    uSizeScale: { value: 1 },
  } satisfies Record<string, IUniform>

  private background: ReturnType<typeof createBackground>
  private stars: ReturnType<typeof createStars>
  private constellations: ReturnType<typeof createConstellations>
  private azGrid: ReturnType<typeof createAzimuthalGrid>
  private eqGrid: ReturnType<typeof createEquatorialGrid>
  private bodies: ReturnType<typeof createBodies>
  private landscape: ReturnType<typeof createLandscape>
  private lineMeshes: ReturnType<typeof createAzimuthalGrid>[]
  private starIndexByHip = new Map<number, number>()
  private namedStars: { index: number; name: string }[] = []
  private starConstellation = new Map<number, string>()

  private layers: LayerState = {
    name: true,
    constellations: true,
    art: false,
    azimuthal: false,
    equatorial: false,
    atmosphere: true,
    landscape: true,
    milkyway: true,
    labels: true,
  }

  private yaw = 200 * DEG
  private pitch = 32 * DEG
  private fov = 100
  private velocity = { yaw: 0, pitch: 0 }
  private pointers = new Map<number, { x: number; y: number }>()
  private pinchDistance = 0
  private dragDistance = 0
  private lastMove = 0

  private simTime = Date.now()
  private speed = 1
  private lastFrame = performance.now()
  private lastInfo = 0
  private frameId = 0
  private width = 1
  private height = 1
  private pixelRatio = 1
  private bodyStates: BodyState[] = []
  private overlayFade = 1
  private selection: SelectionTarget | null = null
  private resizeObserver: ResizeObserver
  private exploring = false
  private dedication: Dedication | null = null
  private nameLayers: ReturnType<typeof createNameConstellation>[] = []
  private nameWeights = [1, 0]
  private nameFrame: SkyFrame | null = null
  private nameRevealStart = 0
  private versesSkipped = false
  private nameDelay = 0
  private pendingFocus: { at: number; az: number; alt: number; fov: number; duration: number } | null = null
  private focusTarget: { az: number; alt: number; fov: number } | null = null
  private quoteOrder = shuffledQuoteOrder(SKY_QUOTES.length)
  private nameBurstStart = -Infinity
  private nameVisible = false
  private flight: Flight | null = null
  private meteors = createMeteors()
  private nextMeteorAt = 0
  private meteorQueue: { at: number; near?: Vector3; bright?: boolean }[] = []
  private darkness = 1
  private countdownRenderer = new CountdownRenderer()
  private maxPointSize = 64
  private pointing: {
    source: AttitudeSource
    /** The view when the phone took over; the camera glides away from it. */
    from: Quaternion
    reading: Quaternion
    /** The reading with sensor jitter smoothed out. */
    view: Quaternion
    /** When the first reading arrived. */
    start: number
    status: PointingStatus
    celebratedAt: number
    rises: { time: Date; az: number } | null
  } | null = null
  private daylightLift = 0
  private groundOpacity = 1

  constructor(
    private container: HTMLElement,
    private data: SkyData,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setClearColor(0x000000, 1)
    this.renderer.domElement.className = 'sky-canvas'
    container.appendChild(this.renderer.domElement)
    this.labelLayer = new LabelLayer(container)

    const ground = data.horizon.observer.ground + data.horizon.observer.eyeHeight
    this.observer = createObserver(ground)

    const loader = new TextureLoader()
    const milkyWay = loader.load(skyAsset('milkyway.jpg'))
    milkyWay.generateMipmaps = false
    const moonMap = loader.load(skyAsset('moon.jpg'))

    const { stars } = data
    for (let i = 0; i < stars.count; i++) if (stars.hip[i]) this.starIndexByHip.set(stars.hip[i], i)
    for (const [hip, name] of Object.entries(data.starNames)) {
      const index = this.starIndexByHip.get(Number(hip))
      if (index !== undefined) this.namedStars.push({ index, name })
    }
    this.namedStars.sort((a, b) => stars.mag[a.index] - stars.mag[b.index])
    for (const c of data.constellations) {
      c.lines.flat().forEach((hip) => this.starConstellation.set(hip, c.name))
    }

    this.background = createBackground(milkyWay)
    this.stars = createStars(stars)
    this.constellations = createConstellations(
      data.constellations,
      (hip) => this.starVector(hip),
      { uProjScale: this.shared.uProjScale, uAspect: this.shared.uAspect },
    )
    this.azGrid = createAzimuthalGrid()
    this.eqGrid = createEquatorialGrid()
    this.bodies = createBodies(moonMap, this.shared)
    this.landscape = createLandscape(data.horizon)
    this.lineMeshes = [this.azGrid, this.eqGrid, this.constellations.lines]

    this.celestial.matrixAutoUpdate = false
    this.celestial.add(
      this.stars.points,
      this.eqGrid.mesh,
      this.constellations.lines.mesh,
      this.constellations.art,
      this.bodies.planets,
    )
    this.scene.add(
      this.background.mesh,
      this.celestial,
      this.azGrid.mesh,
      this.bodies.sun.mesh,
      this.bodies.moon.mesh,
      this.meteors.mesh,
      this.landscape.mesh,
    )
    const gl = this.renderer.getContext()
    this.maxPointSize = (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array)[1] ?? 64
    this.shareUniforms()
    this.setLayers(this.layers)

    const canvas = this.renderer.domElement
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('keydown', this.onKeyDown)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
    this.frameId = requestAnimationFrame(this.frame)
  }

  // ----- public API -------------------------------------------------------

  /** Explore mode enables picking, cardinal points and planet labels. */
  setExploring(exploring: boolean) {
    this.exploring = exploring
    if (exploring) this.skipVerses()
    if (!exploring) this.selection = null
    this.emitInfo(true)
  }

  setDedication(dedication: Dedication | null) {
    this.dedication = dedication
  }

  /**
   * Writes the name above the view (az, alt, fov) and glides the camera there,
   * optionally starting from a lower, wider pose for an opening shot.
   */
  presentName(az: number, alt: number, fov: number, from?: { az: number; alt: number; fov: number }) {
    if (from) this.lookAt(from.az, from.alt, from.fov)
    this.placeName(az, alt + 9, fov)
    const count = this.dedication?.verses.length ?? 0
    const prelude = Math.max(1, versePreludeSeconds(count))
    this.nameDelay = prelude
    this.focusTarget = { az, alt, fov }
    this.pendingFocus = null
    // The sky turns the whole time the lines are read, and arrives as they end.
    this.flyTo(az, alt, fov, { duration: prelude * 1000, swell: 10 })
    this.nextMeteorAt = this.nameRevealStart + prelude * 1000
  }

  /** Swoops to the name, then sends a wave of light and a few meteors through it. */
  focusName(fov = this.fov) {
    this.skipVerses(false)
    if (!this.nameFrame) return
    celestialToWorld(new Date(this.simTime), this.observer, this.toWorld)
    const world = framePoint(this.nameFrame, 0, 0).applyMatrix4(this.toWorld)
    const { az, alt } = worldToAzAlt(world)
    this.flyTo(az, alt - 9, fov, { onDone: () => this.celebrateName() })
  }

  /**
   * Hands the camera to the phone: the sky jumps to the real time and turns to
   * wherever the back of the phone points, so the name is where it truly is.
   */
  followDevice(source: AttitudeSource, fov = this.fov) {
    this.skipVerses(false)
    this.applyPreset('now')
    this.selection = null
    this.flight = null
    this.pendingFocus = null
    this.velocity = { yaw: 0, pitch: 0 }
    this.fov = Math.min(MAX_FOV, Math.max(MIN_FOV, fov))
    this.pointing = {
      source,
      from: this.camera.quaternion.clone(),
      reading: new Quaternion(),
      view: new Quaternion(),
      start: -1,
      status: 'waiting',
      celebratedAt: -Infinity,
      rises: null,
    }
    this.emitInfo(true)
  }

  stopFollowingDevice() {
    this.pointing = null
    this.groundOpacity = 1
    this.landscape.uniforms.uOpacity.value = 1
    this.emitInfo(true)
  }

  /** Smoothly turns the camera, pulling back slightly mid-flight. */
  flyTo(az: number, alt: number, fov: number, options: { duration?: number; swell?: number; onDone?: () => void } = {}) {
    const from = azAltToWorld(this.yaw / DEG, this.pitch / DEG)
    const to = azAltToWorld(az, alt)
    const angle = from.angleTo(to) / DEG
    this.velocity = { yaw: 0, pitch: 0 }
    this.flight = {
      start: performance.now(),
      duration: options.duration ?? Math.min(2600, Math.max(1300, 900 + angle * 14)),
      from,
      to,
      fovFrom: this.fov,
      fovTo: Math.min(MAX_FOV, Math.max(MIN_FOV, fov)),
      swell: options.swell ?? Math.min(24, angle * 0.3 + 6),
      onDone: options.onDone,
    }
  }

  /**
   * Writes the name centred on (az, alt), upright at the current time, sized
   * for `fov`, and replays the trace-in animation. The figure is fixed to the
   * stars afterwards, so it rises and sets like a constellation.
   */
  private placeName(az: number, alt: number, fov: number) {
    for (const layer of this.nameLayers) {
      this.celestial.remove(layer.stars, layer.lines.mesh)
      layer.stars.geometry.dispose()
      layer.lines.mesh.geometry.dispose()
      ;(layer.stars.material as ShaderMaterial).dispose()
      ;(layer.lines.mesh.material as ShaderMaterial).dispose()
    }
    this.nameLayers = []
    if (!this.dedication) return

    celestialToWorld(new Date(this.simTime), this.observer, this.toWorld)
    const toEqj = new Matrix3().setFromMatrix4(this.toWorld).transpose()
    const centerWorld = azAltToWorld(az, alt)
    const zenith = new Vector3(0, 1, 0)
    const upWorld = zenith.addScaledVector(centerWorld, -centerWorld.y).normalize()
    const rightWorld = new Vector3().crossVectors(centerWorld, upWorld)

    // Fit the name to ~62% of the visible width, but never larger than 62°.
    const hFov = 4 * Math.atan((this.width / this.height) * Math.tan((fov * DEG) / 4))
    const width = Math.min(62 * DEG, 0.62 * hFov)
    this.nameFrame = {
      center: centerWorld.applyMatrix3(toEqj),
      up: upWorld.applyMatrix3(toEqj),
      right: rightWorld.applyMatrix3(toEqj),
      unit: width / Math.max(1, layoutName(this.dedication.name).width),
    }
    // Same letter height and the same patch of sky. Marathi and Tamil are
    // naturally a little narrower than the English star-letters.
    this.nameLayers = [this.dedication.name, 'ΡΟΥΧΙΚΑ'].map((script) =>
      createNameConstellation(script, this.nameFrame!),
    )
    for (const layer of this.nameLayers) {
      layer.stars.visible = this.layers.name
      layer.lines.mesh.visible = this.layers.name
      layer.starUniforms.uMaxPointSize.value = this.maxPointSize
      this.celestial.add(layer.stars, layer.lines.mesh)
    }
    this.nameWeights = [1, 0]
    this.shareUniforms()
    this.nameRevealStart = performance.now()
    this.nameBurstStart = -Infinity
    this.versesSkipped = false
  }

  /** Drops the lines and the waiting camera move. Optionally turns toward the name. */
  skipVerses(turnToName = true) {
    this.versesSkipped = true
    this.nameDelay = 0
    const pending = this.pendingFocus
    this.pendingFocus = null
    const target = pending ?? this.focusTarget
    if (turnToName && target) this.flyTo(target.az, target.alt, target.fov, { duration: 1800 })
  }

  /** Seconds since the name was allowed to appear. Negative while the lines still play. */
  private nameClock() {
    const elapsed = (performance.now() - this.nameRevealStart) / 1000
    return elapsed - (this.versesSkipped || this.exploring ? 0 : this.nameDelay)
  }

  setLayers(layers: LayerState) {
    this.layers = { ...layers }
    for (const layer of this.nameLayers) {
      layer.stars.visible = layers.name
      layer.lines.mesh.visible = layers.name
    }
    this.constellations.lines.mesh.visible = layers.constellations
    this.constellations.art.visible = layers.art
    if (layers.art) this.constellations.loadArt()
    this.azGrid.mesh.visible = layers.azimuthal
    this.eqGrid.mesh.visible = layers.equatorial
    this.landscape.mesh.visible = layers.landscape
  }

  setTime(date: Date) {
    this.simTime = date.getTime()
    this.emitInfo(true)
  }

  setSpeed(speed: number) {
    this.speed = speed
    this.emitInfo(true)
  }

  applyPreset(preset: TimePreset | 'now') {
    if (preset === 'now') {
      this.simTime = Date.now()
      this.speed = 1
    } else {
      this.simTime = presetTime(preset, new Date(this.simTime), this.observer, this.landscape.ridgeAltitude).getTime()
      this.speed = 0
    }
    this.emitInfo(true)
    return new Date(this.simTime)
  }

  lookAt(azDeg: number, altDeg: number, fov = this.fov) {
    this.yaw = azDeg * DEG
    this.pitch = altDeg * DEG
    this.fov = Math.min(MAX_FOV, Math.max(MIN_FOV, fov))
    this.velocity = { yaw: 0, pitch: 0 }
    this.flight = null
  }

  /** Faces the Sun's azimuth during twilight and daytime, otherwise the southern sky. */
  lookAtSky(fov = 110) {
    const sun = this.bodyStates.find((b) => b.id === 'Sun')
    if (sun && sun.world.y > Math.sin(-20 * DEG)) {
      const { az } = worldToAzAlt(sun.world)
      this.lookAt(az, 32, fov)
    } else {
      this.lookAt(205, 38, fov)
    }
  }

  zoom(factor: number) {
    this.flight = null
    this.fov = Math.min(MAX_FOV, Math.max(MIN_FOV, this.fov * factor))
  }

  clearSelection() {
    this.selection = null
    this.emitInfo(true)
  }

  dispose() {
    cancelAnimationFrame(this.frameId)
    this.resizeObserver.disconnect()
    const canvas = this.renderer.domElement
    canvas.removeEventListener('pointerdown', this.onPointerDown)
    canvas.removeEventListener('pointermove', this.onPointerMove)
    canvas.removeEventListener('pointerup', this.onPointerUp)
    canvas.removeEventListener('pointercancel', this.onPointerUp)
    canvas.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('keydown', this.onKeyDown)
    this.scene.traverse((object) => {
      const mesh = object as Mesh
      mesh.geometry?.dispose()
      const material = mesh.material as ShaderMaterial | undefined
      if (!material) return
      for (const uniform of Object.values(material.uniforms ?? {})) {
        if (uniform.value instanceof Texture) uniform.value.dispose()
      }
      material.dispose()
    })
    this.renderer.dispose()
    canvas.remove()
    this.labelLayer.dispose()
  }

  // ----- setup helpers ----------------------------------------------------

  private starVector(hip: number) {
    const i = this.starIndexByHip.get(hip)
    if (i === undefined) return null
    const p = this.stars.positions
    return new Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2])
  }

  /** Points every material at the engine-wide uniform objects. */
  private shareUniforms() {
    this.scene.traverse((object) => {
      const material = (object as Mesh).material as ShaderMaterial | undefined
      if (!material?.uniforms) return
      const shared: Record<string, IUniform> = this.shared
      for (const key of Object.keys(shared)) {
        if (key in material.uniforms) material.uniforms[key] = shared[key]
      }
    })
  }

  private resize() {
    const rect = this.container.getBoundingClientRect()
    this.width = Math.max(1, rect.width)
    this.height = Math.max(1, rect.height)
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    this.renderer.setPixelRatio(this.pixelRatio)
    this.renderer.setSize(this.width, this.height)
    this.labelLayer.resize(this.width, this.height, this.pixelRatio)
    this.shared.uAspect.value = this.width / this.height
    this.shared.uViewport.value.set(this.width * this.pixelRatio, this.height * this.pixelRatio)
    this.shared.uPixelRatio.value = this.pixelRatio
  }

  // ----- input ------------------------------------------------------------

  private radiansPerPixel() {
    return 4 / (this.shared.uProjScale.value * this.height)
  }

  private onPointerDown = (e: PointerEvent) => {
    this.flight = null
    this.renderer.domElement.setPointerCapture(e.pointerId)
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    this.velocity = { yaw: 0, pitch: 0 }
    this.dragDistance = 0
    this.lastMove = performance.now()
    if (this.pointers.size === 2) this.pinchDistance = this.pointerSpread()
  }

  private onPointerMove = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId)
    if (!prev) return
    const dx = e.clientX - prev.x
    const dy = e.clientY - prev.y
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    this.dragDistance += Math.hypot(dx, dy)

    if (this.pointers.size === 2) {
      const spread = this.pointerSpread()
      if (this.pinchDistance > 0) this.zoom(this.pinchDistance / spread)
      this.pinchDistance = spread
      return
    }
    if (this.pointing) return
    const now = performance.now()
    const dt = Math.max(1, now - this.lastMove)
    this.lastMove = now
    const k = this.radiansPerPixel()
    this.yaw -= dx * k
    this.pitch = Math.max(-89.5 * DEG, Math.min(89.5 * DEG, this.pitch + dy * k))
    this.velocity = { yaw: (-dx * k) / dt, pitch: (dy * k) / dt }
  }

  private onPointerUp = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId)
    const wasPinch = this.pointers.size > 1 || this.pinchDistance > 0
    this.pointers.delete(e.pointerId)
    if (this.pointers.size < 2) this.pinchDistance = 0
    if (performance.now() - this.lastMove > 80) this.velocity = { yaw: 0, pitch: 0 }
    const tapThreshold = e.pointerType === 'touch' ? 8 : 4
    if (this.exploring && p && !wasPinch && this.dragDistance < tapThreshold) {
      const rect = this.renderer.domElement.getBoundingClientRect()
      this.pick(p.x - rect.left, p.y - rect.top)
    }
  }

  private pointerSpread() {
    const [a, b] = [...this.pointers.values()]
    return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    this.flight = null
    const scale = e.deltaMode === 1 ? 16 : 1
    const dx = e.deltaX * scale
    const dy = e.deltaY * scale
    if (!e.ctrlKey && Math.abs(dx) > Math.abs(dy)) {
      if (!this.pointing) this.yaw += dx * this.radiansPerPixel()
      return
    }
    this.zoom(Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0015)))
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null
    if (this.pointing || (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
    const step = this.fov * DEG * 0.06
    if (e.key === 'ArrowLeft') this.yaw -= step
    else if (e.key === 'ArrowRight') this.yaw += step
    else if (e.key === 'ArrowUp') this.pitch = Math.min(89.5 * DEG, this.pitch + step)
    else if (e.key === 'ArrowDown') this.pitch = Math.max(-89.5 * DEG, this.pitch - step)
    else if (e.key === '+' || e.key === '=') this.zoom(0.85)
    else if (e.key === '-' || e.key === '_') this.zoom(1 / 0.85)
    else return
    this.flight = null
    e.preventDefault()
  }

  // ----- projection -------------------------------------------------------

  private project(world: Vector3, out: Vector2) {
    const v = this.tmp.copy(world).applyMatrix3(this.viewRot)
    const len = v.length()
    const dz = v.z / len
    if (dz > 0.4) return false
    const k = this.shared.uProjScale.value / (1 - dz)
    out.set(
      ((v.x / len) * k / this.shared.uAspect.value + 1) * 0.5 * this.width,
      (1 - (v.y / len) * k) * 0.5 * this.height,
    )
    return out.x > -60 && out.x < this.width + 60 && out.y > -30 && out.y < this.height + 30
  }

  private tmp = new Vector3()
  private tmp2 = new Vector3()
  private screen = new Vector2()
  private tmpScreen = new Vector2()

  private hiddenByLandscape(world: Vector3) {
    if (!this.layers.landscape) return false
    const { az, alt } = worldToAzAlt(world)
    return alt < this.landscape.ridgeAltitude(az) + 0.2
  }

  private starWorld(index: number, out: Vector3) {
    const p = this.stars.positions
    return out.set(p[index * 3], p[index * 3 + 1], p[index * 3 + 2]).applyMatrix3(this.toWorld3)
  }

  private pick(x: number, y: number) {
    let best: SelectionTarget | null = null
    let bestDist = 16
    const consider = (world: Vector3, target: SelectionTarget, bonus = 0) => {
      if (this.hiddenByLandscape(world) || !this.project(world, this.screen)) return
      const d = Math.hypot(this.screen.x - x, this.screen.y - y) - bonus
      if (d < bestDist) {
        bestDist = d
        best = target
      }
    }
    for (const body of this.bodyStates) {
      if (body.id !== 'Sun' && body.id !== 'Moon' && body.mag > this.shared.uLimMag.value) continue
      consider(body.world, { kind: 'body', id: body.id }, 4)
    }
    const limit = this.shared.uLimMag.value
    const { mag } = this.data.stars
    for (let i = 0; i < this.data.stars.count && mag[i] < limit; i++) {
      consider(this.starWorld(i, this.tmp2), { kind: 'star', index: i }, Math.max(0, 3 - mag[i]))
    }
    this.selection = best
    this.emitInfo(true)
  }

  private describeSelection(): Selection | null {
    const target = this.selection
    if (!target) return null
    let world: Vector3
    let eqj: Vector3
    let name: string
    let kind: string
    let mag: number
    if (target.kind === 'body') {
      const body = this.bodyStates.find((b) => b.id === target.id)
      if (!body) return null
      world = body.world
      eqj = body.eqj
      name = BODY_NAMES[body.id]
      kind = body.id === 'Sun' ? 'Star' : body.id === 'Moon' ? `Moon · ${Math.round(body.phase * 100)}% lit` : 'Planet'
      mag = body.mag
    } else {
      const { stars, starNames } = this.data
      const i = target.index
      const hip = stars.hip[i]
      const p = this.stars.positions
      eqj = new Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2])
      world = this.starWorld(i, new Vector3())
      name = starNames[hip] ?? (hip ? `HIP ${hip}` : 'Star')
      const constellation = this.starConstellation.get(hip)
      kind = constellation ? `Star in ${constellation}` : 'Star'
      mag = stars.mag[i]
    }
    const { az, alt } = worldToAzAlt(world)
    const ra = ((Math.atan2(eqj.y, eqj.x) / DEG + 360) % 360) / 15
    const dec = Math.asin(eqj.z) / DEG
    return { name, kind, mag, az, alt, ra, dec }
  }

  private selectionWorld() {
    const target = this.selection
    if (!target) return null
    if (target.kind === 'body') return this.bodyStates.find((b) => b.id === target.id)?.world ?? null
    return this.starWorld(target.index, new Vector3())
  }

  // ----- frame ------------------------------------------------------------

  private emitInfo(force = false) {
    const now = performance.now()
    if (!force && now - this.lastInfo < 200) return
    this.lastInfo = now
    const sun = this.bodyStates.find((b) => b.id === 'Sun')
    this.onInfo?.({
      time: new Date(this.simTime),
      speed: this.speed,
      az: ((this.yaw / DEG) % 360 + 360) % 360,
      alt: this.pitch / DEG,
      fov: this.fov,
      sunAlt: sun ? Math.asin(sun.world.y) / DEG : 0,
      selection: this.describeSelection(),
      nameVisible: this.nameVisible,
      pointing: this.describePointing(),
    })
  }

  private describePointing(): PointingInfo | null {
    const p = this.pointing
    if (!p || !this.nameFrame) return null
    const { az, alt } = worldToAzAlt(framePoint(this.nameFrame, 0, 0).applyMatrix3(this.toWorld3))
    return { status: p.status, az, alt, rises: p.rises, daylight: this.daylightLift > 0.5 }
  }

  private frame = (now: number) => {
    this.frameId = requestAnimationFrame(this.frame)
    const dt = Math.min(100, now - this.lastFrame)
    this.lastFrame = now
    this.simTime += dt * this.speed

    if (this.pendingFocus) this.velocity = { yaw: 0, pitch: 0 }

    if (this.pendingFocus && now >= this.pendingFocus.at) {
      const focus = this.pendingFocus
      this.pendingFocus = null
      this.flyTo(focus.az, focus.alt, focus.fov, { duration: focus.duration })
    }

    if (this.pointers.size === 0 && (this.velocity.yaw || this.velocity.pitch)) {
      this.yaw += this.velocity.yaw * dt
      this.pitch = Math.max(-89.5 * DEG, Math.min(89.5 * DEG, this.pitch + this.velocity.pitch * dt))
      const decay = Math.exp(-dt / 280)
      this.velocity.yaw *= decay
      this.velocity.pitch *= decay
      if (Math.abs(this.velocity.yaw) + Math.abs(this.velocity.pitch) < 1e-6) this.velocity = { yaw: 0, pitch: 0 }
    }

    this.updatePointing(now, dt)
    this.updateFlight(now)
    this.updateSky()
    this.updateMeteors(now)
    this.renderer.render(this.scene, this.camera)
    this.drawLabels()
    this.emitInfo()
  }

  /** Glides the camera onto the phone's attitude, then follows it with light smoothing. */
  private updatePointing(now: number, dt: number) {
    const p = this.pointing
    // While the name is below the skyline, the ground turns see-through so she can still find it.
    const ground = p?.status === 'hidden' ? 0.45 : 1
    this.groundOpacity += (ground - this.groundOpacity) * (1 - Math.exp(-dt / 350))
    this.landscape.uniforms.uOpacity.value = this.groundOpacity
    if (!p || !p.source.read(p.reading)) return
    if (p.start < 0) {
      p.start = now
      p.view.copy(p.reading)
    }
    // Steady against sensor jitter, but quick to catch up once the phone really moves.
    const tau = 25 + 95 * (1 - smoothstep(0.003, 0.06, p.view.angleTo(p.reading)))
    p.view.slerp(p.reading, 1 - Math.exp(-dt / tau))
    this.camera.quaternion.copy(p.from).slerp(p.view, easeInOut(Math.min(1, (now - p.start) / 1500)))
    const dir = this.tmp.set(0, 0, -1).applyQuaternion(this.camera.quaternion)
    this.yaw = Math.atan2(dir.x, -dir.z)
    this.pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)))
  }

  private updateFlight(now: number) {
    const flight = this.flight
    if (!flight) return
    const t = Math.min(1, (now - flight.start) / flight.duration)
    const e = easeInOut(t)
    const turn = new Quaternion().setFromUnitVectors(flight.from, flight.to)
    const dir = flight.from.clone().applyQuaternion(new Quaternion().slerp(turn, e))
    this.yaw = Math.atan2(dir.x, -dir.z)
    this.pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)))
    this.fov = flight.fovFrom + (flight.fovTo - flight.fovFrom) * e + flight.swell * Math.sin(Math.PI * e)
    if (t >= 1) {
      this.flight = null
      flight.onDone?.()
    }
  }

  /** Shooting stars: an occasional one at random, plus any queued by animations. */
  private updateMeteors(now: number) {
    this.meteors.uniforms.uTime.value = now / 1000
    this.meteors.uniforms.uVisibility.value = this.darkness
    if (this.darkness < 0.15) return

    const celebrating = this.dedication?.countdown() === null
    if (now >= this.nextMeteorAt) {
      const mean = celebrating ? 0.7 : this.exploring ? 7 : 3.2
      this.nextMeteorAt = now + mean * 1000 * (0.35 + Math.random() * 1.3)
      this.spawnMeteor(now, { bright: Math.random() < 0.08 })
    }
    while (this.meteorQueue.length && this.meteorQueue[0].at <= now) {
      const queued = this.meteorQueue.shift()!
      this.spawnMeteor(now, queued)
    }
  }

  private spawnMeteor(now: number, options: { near?: Vector3; bright?: boolean } = {}) {
    let start: Vector3 | null = null
    for (let attempt = 0; attempt < 6 && !start; attempt++) {
      const candidate = options.near
        ? options.near.clone().add(new Vector3().randomDirection().multiplyScalar(0.25)).normalize()
        : this.unproject(0.08 + Math.random() * 0.84, 0.04 + Math.random() * 0.5)
      if (candidate.y > 0.15 && !this.hiddenByLandscape(candidate)) start = candidate
    }
    if (!start) return

    // Mostly downward on screen, tilted 15-65 degrees to either side.
    const up = new Vector3(0, 1, 0).addScaledVector(start, -start.y).normalize()
    const right = new Vector3().crossVectors(start, up)
    const tilt = (Math.random() < 0.5 ? -1 : 1) * (15 + Math.random() * 50) * DEG
    const heading = up.multiplyScalar(-Math.cos(tilt)).addScaledVector(right, Math.sin(tilt))
    const length = (options.bright ? 18 + Math.random() * 18 : 6 + Math.random() * 20) * DEG
    const end = start.clone().multiplyScalar(Math.cos(length)).addScaledVector(heading, Math.sin(length))

    const tint = Math.random()
    const color: [number, number, number] = options.bright
      ? tint < 0.5
        ? [0.75, 1, 0.82]
        : [1, 0.85, 0.65]
      : [0.82 + 0.1 * tint, 0.9, 1]
    this.meteors.spawn(start, end, {
      birth: now / 1000,
      duration: 0.35 + (length / DEG) * 0.035 + Math.random() * 0.25,
      trail: 0.35 + Math.random() * 0.3,
      brightness: options.bright ? 1.5 : 0.55 + Math.random() * 0.45,
      color,
    })
  }

  /** World direction under a point given in viewport fractions (0..1). */
  private unproject(fx: number, fy: number) {
    const s = this.shared.uProjScale.value
    const px = ((fx * 2 - 1) * this.shared.uAspect.value) / s
    const py = (1 - fy * 2) / s
    const r2 = px * px + py * py
    return new Vector3(2 * px, 2 * py, r2 - 1)
      .divideScalar(1 + r2)
      .applyMatrix3(this.shared.uCamRot.value)
      .normalize()
  }

  private updateSky() {
    const { shared, layers } = this
    const date = new Date(this.simTime)

    if (!this.pointing) this.camera.rotation.set(this.pitch, -this.yaw, 0, 'YXZ')
    this.camera.updateMatrixWorld()
    shared.uCamRot.value.setFromMatrix4(this.camera.matrixWorld)
    this.viewRot.setFromMatrix4(this.camera.matrixWorldInverse)
    shared.uProjScale.value = 1 / Math.tan((this.fov * DEG) / 4)

    celestialToWorld(date, this.observer, this.toWorld)
    this.celestial.matrix.copy(this.toWorld)
    this.celestial.matrixWorldNeedsUpdate = true
    this.toWorld3.setFromMatrix4(this.toWorld)
    this.background.uniforms.uWorldToEqj.value.copy(this.toWorld3).transpose()

    this.bodyStates = computeBodies(date, this.observer, this.toWorld)
    const sun = this.bodyStates[0]
    const moon = this.bodyStates[1]
    const sunAlt = Math.asin(sun.world.y) / DEG
    const moonAlt = Math.asin(moon.world.y) / DEG
    shared.uSunDir.value.copy(sun.world)
    shared.uMoonDir.value.copy(moon.world)
    const night = 1 - smoothstep(-12, 0, sunAlt)
    shared.uMoonLight.value = moon.phase * smoothstep(-2, 25, moonAlt) * night

    // With the phone held up to a bright sky, the daylight is lifted so her name and the stars show.
    this.daylightLift = this.pointing ? smoothstep(-10, -4, sunAlt) : 0
    const atmosphere = layers.atmosphere ? 1 - this.daylightLift : 0
    const skyLimit = 6.5 + (limitingMagnitude(sunAlt, moonAlt, moon.phase) - 6.5) * atmosphere
    shared.uLimMag.value = skyLimit + Math.max(-0.6, 1.7 * Math.log10(60 / this.fov))
    shared.uSizeScale.value = Math.min(1.6, Math.max(0.9, 1 + 0.22 * Math.log2(60 / this.fov)))
    shared.uTime.value = this.lastFrame / 1000
    shared.uTwinkle.value = atmosphere
    shared.uExtinction.value = atmosphere

    // Eye adaptation: bright daylight needs a low exposure, the night sky a high one.
    // The ground stays sunlit even when the atmosphere layer is hidden.
    const adapt = (t: number) => Math.exp(Math.log(2.8) * (1 - t) + Math.log(0.45) * t)
    const groundDayness = smoothstep(-13, 1, sunAlt)
    shared.uExposure.value = adapt(groundDayness * atmosphere)
    this.landscape.uniforms.uLandExposure.value = adapt(groundDayness)
    const mwVisibility = smoothstep(3.6, 6.1, skyLimit)
    this.background.uniforms.uMilkyWayStrength.value = layers.milkyway ? 0.065 * mwVisibility : 0
    this.background.uniforms.uAtmosphere.value = atmosphere
    this.landscape.uniforms.uDay.value = smoothstep(-9, 8, sunAlt)

    // Figures and grids recede against a bright daytime sky.
    const daylight = smoothstep(-8, 4, sunAlt) * atmosphere
    this.overlayFade = 1 - 0.85 * daylight
    this.constellations.lines.uniforms.uOpacity.value = 0.6 * this.overlayFade
    // Additive art washes out over a bright twilight sky, so it follows sky darkness.
    this.constellations.artUniforms.uOpacity.value = 0.42 * (0.25 + 0.75 * smoothstep(2.5, 6, skyLimit))
    this.azGrid.uniforms.uOpacity.value = 0.55 * (1 - 0.35 * daylight)
    this.eqGrid.uniforms.uOpacity.value = 0.55 * (1 - 0.35 * daylight)

    const pxPerRadian = (shared.uProjScale.value * this.height * this.pixelRatio) / 4
    this.bodies.update(this.bodyStates, this.tmp.set(0, 0, 1).applyMatrix3(this.toWorld3).clone(), pxPerRadian, this.pixelRatio)
    this.bodies.moon.uniforms.uBrightness.value = 0.85 + 0.25 * night
    this.bodies.moon.uniforms.uGlow.value = 0.35 * moon.phase * night
    this.bodies.sun.uniforms.uGlow.value = 0.5 + 0.5 * atmosphere

    const lineScale = this.pixelRatio
    for (const lines of this.lineMeshes) lines.uniforms.uWidth.value = lines.baseWidth * lineScale

    this.darkness = smoothstep(2.5, 5, skyLimit)
    if (this.nameLayers.length) this.animateName(daylight, lineScale)
  }

  /**
   * Name timeline: stars fade in, the figure is traced letter by letter, then
   * a soft wave of light runs through it every few seconds. A focus burst
   * sends a brighter, faster wave.
   */
  private animateName(daylight: number, lineScale: number) {
    const now = performance.now()
    const t = this.nameClock()
    const burst = (now - this.nameBurstStart) / 1000
    let wave = -10
    let strength = 0
    if (burst >= 0 && burst < 3) {
      wave = burst * 0.7 - 0.15
      strength = 1.6 * (1 - smoothstep(2, 3, burst))
    } else if (t > 6) {
      const cycle = (t - 6) % 8
      wave = cycle / 2.4 - 0.15
      strength = cycle < 3 ? 0.9 : 0
    }

    this.updateNameCycle(t)
    this.nameLayers.forEach((layer, index) => {
      const weight = this.nameWeights[index] ?? 0
      const stars = layer.starUniforms
      stars.uFade.value = smoothstep(0, 1.6, index === 0 ? t : 4) * weight
      stars.uWave.value = wave
      stars.uWaveStrength.value = weight > 0.65 ? strength : 0
      const lines = layer.lines
      lines.uniforms.uReveal.value = index === 0 ? Math.min(2, Math.max(0, (t - 1.2) / 3.2)) : 2
      lines.uniforms.uWidth.value = lines.baseWidth * lineScale
      lines.uniforms.uOpacity.value = (0.42 + 0.05 * Math.sin(Math.max(t, 0) * 0.9)) * (1 - 0.6 * daylight) * weight
      lines.uniforms.uGlowPos.value = wave
      lines.uniforms.uGlowStrength.value = weight > 0.65 ? strength * 1.4 : 0
    })
  }

  /** English star-letters, then her name in Greek, the script of that sky science. */
  private updateNameCycle(t: number) {
    if (t < 5.4) {
      this.nameWeights = [1, 0]
      return
    }
    const slot = 7
    const local = (t - 5.4) % (slot * 2)
    const index = Math.floor(local / slot)
    const blend = smoothstep(0.82, 1, (local % slot) / slot)
    const weights = [0, 0]
    weights[index] = 1 - blend
    weights[(index + 1) % 2] += blend
    this.nameWeights = weights
  }

  private drawLabels() {
    const labels: Label[] = []
    const { layers } = this
    const font = (size: number, weight = 500) => `${weight} ${size}px Inter, ui-sans-serif, system-ui, sans-serif`
    const v = new Vector3()
    // Cardinal points and planets help find the way around the real sky too.
    const guided = this.exploring || this.pointing !== null

    CARDINALS.forEach((text, i) => {
      if (!guided) return
      const az = i * 45
      const base = layers.landscape ? this.landscape.ridgeAltitude(az) : 0
      if (!this.project(azAltToWorld(az, base + 1.8, v), this.screen)) return
      labels.push({
        text,
        x: this.screen.x,
        y: this.screen.y,
        align: 'center',
        color: i % 2 === 0 ? '#ff9a6b' : 'rgba(255, 170, 130, 0.75)',
        font: font(i % 2 === 0 ? 16 : 12, 700),
        priority: 0,
      })
    })

    const limit = this.shared.uLimMag.value
    for (const body of this.bodyStates) {
      const visible = body.id === 'Sun' || body.id === 'Moon' || body.mag < limit + 0.5
      if (!guided || !visible || this.hiddenByLandscape(body.world)) continue
      if (!this.project(body.world, this.screen)) continue
      labels.push({
        text: BODY_NAMES[body.id],
        x: this.screen.x,
        y: this.screen.y,
        dx: body.id === 'Sun' ? 18 : 12,
        dy: -10,
        color: body.id === 'Sun' ? '#ffe2a8' : body.id === 'Moon' ? '#e6ecff' : '#ffd38a',
        font: font(13, 600),
        priority: 1,
      })
    }

    if (layers.labels) {
      const starLimit = Math.min(limit - 1.2, 1.6 + 2.2 * Math.log2(Math.max(1, 100 / this.fov)))
      for (const { index, name } of this.namedStars) {
        if (this.data.stars.mag[index] > starLimit) break
        const world = this.starWorld(index, v)
        if (this.hiddenByLandscape(world) || !this.project(world, this.screen)) continue
        labels.push({
          text: name,
          x: this.screen.x,
          y: this.screen.y,
          dx: 7,
          dy: -7,
          color: 'rgba(205, 220, 255, 0.82)',
          font: font(12),
          priority: 2 + this.data.stars.mag[index] / 10,
        })
      }
    }

    if (layers.constellations || layers.art) {
      for (const c of this.constellations.labels as ConstellationLabel[]) {
        const world = v.copy(c.center).applyMatrix3(this.toWorld3)
        if (this.hiddenByLandscape(world) || !this.project(world, this.screen)) continue
        labels.push({
          text: c.name.toUpperCase(),
          x: this.screen.x,
          y: this.screen.y,
          align: 'center',
          color: `rgba(120, 165, 235, ${(0.85 * this.overlayFade).toFixed(2)})`,
          font: font(11, 600),
          letterSpacing: '1.5px',
          priority: 3,
        })
      }
    }

    if (layers.azimuthal) this.azimuthalGridLabels(labels, font(11))
    if (layers.equatorial) this.equatorialGridLabels(labels, font(11))

    const marker = this.selectionWorld()
    const markerPoint = marker && this.project(marker, this.screen) ? this.screen.clone() : null
    this.updateNameVisibility()
    this.updatePointingStatus()
    this.labelLayer.draw(labels, markerPoint, (ctx) => [
      ...this.drawCountdown(ctx),
      ...this.drawSkyQuote(ctx),
      ...this.drawVerses(ctx),
      ...this.drawPointingArrow(ctx),
    ])
  }

  /** Whether the name is hidden, still being looked for, or right in front of the phone. */
  private updatePointingStatus() {
    const p = this.pointing
    if (!p || !this.nameFrame) return
    const center = framePoint(this.nameFrame, 0, 0).applyMatrix3(this.toWorld3)
    let status: PointingStatus = 'waiting'
    if (p.start >= 0) {
      if (this.hiddenByLandscape(center)) status = 'hidden'
      else if (!this.project(center, this.screen)) status = 'searching'
      else {
        const dx = Math.abs(this.screen.x / this.width - 0.5)
        const dy = Math.abs(this.screen.y / this.height - 0.5)
        // Found near the middle of the view; it stays found until it leaves the screen.
        const found = (dx < 0.3 && dy < 0.3) || (p.status === 'found' && dx < 0.5 && dy < 0.5)
        status = found ? 'found' : 'searching'
      }
    }
    if (status === p.status) return
    if (status === 'found' && performance.now() - p.celebratedAt > 8000) {
      p.celebratedAt = performance.now()
      this.celebrateName()
    }
    p.rises = status === 'hidden' ? this.nextNameRise() : null
    p.status = status
    this.emitInfo(true)
  }

  /** When and where the centre of the name next clears the skyline, looking a day ahead. */
  private nextNameRise() {
    const frame = this.nameFrame
    if (!frame) return null
    const toWorld = new Matrix4()
    const world = new Vector3()
    for (let minutes = 2; minutes <= 24 * 60; minutes += 2) {
      const time = new Date(this.simTime + minutes * 60_000)
      celestialToWorld(time, this.observer, toWorld)
      if (!this.hiddenByLandscape(world.copy(frame.center).applyMatrix4(toWorld))) {
        return { time, az: worldToAzAlt(world).az }
      }
    }
    return null
  }

  /** A bright wave through the letters and a few meteors falling past them. */
  private celebrateName() {
    if (!this.nameFrame) return
    const now = performance.now()
    this.nameBurstStart = now
    const near = framePoint(this.nameFrame, 0, 2).applyMatrix3(this.toWorld3)
    this.meteorQueue.push({ at: now + 250, near, bright: true }, { at: now + 900, near }, { at: now + 1600, near })
  }

  /** While the name is out of view, an arrow at the edge of the screen leads the phone to it. */
  private drawPointingArrow(ctx: CanvasRenderingContext2D): [number, number, number, number][] {
    const p = this.pointing
    if (!p || !this.nameFrame || !this.dedication || p.status === 'waiting' || p.status === 'found') return []
    const center = framePoint(this.nameFrame, 0, 0).applyMatrix3(this.toWorld3)
    if (this.project(center, this.screen)) {
      const { x, y } = this.screen
      if (x > 0 && x < this.width && y > 0 && y < this.height) return []
    }
    // Screen direction of the shortest turn toward the name, even when it is behind the phone.
    const view = this.tmp2.copy(center).applyMatrix3(this.viewRot)
    const length = Math.hypot(view.x, view.y)
    const dx = length > 1e-6 ? view.x / length : 0
    const dy = length > 1e-6 ? -view.y / length : -1

    // Kept clear of the location badge above and the caption below.
    const left = 30
    const right = this.width - 30
    const top = 96
    const bottom = this.height - 170
    const cx = this.width / 2
    const cy = (top + bottom) / 2
    const reachX = dx > 0 ? (right - cx) / dx : dx < 0 ? (left - cx) / dx : Infinity
    const reachY = dy > 0 ? (bottom - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity
    const now = performance.now()
    const reach = Math.min(reachX, reachY) + 4 * Math.sin(now / 260)
    const x = cx + dx * reach
    const y = cy + dy * reach
    const alpha = 0.8 + 0.2 * Math.sin(now / 420)

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.fillStyle = 'rgb(255, 226, 168)'
    ctx.save()
    ctx.shadowColor = 'rgba(255, 205, 140, 0.9)'
    ctx.shadowBlur = 14
    ctx.translate(x, y)
    ctx.rotate(Math.atan2(dy, dx))
    ctx.beginPath()
    ctx.moveTo(12, 0)
    ctx.lineTo(-8, -10)
    ctx.lineTo(-3, 0)
    ctx.lineTo(-8, 10)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    const text = this.dedication.name.toUpperCase()
    ctx.font = '600 11px Inter, ui-sans-serif, system-ui, sans-serif'
    ctx.letterSpacing = '1.6px'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const half = ctx.measureText(text).width / 2
    const back = 24 + half * Math.abs(dx) + 4 * Math.abs(dy)
    const lx = x - dx * back
    const ly = y - dy * back
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)'
    ctx.shadowBlur = 6
    ctx.fillText(text, lx, ly)
    ctx.restore()
    return [
      [x - 16, y - 16, x + 16, y + 16],
      [lx - half - 4, ly - 9, lx + half + 4, ly + 9],
    ]
  }

  private updateNameVisibility() {
    if (!this.nameFrame || !this.layers.name) {
      this.nameVisible = false
      return
    }
    const world = framePoint(this.nameFrame, 0, 0).applyMatrix3(this.toWorld3)
    const onScreen = this.project(world, this.screen)
    const { x, y } = this.screen
    const inside = x > this.width * 0.1 && x < this.width * 0.9 && y > this.height * 0.05 && y < this.height * 0.85
    this.nameVisible = onScreen && inside && !this.hiddenByLandscape(world)
  }

  /**
   * The name's center on screen, the on-screen height of the letters, and the
   * angle of their baseline. Overlays are drawn in this frame so they stay on
   * the same line as the letters instead of crossing them.
   */
  private nameAnchor() {
    const frame = this.nameFrame
    if (!frame || !this.layers.name) return null
    const center = framePoint(frame, 0, 0).applyMatrix3(this.toWorld3)
    if (this.hiddenByLandscape(center) || !this.project(center, this.screen)) return null
    const x = this.screen.x
    const y = this.screen.y
    const right = framePoint(frame, 2, 0).applyMatrix3(this.toWorld3)
    const top = framePoint(frame, 0, GLYPH_HEIGHT / 2).applyMatrix3(this.toWorld3)
    if (!this.project(right, this.screen) || !this.project(top, this.tmpScreen)) return null
    const half = Math.hypot(this.tmpScreen.x - x, this.tmpScreen.y - y)
    if (half < 18) return null
    return {
      x,
      y,
      half,
      unitPx: Math.hypot(this.screen.x - x, this.screen.y - y) / 2,
      angle: Math.atan2(this.screen.y - y, this.screen.x - x),
    }
  }

  /** Turns a rectangle drawn in the name's local frame back into screen space. */
  private orientedRect(
    anchor: { x: number; y: number; angle: number },
    local: [number, number, number, number],
  ): [number, number, number, number] {
    const cos = Math.cos(anchor.angle)
    const sin = Math.sin(anchor.angle)
    const corners = [
      [local[0], local[1]],
      [local[2], local[1]],
      [local[2], local[3]],
      [local[0], local[3]],
    ]
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [px, py] of corners) {
      const sx = anchor.x + px * cos - py * sin
      const sy = anchor.y + px * sin + py * cos
      minX = Math.min(minX, sx)
      minY = Math.min(minY, sy)
      maxX = Math.max(maxX, sx)
      maxY = Math.max(maxY, sy)
    }
    return [minX, minY, maxX, maxY]
  }

  /** Countdown locked under the letters, on the same baseline as the name. */
  private drawCountdown(ctx: CanvasRenderingContext2D): [number, number, number, number][] {
    const frame = this.nameFrame
    if (!frame || !this.dedication) return []
    const t = this.nameClock()
    const alpha = smoothstep(2.2, 4.2, t)
    if (alpha <= 0) return []

    const anchor = this.nameAnchor()
    if (!anchor) return []
    const size = Math.min(100, Math.max(26, anchor.unitPx * 2.5))
    ctx.save()
    ctx.translate(anchor.x, anchor.y)
    ctx.rotate(anchor.angle)
    // A focus burst briefly brightens the countdown as the light wave passes.
    const burst = (performance.now() - this.nameBurstStart) / 1000
    const glow = burst >= 0 && burst < 2 ? 0.25 * Math.sin((Math.PI * burst) / 2) : 0
    const opacity = Math.min(1, alpha * (1 - 0.35 * (1 - this.darkness)) + glow)
    const now = performance.now()
    const parts = this.dedication.countdown()
    const localY = anchor.half + size * 1.25
    const rect = parts
      ? this.countdownRenderer.draw(ctx, 0, localY, size, parts, this.dedication.caption, opacity, now)
      : this.countdownRenderer.drawCelebration(
          ctx,
          0,
          localY,
          size * 1.1,
          this.dedication.celebration.title,
          this.dedication.celebration.caption,
          opacity,
          now,
        )
    ctx.restore()
    return [this.orientedRect(anchor, rect)]
  }

  /** A note about the sky, on the same line as the letters, just above them. */
  private drawSkyQuote(ctx: CanvasRenderingContext2D): [number, number, number, number][] {
    if (this.nameClock() < 4.5) return []
    const anchor = this.nameAnchor()
    if (!anchor) return []
    const size = Math.min(13, Math.max(10, anchor.unitPx * 0.3))
    ctx.save()
    ctx.translate(anchor.x, anchor.y)
    ctx.rotate(anchor.angle)
    const rect = drawSkyQuote(
      ctx,
      SKY_QUOTES,
      this.quoteOrder,
      0,
      -anchor.half - size * 3.4,
      size,
      Math.min(anchor.unitPx * 22, 520),
      this.nameClock() - 4.5,
    )
    ctx.restore()
    return rect ? [this.orientedRect(anchor, rect)] : []
  }

  /** Dedication lines, fixed to the screen and gone before the name appears. */
  private drawVerses(ctx: CanvasRenderingContext2D): [number, number, number, number][] {
    if (!this.dedication?.verses.length || this.exploring || this.versesSkipped) return []
    const size = Math.min(27, Math.max(15, this.width / 46))
    const maxWidth = Math.min(this.width * 0.9, 980)
    const elapsed = (performance.now() - this.nameRevealStart) / 1000
    return drawCelestialVerses(
      ctx,
      this.dedication.verses,
      this.width / 2,
      this.height * 0.4,
      size,
      maxWidth,
      elapsed,
    )
  }

  private azimuthalGridLabels(labels: Label[], font: string) {
    const v = new Vector3()
    for (let az = 15; az < 360; az += 15) {
      if (az % 45 === 0) continue
      const base = this.layers.landscape ? this.landscape.ridgeAltitude(az) : 0
      if (!this.project(azAltToWorld(az, base + 1.8, v), this.screen)) continue
      labels.push({ text: `${az}°`, x: this.screen.x, y: this.screen.y, align: 'center', color: 'rgba(230, 130, 100, 0.8)', font, priority: 4 })
    }
    const az = Math.round((this.yaw / DEG) / 15) * 15
    for (let alt = 10; alt <= 80; alt += 10) {
      if (!this.project(azAltToWorld(az, alt, v), this.screen)) continue
      labels.push({ text: `${alt}°`, x: this.screen.x, y: this.screen.y, dx: 5, dy: -8, color: 'rgba(230, 130, 100, 0.8)', font, priority: 4 })
    }
  }

  private equatorialGridLabels(labels: Label[], font: string) {
    const v = new Vector3()
    for (let h = 0; h < 24; h++) {
      const world = v.set(Math.cos(h * 15 * DEG), Math.sin(h * 15 * DEG), 0).applyMatrix3(this.toWorld3)
      if (this.hiddenByLandscape(world) || !this.project(world, this.screen)) continue
      labels.push({ text: `${h}h`, x: this.screen.x, y: this.screen.y, dx: 4, dy: -8, color: 'rgba(120, 160, 235, 0.85)', font, priority: 4 })
    }
    const center = new Vector3(0, 0, -1).applyMatrix3(this.shared.uCamRot.value).applyMatrix3(this.toWorld3.clone().transpose())
    const ra = Math.round((Math.atan2(center.y, center.x) / DEG) / 15) * 15
    for (let dec = -80; dec <= 80; dec += 10) {
      if (dec === 0) continue
      const c = Math.cos(dec * DEG)
      const world = v.set(c * Math.cos(ra * DEG), c * Math.sin(ra * DEG), Math.sin(dec * DEG)).applyMatrix3(this.toWorld3)
      if (this.hiddenByLandscape(world) || !this.project(world, this.screen)) continue
      labels.push({ text: `${dec > 0 ? '+' : ''}${dec}°`, x: this.screen.x, y: this.screen.y, dx: 4, dy: -8, color: 'rgba(120, 160, 235, 0.85)', font, priority: 4 })
    }
  }
}
