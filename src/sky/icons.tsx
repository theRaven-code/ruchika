import type { ReactNode } from 'react'
import type { LayerKey } from './SkyEngine'

function Icon({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

/** A phone tipped up toward a star. */
export const HOLD_UP_ICON = (
  <Icon size={17}>
    <rect x="5" y="8.5" width="8" height="13" rx="1.8" transform="rotate(-16 9 15)" />
    <path d="M18 2.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9Z" />
  </Icon>
)

export const LAYER_ICONS: Record<LayerKey, ReactNode> = {
  name: (
    <Icon>
      <path d="M12 3.5 13.6 9l5.4 1.6-5.4 1.6L12 17.7l-1.6-5.5L5 10.6 10.4 9Z" />
      <path d="M18.5 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7Z" />
    </Icon>
  ),
  constellations: (
    <Icon>
      <path d="M4 17 9 8l6 4 5-7" />
      <circle cx="4" cy="17" r="1.6" fill="currentColor" />
      <circle cx="9" cy="8" r="1.6" fill="currentColor" />
      <circle cx="15" cy="12" r="1.6" fill="currentColor" />
      <circle cx="20" cy="5" r="1.6" fill="currentColor" />
    </Icon>
  ),
  art: (
    <Icon>
      <path d="M12 3c-1.8 2-2 4.4-.6 6.2M7 21c.4-4 2-6.6 5-7.6 3 1 4.6 3.6 5 7.6" />
      <circle cx="12" cy="11" r="2.4" />
      <path d="M6 9.5 3.5 7M18 9.5 20.5 7" />
    </Icon>
  ),
  azimuthal: (
    <Icon>
      <path d="M3 18h18" />
      <path d="M4.5 18a7.5 7.5 0 0 1 15 0" />
      <path d="M8 18a4 7.5 0 0 1 8 0" />
      <path d="M12 10.5V18" />
      <path d="M5.8 14.2h12.4" />
    </Icon>
  ),
  equatorial: (
    <Icon>
      <circle cx="12" cy="12" r="8.5" />
      <ellipse cx="12" cy="12" rx="3.6" ry="8.5" transform="rotate(-23 12 12)" />
      <path d="M4.6 15.7 19.4 8.3" />
      <path d="M5.6 9.4 15.3 4.6M8.7 19.4l9.7-4.8" opacity="0.7" />
    </Icon>
  ),
  atmosphere: (
    <Icon>
      <circle cx="12" cy="14" r="3.2" />
      <path d="M3 18.5c3-1.4 6-2 9-2s6 .6 9 2" />
      <path d="M12 6.5V8.5M6.3 9.2l1.4 1.4M17.7 9.2l-1.4 1.4M4 14h1.8M18.2 14H20" />
    </Icon>
  ),
  landscape: (
    <Icon>
      <path d="m2.5 19 6-9 3.5 5 2.5-3.5 7 7.5Z" />
      <path d="m7 12.2 1.5 1.3 1.6-1.1" />
    </Icon>
  ),
  milkyway: (
    <Icon>
      <path d="M3 16c4-1 6-6 10-7.5S20 9 21 7" />
      <path d="M3.5 19c5-1.2 8-6 12-7.2 2.2-.6 4 .1 5 .7" opacity="0.65" />
      <circle cx="7" cy="7" r="0.9" fill="currentColor" />
      <circle cx="17" cy="17" r="0.9" fill="currentColor" />
      <circle cx="12" cy="4.5" r="0.7" fill="currentColor" />
    </Icon>
  ),
  labels: (
    <Icon>
      <path d="M4 7.5V5h9v2.5M8.5 5v12M6.5 17h4" />
      <path d="M14 11.5v-1.5h6v1.5M17 10v7M15.8 17h2.4" />
    </Icon>
  ),
}
