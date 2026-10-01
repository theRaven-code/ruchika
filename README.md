# Ruchika Birthday Countdown

A placeholder birthday countdown on top of a real, interactive sky as seen from
IIT Mandi (Kamand Valley, Himachal Pradesh, 31.77°N 76.98°E).

## Run Locally

```bash
npm install
npm run dev
```

## The Sky

By default the page shows tonight's darkest sky (the least moonlit moment near
22:00 IST) running in real time, with **RUCHIKA** written in stars and the
countdown hanging underneath. The name is fixed to the stars, so it drifts and
sets like a real constellation.

- The view starts away from the name. While five lines appear one at a time, the sky
  turns toward her. Ruchika and the countdown appear only once that turn arrives,
  and they stay on the same line if you look around afterwards.
- The name's stars glint, and a wave of light runs through the letters every
  few seconds. Shooting stars fall now and then (only when the sky is dark).
- The countdown rolls each digit like an odometer, with sparkles that pulse
  every second. It counts to **14 December, 00:00 IST** and rolls over to the
  next year automatically; on the day itself it shows "Happy Birthday" with a
  meteor shower.
- "Focus on Ruchika" swoops the camera back to the name and sends a burst of
  light and a few meteors through it.

"Explore the sky" reveals the full controls; "Back to Ruchika" returns to the
default view:

- Drag to look around, scroll or pinch to zoom, arrow keys and `+`/`-` also work.
- Click a star, planet, the Sun or the Moon to see its details.
- Time presets: **Dawn** (Sun 10° below the horizon), **Morning** (just after
  the Sun clears the Kamand ridges), **Night** and **Now**. The slider, date
  picker and speed buttons scrub or time-lapse the sky.
- Filters: Name, Constellations, Constellation Art, Azimuthal Grid, Equatorial
  Grid, Atmosphere, Landscape, Milky Way and Star Names.

The name, caption and countdown are configured in `src/App.tsx`; letter shapes
for the star lettering (A–Z) live in `src/sky/nameGlyphs.ts`.

Everything is computed for the real location and time: star positions come from
the HYG catalogue, Sun/Moon/planets from Astronomy Engine, and the mountains on
the horizon are the actual ridges around campus, ray-traced from SRTM elevation
data. Turning the atmosphere off shows the stars in daytime, as in Stellarium.

Code lives in `src/sky/`:

| File | Role |
| --- | --- |
| `SkyViewer.tsx` | React UI: toolbar, time panel, selection card |
| `SkyEngine.ts` | three.js renderer, navigation, time, labels, picking |
| `astro.ts`, `time.ts` | Coordinate frames, ephemerides, presets (IST) |
| `shaders.ts` | Stereographic projection and the atmosphere model |
| `layers/` | Milky Way + sky, stars, lines/grids, constellation art, Sun/Moon/planets, landscape |

## Sky Data

The files in `public/sky/` are generated from public datasets:

```bash
npm run sky:data                          # stars, constellations, art, Milky Way, horizon
python3 scripts/sky-data/prepare-moon.py  # Moon photo (needs Pillow)
```

Downloads are cached in `.cache/sky-raw/`. Sources and licenses are listed in
[`public/sky/CREDITS.md`](public/sky/CREDITS.md) and in the app's "Data
credits" panel; the CC BY-SA and Free Art License datasets require that
attribution to stay visible.

To move the observer, change `OBSERVER` in `scripts/build-sky-data.mjs` and
`src/sky/observer.ts`, then re-run `npm run sky:data`.

## The Birthday Date

The date and the time zone it is counted in live in `src/countdown.ts`:

```ts
export const birthday = { month: 12, day: 14, utcOffsetMinutes: 330 }
```
