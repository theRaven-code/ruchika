import { Suspense, lazy } from 'react'
import { birthdayTarget, getCountdownParts } from './countdown'
import type { Dedication } from './sky/SkyEngine'

const SkyViewer = lazy(() => import('./sky/SkyViewer').then((m) => ({ default: m.SkyViewer })))

const dedication: Dedication = {
  name: 'Ruchika',
  caption: 'until the birthday',
  countdown: () => {
    const parts = getCountdownParts(birthdayTarget)
    return [
      { value: parts.days, label: 'Days' },
      { value: parts.hours, label: 'Hours' },
      { value: parts.minutes, label: 'Min' },
      { value: parts.seconds, label: 'Sec' },
    ]
  },
}

export default function App() {
  return (
    <>
      <h1 className="sr-only">Ruchika: birthday countdown under the night sky of IIT Mandi</h1>
      <Suspense fallback={<div className="sky-fallback" />}>
        <SkyViewer dedication={dedication} />
      </Suspense>
    </>
  )
}
