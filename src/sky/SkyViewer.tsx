import { useEffect, useRef, useState } from 'react'
import { loadSkyData } from './data'
import {
  canFollowDevice,
  DeviceAttitude,
  httpsUrlForSensors,
  keepScreenOn,
  type AttitudeStart,
} from './deviceAttitude'
import { HOLD_UP_ICON, LAYER_ICONS } from './icons'
import { OBSERVER } from './observer'
import {
  SkyEngine,
  type Dedication,
  type LayerKey,
  type LayerState,
  type PointingInfo,
  type SkyInfo,
} from './SkyEngine'
import {
  formatLocalDate,
  formatLocalTime,
  localDateValue,
  localHours,
  withLocalDate,
  withLocalHours,
  type TimePreset,
} from './time'
import './sky.css'

/** The default view is just the sky and the name; filters come with "Explore". */
const DEFAULT_LAYERS: LayerState = {
  name: true,
  constellations: false,
  art: false,
  azimuthal: false,
  equatorial: false,
  atmosphere: true,
  landscape: true,
  milkyway: true,
  labels: false,
}

const LAYER_LABELS: [LayerKey, string][] = [
  ['name', 'Name'],
  ['constellations', 'Constellations'],
  ['art', 'Constellation Art'],
  ['azimuthal', 'Azimuthal Grid'],
  ['equatorial', 'Equatorial Grid'],
  ['atmosphere', 'Atmosphere'],
  ['landscape', 'Landscape'],
  ['milkyway', 'Milky Way'],
  ['labels', 'Star Names'],
]

type Preset = TimePreset | 'now'

const PRESETS: [Preset, string][] = [
  ['dawn', 'Dawn'],
  ['morning', 'Morning'],
  ['night', 'Night'],
  ['now', 'Now'],
]

const SPEEDS: [number, string][] = [
  [1, '1×'],
  [60, '1 min/s'],
  [600, '10 min/s'],
  [3600, '1 h/s'],
]

const PRESET_VIEWS: Record<Preset, [number, number] | null> = {
  dawn: null,
  morning: null,
  night: [196, 38],
  now: null,
}

/** Vertical field of view; portrait screens need more to show a useful width. */
const defaultFov = () => (window.innerWidth / window.innerHeight < 0.9 ? 125 : 100)

function formatRa(hours: number) {
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  return `${h}h ${String(m % 60).padStart(2, '0')}m`
}

function formatSigned(deg: number) {
  return `${deg >= 0 ? '+' : '−'}${Math.abs(deg).toFixed(1)}°`
}

function pointingProblem(kind: Exclude<AttitudeStart, 'ready'>) {
  switch (kind) {
    case 'denied':
      return 'Motion access was declined. On iPhone: Settings → Safari → Motion & Orientation Access.'
    case 'insecure':
      return `Open ${httpsUrlForSensors() ?? 'https://this-page/'} — phones only share the compass over https. Accept the certificate warning once.`
    case 'unavailable':
      return 'The compass didn’t lock on. Tilt the phone in a figure-8 and try again.'
  }
}

const COMPASS_POINTS = [
  'north', 'north-northeast', 'northeast', 'east-northeast',
  'east', 'east-southeast', 'southeast', 'south-southeast',
  'south', 'south-southwest', 'southwest', 'west-southwest',
  'west', 'west-northwest', 'northwest', 'north-northwest',
]

const compassPoint = (az: number) => COMPASS_POINTS[Math.round((((az % 360) + 360) % 360) / 22.5) % 16]

function heightInSky(alt: number) {
  if (alt < 12) return 'just above the horizon'
  if (alt < 30) return 'low in the sky'
  if (alt < 55) return 'about halfway up the sky'
  if (alt < 75) return 'high in the sky'
  return 'almost straight overhead'
}

