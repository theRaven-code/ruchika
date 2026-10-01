import { Suspense, lazy } from 'react'
import { getBirthdayState } from './countdown'
import type { Dedication } from './sky/SkyEngine'

const SkyViewer = lazy(() => import('./sky/SkyViewer').then((m) => ({ default: m.SkyViewer })))

const dedication: Dedication = {
  name: 'Ruchika',
  caption: 'until your birthday · 14 December',
  celebration: { title: 'Happy Birthday', caption: '14 December' },
  countdown: () => {
    const state = getBirthdayState()
    if (state.kind === 'birthday') return null
    const { days, hours, minutes, seconds } = state.parts
    return [
      { value: days, label: 'Days' },
      { value: hours, label: 'Hours' },
      { value: minutes, label: 'Minutes' },
      { value: seconds, label: 'Seconds' },
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
