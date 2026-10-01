import { useEffect, useRef, useState } from 'react'
import { loadSkyData } from './data'
import { LAYER_ICONS } from './icons'
import { OBSERVER } from './observer'
import { SkyEngine, type Dedication, type LayerKey, type LayerState, type SkyInfo } from './SkyEngine'
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

/**
 * Tonight's darkest sky, running in real time, with the name written above the
 * view. The opening shot rises from the ridges; later returns glide over.
 */
function showDedication(engine: SkyEngine, dedication: Dedication, opening: boolean) {
  const [az, alt] = PRESET_VIEWS.night!
  const fov = defaultFov()
  engine.setExploring(false)
  engine.applyPreset('night')
  engine.setSpeed(1)
  engine.setDedication(dedication)
  engine.presentName(az, alt, fov, opening ? { az: az + 78, alt: 6, fov } : undefined)
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
      created?.dispose()
      setEngine(null)
    }
  }, [dedication])

  useEffect(() => {
    engine?.setLayers(layers)
  }, [engine, layers])

  const time = info?.time ?? new Date()

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
    setExploring(true)
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

      {exploring && (
        <button className="sky-back" onClick={backToName}>
          <span aria-hidden="true">←</span> Back to {dedication.name}
        </button>
      )}

      {status === 'ready' && !exploring && (
        <div className="sky-intro">
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
      )}

      {info?.selection && (
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

      {exploring && (
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

      <button className="sky-credits-toggle" onClick={() => setShowCredits((v) => !v)} aria-expanded={showCredits}>
        Data credits
      </button>
      {showCredits && (
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