/** The caption while the phone is held up: a headline and where to look. */
function pointingWords(pointing: PointingInfo, name: string): [string, string] {
  const where = `${compassPoint(pointing.az)}, ${heightInSky(pointing.alt)}`
  switch (pointing.status) {
    case 'waiting':
      return ['Hold your phone up to the sky.', 'Finding north…']
    case 'searching':
      return ['Hold your phone up to the sky.', `${name} is in the ${where}.`]
    case 'found':
      return [
        'Your name is actually up there right now.',
        pointing.daylight ? `In the ${where}. Daylight hides it for now.` : `Look ${where}.`,
      ]
    case 'hidden':
      return [
        pointing.alt > 0 ? 'Your name is just behind the mountains right now.' : 'Your name is below the horizon right now.',
        pointing.rises
          ? `It rises in the ${compassPoint(pointing.rises.az)} at ${formatLocalTime(pointing.rises.time)}.`
          : 'It stays out of sight for the rest of the day.',
      ]
  }
}

/**
 * Tonight's darkest sky, running in real time, with the name written above the
 * view. The opening shot starts well away and pans onto the letters; later
 * returns glide over from wherever the camera already is.
 */
function showDedication(engine: SkyEngine, dedication: Dedication, opening: boolean) {
  const [az, alt] = PRESET_VIEWS.night!
  const fov = defaultFov()
  engine.setExploring(false)
  engine.applyPreset('night')
  engine.setSpeed(1)
  engine.setDedication(dedication)
  // Far enough that a wide landscape view cannot see the name, same height so
  // the sky turns rather than climbing off the ridges.
  engine.presentName(az, alt, fov, opening ? { az: az + 80, alt:20, fov } : undefined)
}

type SkyViewerProps = {
  /** Must be referentially stable; it is read once when the sky loads. */
  dedication: Dedication
}

