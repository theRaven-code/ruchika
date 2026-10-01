import {
  Group,
  Matrix3,
  Matrix4,
  PerspectiveCamera,
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
import { createLandscape } from './layers/landscape'
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
}

/** A name written in stars, with a countdown hanging underneath it. */
export type Dedication = {
  name: string
  caption: string
  countdown: () => { value: number; label: string }[]
}

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
  private nameLayer: ReturnType<typeof createNameConstellation> | null = null
  private nameFrame: SkyFrame | null = null
  private nameRevealStart = 0
  private nameVisible = false

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
      this.landscape.mesh,
    )
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
    if (!exploring) this.selection = null
    this.emitInfo(true)
  }

  setDedication(dedication: Dedication | null) {
    this.dedication = dedication
    this.placeName()
  }

  /**
   * Writes the name into the sky just above the current view centre, upright
   * at the current time, and replays the trace-in animation. The figure is
   * fixed to the stars afterwards, so it rises and sets like a constellation.
   */
  placeName() {
    if (this.nameLayer) {
      this.celestial.remove(this.nameLayer.stars, this.nameLayer.lines.mesh)
      this.nameLayer.stars.geometry.dispose()
      this.nameLayer.lines.mesh.geometry.dispose()
      ;(this.nameLayer.stars.material as ShaderMaterial).dispose()
      ;(this.nameLayer.lines.mesh.material as ShaderMaterial).dispose()
      this.nameLayer = null
    }
    if (!this.dedication) return

    celestialToWorld(new Date(this.simTime), this.observer, this.toWorld)
    const toEqj = new Matrix3().setFromMatrix4(this.toWorld).transpose()
    const centerWorld = azAltToWorld(this.yaw / DEG, this.pitch / DEG + 9)
    const zenith = new Vector3(0, 1, 0)
    const upWorld = zenith.addScaledVector(centerWorld, -centerWorld.y).normalize()
    const rightWorld = new Vector3().crossVectors(centerWorld, upWorld)

    // Fit the name to ~62% of the visible width, but never larger than 62°.
    const hFov = 4 * Math.atan((this.width / this.height) * Math.tan((this.fov * DEG) / 4))
    const width = Math.min(62 * DEG, 0.62 * hFov)
    this.nameFrame = {
      center: centerWorld.applyMatrix3(toEqj),
      up: upWorld.applyMatrix3(toEqj),
      right: rightWorld.applyMatrix3(toEqj),
      unit: width / Math.max(1, layoutName(this.dedication.name).width),
    }
    this.nameLayer = createNameConstellation(this.dedication.name, this.nameFrame)
    this.nameLayer.stars.visible = this.layers.name
    this.nameLayer.lines.mesh.visible = this.layers.name
    this.celestial.add(this.nameLayer.stars, this.nameLayer.lines.mesh)
    this.shareUniforms()
    this.nameRevealStart = performance.now()
  }

  /** Turns the view back to the name and its countdown. */
  lookAtName(fov = this.fov) {
    if (!this.nameFrame) return
    celestialToWorld(new Date(this.simTime), this.observer, this.toWorld)
    const world = framePoint(this.nameFrame, 0, 0).applyMatrix4(this.toWorld)
    const { az, alt } = worldToAzAlt(world)
    this.lookAt(az, alt - 9, fov)
  }

  setLayers(layers: LayerState) {
    this.layers = { ...layers }
    if (this.nameLayer) {
      this.nameLayer.stars.visible = layers.name
      this.nameLayer.lines.mesh.visible = layers.name
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
    const scale = e.deltaMode === 1 ? 16 : 1
    const dx = e.deltaX * scale
    const dy = e.deltaY * scale
    if (!e.ctrlKey && Math.abs(dx) > Math.abs(dy)) {
      this.yaw += dx * this.radiansPerPixel()
      return
    }
    this.zoom(Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0015)))
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
    const step = this.fov * DEG * 0.06
    if (e.key === 'ArrowLeft') this.yaw -= step
    else if (e.key === 'ArrowRight') this.yaw += step
    else if (e.key === 'ArrowUp') this.pitch = Math.min(89.5 * DEG, this.pitch + step)
    else if (e.key === 'ArrowDown') this.pitch = Math.max(-89.5 * DEG, this.pitch - step)
    else if (e.key === '+' || e.key === '=') this.zoom(0.85)
    else if (e.key === '-' || e.key === '_') this.zoom(1 / 0.85)
    else return
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
    })
  }

  private frame = (now: number) => {
    this.frameId = requestAnimationFrame(this.frame)
    const dt = Math.min(100, now - this.lastFrame)
    this.lastFrame = now
    this.simTime += dt * this.speed

    if (this.pointers.size === 0 && (this.velocity.yaw || this.velocity.pitch)) {
      this.yaw += this.velocity.yaw * dt
      this.pitch = Math.max(-89.5 * DEG, Math.min(89.5 * DEG, this.pitch + this.velocity.pitch * dt))
      const decay = Math.exp(-dt / 280)
      this.velocity.yaw *= decay
      this.velocity.pitch *= decay
      if (Math.abs(this.velocity.yaw) + Math.abs(this.velocity.pitch) < 1e-6) this.velocity = { yaw: 0, pitch: 0 }
    }

    this.updateSky()
    this.renderer.render(this.scene, this.camera)
    this.drawLabels()
    this.emitInfo()
  }

  private updateSky() {
    const { shared, layers } = this
    const date = new Date(this.simTime)

    this.camera.rotation.set(this.pitch, -this.yaw, 0, 'YXZ')
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

    const skyLimit = layers.atmosphere ? limitingMagnitude(sunAlt, moonAlt, moon.phase) : 6.5
    shared.uLimMag.value = skyLimit + Math.max(-0.6, 1.7 * Math.log10(60 / this.fov))
    shared.uSizeScale.value = Math.min(1.6, Math.max(0.9, 1 + 0.22 * Math.log2(60 / this.fov)))
    shared.uTime.value = this.lastFrame / 1000
    shared.uTwinkle.value = layers.atmosphere ? 1 : 0
    shared.uExtinction.value = layers.atmosphere ? 1 : 0

    // Eye adaptation: bright daylight needs a low exposure, the night sky a high one.
    // The ground stays sunlit even when the atmosphere layer is hidden.
    const adapt = (t: number) => Math.exp(Math.log(2.8) * (1 - t) + Math.log(0.45) * t)
    const groundDayness = smoothstep(-13, 1, sunAlt)
    shared.uExposure.value = adapt(layers.atmosphere ? groundDayness : 0)
    this.landscape.uniforms.uLandExposure.value = adapt(groundDayness)
    const mwVisibility = layers.atmosphere ? smoothstep(3.6, 6.1, skyLimit) : 1
    this.background.uniforms.uMilkyWayStrength.value = layers.milkyway ? 0.065 * mwVisibility : 0
    this.background.uniforms.uAtmosphere.value = layers.atmosphere ? 1 : 0
    this.landscape.uniforms.uDay.value = smoothstep(-9, 8, sunAlt)

    // Figures and grids recede against a bright daytime sky.
    const daylight = layers.atmosphere ? smoothstep(-8, 4, sunAlt) : 0
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
    this.bodies.sun.uniforms.uGlow.value = layers.atmosphere ? 1 : 0.5

    const lineScale = this.pixelRatio
    for (const lines of this.lineMeshes) lines.uniforms.uWidth.value = lines.baseWidth * lineScale

    if (this.nameLayer) {
      // Stars fade in, then the figure is traced letter by letter.
      const t = (performance.now() - this.nameRevealStart) / 1000
      this.nameLayer.starUniforms.uFade.value = smoothstep(0, 1.6, t)
      const lines = this.nameLayer.lines
      lines.uniforms.uReveal.value = Math.min(2, Math.max(0, (t - 1.2) / 3.2))
      lines.uniforms.uWidth.value = lines.baseWidth * lineScale
      lines.uniforms.uOpacity.value = (0.38 + 0.06 * Math.sin(t * 0.9)) * (1 - 0.6 * daylight)
    }
  }

  private drawLabels() {
    const labels: Label[] = []
    const { layers } = this
    const font = (size: number, weight = 500) => `${weight} ${size}px Inter, ui-sans-serif, system-ui, sans-serif`
    const v = new Vector3()

    CARDINALS.forEach((text, i) => {
      if (!this.exploring) return
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
      if (!this.exploring || !visible || this.hiddenByLandscape(body.world)) continue
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
    this.labelLayer.draw(labels, markerPoint, (ctx) => this.drawCountdown(ctx))
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

  /** Countdown hung in the sky under the name, screen-aligned, scaled with zoom. */
  private drawCountdown(ctx: CanvasRenderingContext2D): [number, number, number, number][] {
    const frame = this.nameFrame
    if (!frame || !this.dedication || !this.layers.name) return []
    const t = (performance.now() - this.nameRevealStart) / 1000
    const alpha = smoothstep(2.2, 4.2, t)
    if (alpha <= 0) return []

    const world = framePoint(frame, 0, -GLYPH_HEIGHT / 2 - 3.8).applyMatrix3(this.toWorld3)
    if (this.hiddenByLandscape(world) || !this.project(world, this.screen)) return []
    const { x, y } = this.screen

    const unitPx = (frame.unit * this.shared.uProjScale.value * this.height) / 4
    const digits = Math.min(104, Math.max(24, unitPx * 2.6))
    const labelSize = Math.max(9, digits * 0.24)
    const spacing = digits * 2.2
    const parts = this.dedication.countdown()
    const left = x - (spacing * (parts.length - 1)) / 2
    const fontStack = 'Inter, ui-sans-serif, system-ui, sans-serif'

    ctx.globalAlpha = alpha
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    parts.forEach((part, i) => {
      const cx = left + i * spacing
      ctx.shadowColor = 'rgba(140, 175, 255, 0.65)'
      ctx.shadowBlur = digits * 0.35
      ctx.fillStyle = 'rgba(238, 244, 255, 0.96)'
      ctx.font = `300 ${digits}px ${fontStack}`
      ctx.letterSpacing = '0px'
      ctx.fillText(String(part.value).padStart(2, '0'), cx, y)
      ctx.shadowBlur = 6
      ctx.fillStyle = 'rgba(190, 208, 255, 0.7)'
      ctx.font = `600 ${labelSize}px ${fontStack}`
      ctx.letterSpacing = `${labelSize * 0.28}px`
      ctx.fillText(part.label.toUpperCase(), cx + labelSize * 0.14, y + labelSize * 1.9)
      if (i < parts.length - 1) {
        ctx.fillStyle = 'rgba(200, 216, 255, 0.55)'
        ctx.beginPath()
        ctx.arc(cx + spacing / 2, y - digits * 0.33, Math.max(1.5, digits * 0.04), 0, Math.PI * 2)
        ctx.fill()
      }
    })
    if (this.dedication.caption) {
      ctx.shadowBlur = 6
      ctx.fillStyle = 'rgba(200, 214, 255, 0.62)'
      ctx.font = `italic 400 ${labelSize * 1.25}px ${fontStack}`
      ctx.letterSpacing = '0.5px'
      ctx.fillText(this.dedication.caption, x, y + labelSize * 4.2)
    }
    const halfWidth = (spacing * parts.length) / 2
    return [[x - halfWidth, y - digits, x + halfWidth, y + labelSize * 5]]
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
