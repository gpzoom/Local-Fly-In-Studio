# Local Fly-In Studio

A browser-based editor for creating cinematic "fly-in" location videos for
local businesses: a geographic camera flight from orbit down to a storefront,
followed by a storefront reveal and an interior photo/video tour — all
running client-side, with no backend and no paid mapping subscription.

Start from a single geotagged storefront photo and a handful of interior
photos/videos; the app resolves the business's location, builds a
destination-relative map fly-in automatically, and assembles an editable
draft you can fine-tune and export.

## Quick start

```bash
npm install
npm run dev      # starts the Vite dev server
```

Other scripts:

```bash
npm run build           # type-check (tsc -b) then production build (vite build)
npm run test            # run the Vitest suite
npm run lint            # eslint .
npm run preview:worker  # serve the built dist/ through a local Cloudflare Worker (wrangler dev)
npm run deploy          # build, then deploy to Cloudflare Workers (wrangler deploy)
```

No environment variables or API keys are required. Map imagery comes from
USGS's public WMTS service (no Cesium ion, no API key).

## Deployment

The app is a static, fully client-side bundle — deployment is just serving
`dist/` from Cloudflare Workers' static assets, with no Worker script and
no server-side code. Configuration lives in `wrangler.jsonc`. The first
deploy requires `wrangler login` (a one-time interactive Cloudflare
authentication); after that, `npm run deploy` builds and publishes to your
`local-fly-in-studio.<your-subdomain>.workers.dev` URL.

## How it works

1. **Quick Create** — pick a storefront photo (its GPS EXIF data resolves
   the destination; an address or map click covers photos with no GPS) and
   optionally add interior photos/videos. A draft project is generated
   immediately: a 6-stop map fly-in (Earth → region → metro → city →
   neighborhood → business), a storefront reveal, and — if any interior
   media was added — an Interior Tour with automatically alternating photo
   motion.
2. **Studio** — the full editor: adjust waypoint timing/easing on the map,
   set the storefront's front-door target, reorder/trim/retime interior
   items, apply bulk edits across the whole Interior Tour, save the
   project's current styling as a reusable template, and relink any media
   asset that's gone missing from browser storage.
3. **Export** — a real-time Output Compositor renders the timeline to a
   downloadable video via `MediaRecorder`, in one of four variants
   (Complete / Fly-In Only / Fly-In + Storefront / Interior Tour Only).

Everything — project data and media files alike — is stored locally in the
browser (Origin Private File System when available, IndexedDB otherwise).
Nothing is uploaded to a server.

## Tech stack

- **React 19** + **TypeScript**, built with **Vite**
- **CesiumJS** for the 3D globe/map (USGS imagery, no Cesium ion)
- **Zustand** for app state, **Zod** for schema validation and migrations
- **idb** (IndexedDB) and the Origin Private File System for local
  persistence
- **exifr** for photo GPS/EXIF extraction, **heic2any** for HEIC/HEIF
  conversion
- **dnd-kit** for drag-to-reorder in the timeline
- **Vitest** for the test suite (runs in `environment: 'node'` — no jsdom;
  UI components are verified manually in a real browser instead)

## Project structure

```
src/
  models/        Zod schemas: Project, scenes, media assets, templates
  persistence/    IndexedDB-backed repositories, schema migrations
  media/         Local media storage (OPFS/IndexedDB), import/decode helpers
  destination/    GPS/address/geocoding resolution
  timeline/       Waypoint compilation, evaluation, scaling, bulk edit
  quickCreate/    Draft-generation pipeline (createDraft)
  cesium/         Cesium viewer setup, camera state application
  export/         Output Compositor: frame compositing, audio graph, MediaRecorder driver
  components/     React UI, organized by area (quick-create/, studio/, inspectors/, timeline/, preview/)
  store/          Zustand stores
  tests/          Vitest suites (mirrors the src/ layout)
docs/superpowers/
  specs/          Design specs for each phase of this project's build
  plans/          Implementation plans for each phase
```

Each phase of this project's development has a paired spec + plan under
`docs/superpowers/`, in build order — useful background if you're trying to
understand why a particular piece is shaped the way it is.

## Known limitations

- **HEIC detection** relies on file extension and MIME type; a HEIC file
  with both misreported will slip past conversion and fail to decode.
- **Video codec support** isn't probed ahead of time — an unsupported codec
  surfaces as a generic "could not read video metadata" message rather
  than a codec-specific one.
- **Project JSON import** doesn't exist yet — only the app's own local
  IndexedDB-backed project storage is supported. (There's also no "export
  project JSON" yet.)
- Exports run in real time (the timeline plays through once while being
  recorded), not faster-than-real-time.
