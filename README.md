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
sets like a real constellation; "Find Ruchika" turns the view back to it.

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

## Update The Date

The placeholder countdown target lives in `src/countdown.ts`:

```ts
export const birthdayTarget = '2027-01-01T00:00:00+06:30'
```

Replace it when the real birthday date is ready.
