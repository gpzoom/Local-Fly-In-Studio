# Phase 3: Media Ingestion + Destination Resolution — Design Spec

Date: 2026-09-16
Status: Approved for implementation planning

## Context

Local Fly-In Studio's full product scope is defined in:

- `../../../Local-Fly-In-Studio — Product Requirements Document v3.0.md`
  (sibling repo root, one level up)
- `../../../Claude Code Build Prompt — Local-Fly-In-Studio v3.0.md`

The project is decomposed into six phases. Phase 1 (Foundation — scaffold,
Zod data model, OPFS/IndexedDB persistence) and Phase 2 (Timeline Engine
Core — compiler, evaluator, easing, camera interpolation, scaling) are
complete and merged. This spec covers Phase 3: client-side services that
extract usable metadata from a storefront photo (GPS, capture time,
orientation), handle HEIC/HEIF conversion, and resolve a `Destination`
through the PRD's priority chain.

Remaining phases after this one: Phase 4 (Cesium map + Quick Create/Studio
UI + playback), Phase 5 (compositor + export), Phase 6 (templates, bulk
edit, relinking, polish, README).

## Goal

Pure-as-possible TypeScript service modules that:
1. Extract GPS coordinates, capture timestamp, and orientation from a
   photo's EXIF data.
2. Detect HEIC/HEIF files and convert them to a browser-renderable format
   client-side, with a clear failure mode when decoding isn't possible.