export function SkyViewer({ dedication }: SkyViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [engine, setEngine] = useState<SkyEngine | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [info, setInfo] = useState<SkyInfo | null>(null)
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS)
  const [preset, setPreset] = useState<Preset | null>('night')
  const [exploring, setExploring] = useState(false)
  const [curtain, setCurtain] = useState(false)
  const [showCredits, setShowCredits] = useState(false)
  const [canPoint] = useState(() => canFollowDevice())
  const [pointing, setPointing] = useState<'off' | 'starting' | 'on'>('off')
  const [notice, setNotice] = useState<string | null>(null)
  const [hasLeftIntro, setHasLeftIntro] = useState(false)
  const heldUp = pointing !== 'off'
  const phone = useRef<{ attitude: DeviceAttitude; release: () => void } | null>(null)

  function releasePhone() {
    phone.current?.attitude.stop()
    phone.current?.release()
    phone.current = null
  }

  useEffect(() => {
    let created: SkyEngine | null = null
    let cancelled = false
    loadSkyData()
      .then((data) => {
        if (cancelled || !containerRef.current) return
        created = new SkyEngine(containerRef.current, data)
        created.onInfo = setInfo
        created.setLayers(DEFAULT_LAYERS)
        showDedication(created, dedication, true)
        setEngine(created)
        setStatus('ready')
      })
      .catch((error) => {
        console.error(error)
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
      releasePhone()
      created?.dispose()
      setEngine(null)
    }
  }, [dedication])

  useEffect(() => {
    engine?.setLayers(layers)
  }, [engine, layers])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const time = info?.time ?? new Date()
  const [pointingHeadline, pointingDetail] = info?.pointing
    ? pointingWords(info.pointing, dedication.name)
    : ['Hold your phone up to the sky.', 'Finding north…']

  function choosePreset(next: Preset) {
    if (!engine) return
    engine.applyPreset(next)
    const view = PRESET_VIEWS[next]
    if (view) engine.lookAt(...view, defaultFov())
    else if (next !== 'now') requestAnimationFrame(() => engine.lookAtSky(defaultFov() + 10))
    setPreset(next)
  }

  function toggleLayer(key: LayerKey) {
    setLayers((current) => ({ ...current, [key]: !current[key] }))
  }

  function startExploring() {
    engine?.setExploring(true)
    setHasLeftIntro(true)
    setExploring(true)
  }

  /** The sky follows the phone, at the real time, so her name sits where it truly is. */
  async function holdUpToSky() {
    if (!engine || pointing !== 'off') return
    const attitude = new DeviceAttitude()
    // iOS only shows the motion prompt, and grants the wake lock, during the tap itself.
    const started = attitude.start()
    const release = keepScreenOn()
    setNotice(null)
    setHasLeftIntro(true)
    setPointing('starting')
    const result = await started
    if (result !== 'ready') {
      release()
      setPointing('off')
      setNotice(pointingProblem(result))
      return
    }
    phone.current = { attitude, release }
    engine.setExploring(false)
    setExploring(false)
    setShowCredits(false)
    setPreset('now')
    setCurtain(true)
    window.setTimeout(() => {
      engine.followDevice(attitude, Math.min(defaultFov(), 100))
      setPointing('on')
      setCurtain(false)
    }, 380)
  }

  function putPhoneDown() {
    if (!engine) return
    setCurtain(true)
    window.setTimeout(() => {
      releasePhone()
      engine.stopFollowingDevice()
      setPointing('off')
      setPreset('night')
      setExploring(false)
      setShowCredits(false)
      showDedication(engine, dedication, false)
      engine.skipVerses()
      setCurtain(false)
    }, 380)
  }

  // Dims the view briefly so the jump back to tonight's sky isn't abrupt.
  function backToName() {
    if (!engine) return
    setCurtain(true)
    window.setTimeout(() => {
      setExploring(false)
      setLayers(DEFAULT_LAYERS)
      setPreset('night')
      setShowCredits(false)
      showDedication(engine, dedication, false)
      setCurtain(false)
    }, 380)
  }

  return (
    <div className="sky-viewer">
      <div ref={containerRef} className="sky-stage" />
      <div className={curtain ? 'sky-curtain is-down' : 'sky-curtain'} aria-hidden="true" />

      {status !== 'ready' && (
        <div className="sky-loading" role="status">
          {status === 'loading' ? 'Loading the sky over Kamand…' : 'The sky data could not be loaded.'}
        </div>
      )}

      <header className="sky-location" aria-label="Observer location">
        <span className="sky-location__pin" aria-hidden="true" />
        <div>
          <strong>{OBSERVER.name}</strong>
          <span>
            {OBSERVER.place} · {OBSERVER.latitude.toFixed(2)}°N {OBSERVER.longitude.toFixed(2)}°E
          </span>
        </div>
      </header>

      {exploring && !heldUp && (
        <div className="sky-top-left">
          <button className="sky-back" onClick={backToName}>
            <span aria-hidden="true">←</span> Back to {dedication.name}
          </button>
          {canPoint && (
            <button className="sky-back sky-hold-mini" onClick={holdUpToSky}>
              {HOLD_UP_ICON}
              Hold the phone up
            </button>
          )}
        </div>
      )}

      {status === 'ready' && !exploring && !heldUp && (
        <div
          className={[
            'sky-intro',
            canPoint ? 'is-hold' : '',
            hasLeftIntro ? 'is-back' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {canPoint && (
            <>
              <button className="sky-intro__hold" onClick={holdUpToSky}>
                {HOLD_UP_ICON}
                Hold the phone up to the sky
              </button>
              {httpsUrlForSensors() && (
                <p className="sky-intro__https">
                  Compass needs https — open <strong>{httpsUrlForSensors()}</strong> and accept the warning
                </p>
              )}
            </>
          )}
          <div className="sky-intro__row">
            <span className="sky-intro__hint">Drag to look around</span>
            <button
              className={info && !info.nameVisible ? 'sky-intro__focus is-lost' : 'sky-intro__focus'}
              onClick={() => engine?.focusName(defaultFov())}
            >
              <span aria-hidden="true">✦</span> Focus on {dedication.name}
            </button>
            <button className="sky-intro__explore" onClick={startExploring}>
              Explore the sky
            </button>
          </div>
        </div>
      )}

      {heldUp && (
        <div
          className={info?.pointing?.status === 'found' ? 'sky-pointing is-found' : 'sky-pointing'}
          aria-live="polite"
        >
          <p className="sky-pointing__headline">{pointingHeadline}</p>
          <p className="sky-pointing__where">{pointingDetail}</p>
          <button onClick={putPhoneDown}>Put the phone down</button>
        </div>
      )}

      {notice && (
        <div className="sky-notice" role="status">
          {notice}
        </div>
      )}

      {info?.selection && !heldUp && (
        <aside className="sky-selection" aria-live="polite">
          <button className="sky-selection__close" onClick={() => engine?.clearSelection()} aria-label="Close">
            ×
          </button>
          <h2>{info.selection.name}</h2>
          <p className="sky-selection__kind">{info.selection.kind}</p>
          <dl>
            <dt>Magnitude</dt>
            <dd>{info.selection.mag.toFixed(2)}</dd>
            <dt>Az / Alt</dt>
            <dd>
              {info.selection.az.toFixed(1)}° / {formatSigned(info.selection.alt)}
            </dd>
            <dt>RA / Dec</dt>
            <dd>
              {formatRa(info.selection.ra)} / {formatSigned(info.selection.dec)}
            </dd>
          </dl>
        </aside>
      )}

      {exploring && !heldUp && (
        <footer className="sky-dock">
          <div className="sky-zoom">
            <button onClick={() => engine?.zoom(0.8)} aria-label="Zoom in">
              +
            </button>
            <button onClick={() => engine?.zoom(1.25)} aria-label="Zoom out">
              −
            </button>
            {info && (
              <span className="sky-zoom__readout">
                FOV {info.fov.toFixed(info.fov < 10 ? 1 : 0)}° · Az {info.az.toFixed(0)}° · Alt {info.alt.toFixed(0)}°
              </span>
            )}
          </div>

          <nav className="sky-toolbar" aria-label="Sky layers">
            {LAYER_LABELS.map(([key, label]) => (
              <button
                key={key}
                className={layers[key] ? 'is-on' : ''}
                aria-pressed={layers[key]}
                onClick={() => toggleLayer(key)}
                title={label}
              >
                {LAYER_ICONS[key]}
                <span>{key === 'name' ? dedication.name : label}</span>
              </button>
            ))}
          </nav>

          <section className="sky-time" aria-label="Time">
            <div className="sky-time__now">
              <strong>{formatLocalTime(time)}</strong>
              <span>{formatLocalDate(time)}</span>
            </div>
            <div className="sky-time__presets" role="group" aria-label="Time presets">
              {PRESETS.map(([key, label]) => (
                <button key={key} className={preset === key ? 'is-on' : ''} onClick={() => choosePreset(key)}>
                  {label}
                </button>
              ))}
            </div>
            <input
              className="sky-time__slider"
              type="range"
              min={0}
              max={24}
              step={1 / 60}
              value={localHours(time)}
              aria-label="Time of day"
              onChange={(e) => {
                engine?.setTime(withLocalHours(time, Number(e.target.value)))
                setPreset(null)
              }}
            />
            <div className="sky-time__row">
              <input
                type="date"
                value={localDateValue(time)}
                aria-label="Date"
                onChange={(e) => {
                  engine?.setTime(withLocalDate(time, e.target.value))
                  setPreset(null)
                }}
              />
              <div className="sky-time__speeds" role="group" aria-label="Time speed">
                <button
                  className={info?.speed === 0 ? 'is-on' : ''}
                  onClick={() => engine?.setSpeed(0)}
                  aria-label="Pause time"
                >
                  ❚❚
                </button>
                {SPEEDS.map(([speed, label]) => (
                  <button key={speed} className={info?.speed === speed ? 'is-on' : ''} onClick={() => engine?.setSpeed(speed)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </footer>
      )}

      {!heldUp && (
        <button className="sky-credits-toggle" onClick={() => setShowCredits((v) => !v)} aria-expanded={showCredits}>
          Data credits
        </button>
      )}
      {showCredits && !heldUp && (
        <div className="sky-credits" role="dialog" aria-label="Data credits">
          <p>
            Stars: <a href="https://codeberg.org/astronexus/hyg">HYG Database v4.4</a> (CC BY-SA 4.0). Constellation
            lines and names: <a href="https://github.com/Stellarium/stellarium">Stellarium</a> (CC BY-SA 4.0).
            Constellation art: <a href="https://johanmeuris.eu/work/stellarium-constellation-art/">Johan Meuris</a>{' '}
            (Free Art License). Milky Way: <a href="https://svs.gsfc.nasa.gov/4851">NASA/Goddard SVS Deep Star Maps 2020</a>,
            Gaia DR2 ESA/Gaia/DPAC. Moon: Gregory H. Revera (CC BY-SA 3.0). Terrain around IIT Mandi:{' '}
            <a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a> (SRTM). Ephemerides:{' '}
            <a href="https://github.com/cosinekitty/astronomy">Astronomy Engine</a>.
          </p>
        </div>
      )}
    </div>
  )
}
