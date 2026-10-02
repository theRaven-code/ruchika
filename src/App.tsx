import { Suspense, lazy } from 'react'
import { getBirthdayState } from './countdown'
import type { Dedication } from './sky/SkyEngine'

const SkyViewer = lazy(() => import('./sky/SkyViewer').then((m) => ({ default: m.SkyViewer })))

const dedication: Dedication = {
  name: 'Ruchika',
  caption: 'counting every night until 14 December',
  celebration: { title: 'Happy Birthday', caption: '14 December' },
  verses: [
    'I may have forgotten your birthday many a times,',
    "But love, I've specificially planned this thing since the Valentines day ", 
    "Although, I understand that I haven't been the best partner,", 
    "All I ever loved this much is you",
    'I love you so much and there is no bound to it,',
    "You've always told me how you liked the stars and how I never discussed about it",
    "Now you find me counting the stars,",
    "For I've got nothing better to do but, ",
    "wait for your stars to align with mine",
    "counting every second until your birthday", 
  ],
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