3. Resolve a `Destination` (Phase 1's exact model) through four distinct
   sources: photo GPS (automatic), device geolocation (explicit,
   permission-gated), address geocoding via the U.S. Census Geocoder
   (explicit), and manual coordinates (explicit).

No UI, no scene-building, no "create a draft" orchestration — Phase 4
combines this phase's outputs with Phase 1's storage and Phase 2's
timeline templates to build that.

## New Dependencies

- `exifr` — browser-compatible EXIF parser, already named in the
  project's tech stack but not yet installed.
- `heic2any` — client-side HEIC→JPEG conversion, per the build prompt's
  "a client-side HEIC conversion library may be used if needed."

Both are added to `package.json` `dependencies` (runtime-needed, not
dev-only).

## Design Decision: Dependency Injection Instead of jsdom

This phase is the first to touch real browser APIs beyond what Phase 1
already established a pattern for (OPFS). Rather than adding jsdom as a
test-environment dependency, every browser-API-touching function takes an
optional last parameter defaulting to the real browser call, exactly
mirroring Phase 1's `createOpfsMediaStore(root?: FileSystemDirectoryHandle)`
precedent. Tests inject a fake implementation; production code gets the
real one implicitly. Vitest continues to run in `environment: 'node'`
project-wide — no per-file environment overrides.

The one exception worth noting: JSONP's callback registration uses
`globalThis` rather than `window`, since `globalThis` exists identically
in both a real browser and Vitest's Node environment — this needs no
injection at all, only the `document.createElement('script')` call does.

## `src/media/metadata.ts`

```ts
export interface ExtractedMediaMetadata {
  latitude?: number;
  longitude?: number;
  captureTime?: string;   // ISO 8601
  orientation?: number;
}

type ExifParseResult = {
  latitude?: number;
  longitude?: number;
  DateTimeOriginal?: Date;
  Orientation?: number;
} | undefined;

async function extractImageMetadata(
  file: File | Blob,
  parseExif: (file: File | Blob, options: unknown) => Promise<ExifParseResult> = exifr.parse,
): Promise<ExtractedMediaMetadata>
```

Calls `parseExif(file, { gps: true, tiff: true, exif: true })` (exifr's
convenience GPS-to-decimal conversion means no manual DMS math is needed
on our side), then maps the result: `latitude`/`longitude` pass through
directly when both are present and finite; `DateTimeOriginal` (a `Date`
per exifr's default behavior) becomes `captureTime` via
`.toISOString()`; `Orientation` passes through as-is. Any field absent
from the parse result is simply omitted from the returned object (not an
error — "photo has no GPS" is an expected, common case per PRD §65). If
`parseExif` itself throws (corrupt/unreadable file), the function catches
it and returns `{}` — a photo with unreadable EXIF is not fatal to media
import, it just means no GPS-based destination.

**Implementation note:** exifr's exact return shape should be verified
against the installed package version's TypeScript types during
implementation (its GPS convenience fields and `DateTimeOriginal` behavior
are well-documented but this spec's field names are based on
documentation, not a verified install) — adjust field names if the
installed version differs; the mapping logic and test structure stay the
same either way.

## `src/media/imageDecoder.ts`

```ts
const HEIC_MIME_TYPES = ['image/heic', 'image/heif'];
const HEIC_EXTENSIONS = ['.heic', '.heif'];

function isHeic(file: File): boolean
```

Checks `file.type` against `HEIC_MIME_TYPES` (lowercased) OR the
filename's extension against `HEIC_EXTENSIONS` — mobile OSes frequently
hand off HEIC files with an empty or generic MIME type, so extension is a
necessary fallback, not a redundant check.

```ts
async function canDecodeNatively(
  file: File,
  decodeCheck: (file: File) => Promise<boolean> = defaultDecodeCheck,
): Promise<boolean>
```

`defaultDecodeCheck` attempts `createImageBitmap(file)` and returns
`true`/`false` based on success/failure (catching the exception, not
propagating it — an inability to decode is an expected outcome to check
for, not an error condition).

```ts
interface HeicConversionResult {
  ok: true;
  blob: Blob;
} | {
  ok: false;
  error: string;
}

async function convertHeicToJpeg(
  file: File,
  convert: (file: File) => Promise<Blob> = defaultHeic2AnyConvert,
): Promise<HeicConversionResult>
```

`defaultHeic2AnyConvert` wraps the `heic2any` library call
(`heic2any({ blob: file, toType: 'image/jpeg' })`). Returns a typed
result rather than throwing, per PRD §65 ("failure to decode a format
must produce a clear message rather than silently failing") — the
`error` string is a human-readable message, not a raw stack trace,
consumed later by Phase 4's error-display UI.

## `src/destination/censusGeocoder.ts`

```ts
export interface GeocodeResult {
  matchedAddress: string;
  latitude: number;
  longitude: number;
}

export interface GeocodingProvider {
  geocode(address: string): Promise<GeocodeResult | null>;
}

interface JsonpOptions {
  injectScript?: (src: string) => () => void;  // returns a cleanup function; defaults to real
                                                 // document.createElement('script') + a cleanup
                                                 // closure that removes it
  timeoutMs?: number;                           // default 10000
}

async function censusGeocode(address: string, options?: JsonpOptions): Promise<GeocodeResult | null>

export const censusGeocoderProvider: GeocodingProvider = { geocode: censusGeocode };
```

Builds the Census Geocoder's one-line address endpoint URL with a unique
global callback name (`_censusGeocoderCallback_<random>`), registers the
callback on `globalThis` before injecting the script tag, and resolves
based on the callback's payload:
- A match → `GeocodeResult` with the first candidate's matched address
  and coordinates.
- No candidates → `null` (a "not found," not an error).
- Timeout (script never calls back within `timeoutMs`) → resolves `null`
  as well, since a stalled Census endpoint should present the same "try
  something else" UX as a genuine no-match, not surface a raw network
  error string to the end user — the timeout is still distinguishable
  internally for logging/debugging via a rejected internal promise that
  the public function catches.

Always cleans up: deletes the `globalThis` callback and calls the cleanup
function `injectScript` returned, regardless of success, failure, or
timeout — no leaked globals across calls. Tests inject a fake
`injectScript` that returns a spy/no-op cleanup function, so cleanup
behavior (was it called exactly once, on every code path) is directly
assertable without needing a real or fake DOM at all.

## `src/destination/geolocation.ts`

```ts
export interface DeviceLocationResult {
  latitude: number;
  longitude: number;
}

async function getDeviceLocation(
  geo: Pick<Geolocation, 'getCurrentPosition'> = navigator.geolocation,
  timeoutMs = 10000,
): Promise<DeviceLocationResult>
```

Promisifies `geo.getCurrentPosition(success, error, { timeout: timeoutMs })`.
Rejects (does not silently swallow) on permission denial or timeout —
unlike the geocoder's "absorb into null," a device-location failure is
something the calling UI needs to distinguish (denied vs. unavailable vs.
timed out) to show the right next step, so this function surfaces the
browser's `GeolocationPositionError` (or a constructed equivalent)
rather than collapsing it to `null`.

## `src/destination/resolver.ts`

```ts
import type { Destination } from '../models/project';
import type { ExtractedMediaMetadata } from '../media/metadata';
import { censusGeocoderProvider, type GeocodingProvider } from './censusGeocoder';
import { getDeviceLocation } from './geolocation';

function resolveFromPhotoGps(metadata: ExtractedMediaMetadata): Destination | null

async function resolveFromDeviceLocation(
  geo?: Pick<Geolocation, 'getCurrentPosition'>,
): Promise<Destination>

async function resolveFromAddress(
  address: string,
  geocoder: GeocodingProvider = censusGeocoderProvider,
): Promise<Destination>

function resolveManual(latitude: number, longitude: number): Destination
```

Four separate, explicitly-invoked functions — deliberately not a single
auto-chaining `resolve()`. `resolveFromPhotoGps` returns `null` (not a
`Destination`) when the metadata has no usable coordinates, letting the
caller (Phase 4 UI) decide what to offer next; it never touches a browser
permission prompt. `resolveFromDeviceLocation` and `resolveFromAddress`
are only ever called after the user explicitly chooses that fallback (a
UI button click in Phase 4) — this is the direct implementation of the
PRD's "do not request device-location permission until the user
explicitly chooses that fallback." Each function returns a `Destination`
with the correct `source` discriminant (`'photo-gps'`,
`'device-location'`, `'address'`, `'manual'`) and the appropriate
`originalAddress`/`matchedAddress` fields populated for the address case,
matching Phase 1's `Destination` schema exactly — no new fields, no schema
changes.

## Testing (Vitest, `environment: 'node'` throughout)

- **metadata.ts**: valid GPS + timestamp + orientation present; GPS
  absent (common case, not an error); `parseExif` throwing (corrupt
  file) handled gracefully; `DateTimeOriginal` correctly converted to
  ISO string.
- **imageDecoder.ts**: `isHeic` true for both MIME-type and
  extension-only signals, false for JPEG/PNG/WebP; `canDecodeNatively`
  true/false via injected decode-check; `convertHeicToJpeg` success and
  failure paths via injected convert function, confirming the failure
  path returns `{ok: false, error}` rather than throwing.
- **censusGeocoder.ts**: successful match, no-match (`null`), timeout
  (`null`, verified via fake timers or a manually-controlled promise),
  and confirms the returned cleanup function was called exactly once and
  the `globalThis` callback was deleted after each call (no leak) — using
  an injected `injectScript` spy that returns its own cleanup spy,
  manually invoking `globalThis[callbackName](...)` to simulate the
  JSONP response.
- **geolocation.ts**: success, permission-denied rejection,
  timeout rejection — via an injected fake `geo` object.
- **resolver.ts**: each of the four functions produces a `Destination`
  with the correct `source` and field values; `resolveFromPhotoGps`
  returns `null` when metadata has no coordinates.

## Out of Scope for Phase 3

Video metadata (duration/dimensions) — deferred to Phase 4 when the
interior-video import UI needs it. Any UI/React components. The "create
draft" orchestration algorithm (PRD's `createDraft` in the build prompt's
"QUICK CREATE DRAFT ALGORITHM" section) — that composes this phase's
outputs with Phase 1 storage and Phase 2 timeline templates, and belongs
in Phase 4. Scene creation (`StorefrontScene`, `MapScene` generation from
a template).

## Acceptance Criteria

- All new Vitest suites (metadata, imageDecoder, censusGeocoder,
  geolocation, resolver) pass.
- `npm run build` succeeds.
- `exifr` and `heic2any` are the only new entries in `package.json`
  `dependencies`.
