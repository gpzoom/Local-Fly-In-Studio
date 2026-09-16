# Phase 3: Media Ingestion + Destination Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build client-side services that extract EXIF/GPS metadata from photos, detect and convert HEIC/HEIF files, and resolve a `Destination` (Phase 1's exact model) through four explicit sources — photo GPS, device location, address geocoding via the U.S. Census Geocoder, and manual coordinates.

**Architecture:** Five focused modules under `src/media/` (metadata, image decoding) and `src/destination/` (geocoding, geolocation, resolution), each testable via dependency injection of the one browser-API call it needs — continuing Phase 1's `createOpfsMediaStore(root?)` precedent rather than adding jsdom.

**Tech Stack:** TypeScript (strict), Vitest, `exifr` (new dependency), `heic2any` (new dependency).

**Spec:** `docs/superpowers/specs/2026-09-16-phase-3-media-ingestion-design.md`

## Global Constraints

- TypeScript strict mode (`strict: true`); no `any` (typed casts like `globalThis as Record<string, unknown>` are fine — that's not `any`).
- Only `exifr` and `heic2any` are added as new dependencies.
- No jsdom, no new test-environment dependencies — every browser-API call is dependency-injected with a real default and a test-supplied fake, per the spec's design decision.
- Vitest continues in `environment: 'node'` project-wide — no per-file environment overrides.
- Known-absent data (no GPS on a photo, no address match, HEIC conversion failure) returns a typed empty/null/error result — these functions never throw for expected "not found" cases. Genuine failures (corrupt EXIF, browser decode failure) are also caught and converted to typed results, not propagated as exceptions, per PRD §65.
- `resolveFromDeviceLocation` and `resolveFromAddress` must never be called automatically by any code in this phase — they exist to be invoked by a future UI action, never as part of an auto-chaining resolution.

---

### Task 1: Image Metadata Extraction (EXIF/GPS)

**Files:**
- Create: `src/media/metadata.ts`
- Test: `src/tests/metadata.test.ts`

**Interfaces:**
- Consumes: `exifr` (new dependency).
- Produces: `interface ExtractedMediaMetadata { latitude?: number; longitude?: number; captureTime?: string; orientation?: number }`; `extractImageMetadata(file: File | Blob, parseExif?: ParseExifFn): Promise<ExtractedMediaMetadata>` — consumed by Task 5 (`resolveFromPhotoGps`).

- [ ] **Step 1: Install exifr**

```bash
npm install exifr
```

- [ ] **Step 2: Write the failing test**

`src/tests/metadata.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractImageMetadata } from '../media/metadata';

describe('extractImageMetadata', () => {
  it('extracts GPS coordinates when present', async () => {
    const fakeParse = async () => ({ latitude: 40.7128, longitude: -74.006 });
    const metadata = await extractImageMetadata(new Blob(), fakeParse);
    expect(metadata.latitude).toBe(40.7128);
    expect(metadata.longitude).toBe(-74.006);
  });

  it('omits GPS fields when absent, without treating it as an error', async () => {
    const fakeParse = async () => ({});
    const metadata = await extractImageMetadata(new Blob(), fakeParse);
    expect(metadata.latitude).toBeUndefined();
    expect(metadata.longitude).toBeUndefined();
  });

  it('converts DateTimeOriginal to an ISO capture time string', async () => {
    const date = new Date('2026-01-15T10:30:00.000Z');
    const fakeParse = async () => ({ DateTimeOriginal: date });
    const metadata = await extractImageMetadata(new Blob(), fakeParse);
    expect(metadata.captureTime).toBe('2026-01-15T10:30:00.000Z');
  });

  it('passes through orientation when present', async () => {
    const fakeParse = async () => ({ Orientation: 6 });
    const metadata = await extractImageMetadata(new Blob(), fakeParse);
    expect(metadata.orientation).toBe(6);
  });

  it('returns an empty object when parseExif throws (corrupt file)', async () => {
    const fakeParse = async (): Promise<never> => {
      throw new Error('corrupt EXIF');
    };
    const metadata = await extractImageMetadata(new Blob(), fakeParse);
    expect(metadata).toEqual({});
  });

  it('returns an empty object when parseExif resolves undefined', async () => {
    const fakeParse = async () => undefined;
    const metadata = await extractImageMetadata(new Blob(), fakeParse);
    expect(metadata).toEqual({});
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- metadata.test.ts`
Expected: FAIL — cannot resolve `../media/metadata`.

- [ ] **Step 4: Implement src/media/metadata.ts**

```ts
import exifr from 'exifr';

export interface ExtractedMediaMetadata {
  latitude?: number;
  longitude?: number;
  captureTime?: string;
  orientation?: number;
}

interface ExifParseResult {
  latitude?: number;
  longitude?: number;
  DateTimeOriginal?: Date;
  Orientation?: number;
}

export type ParseExifFn = (
  file: File | Blob,
  options?: unknown,
) => Promise<ExifParseResult | undefined>;

export async function extractImageMetadata(
  file: File | Blob,
  parseExif: ParseExifFn = exifr.parse as ParseExifFn,
): Promise<ExtractedMediaMetadata> {
  let result: ExifParseResult | undefined;
  try {
    result = await parseExif(file, { gps: true, tiff: true, exif: true });
  } catch {
    return {};
  }

  if (!result) return {};

  const metadata: ExtractedMediaMetadata = {};

  if (
    typeof result.latitude === 'number' &&
    Number.isFinite(result.latitude) &&
    typeof result.longitude === 'number' &&
    Number.isFinite(result.longitude)
  ) {
    metadata.latitude = result.latitude;
    metadata.longitude = result.longitude;
  }

  if (result.DateTimeOriginal instanceof Date && !Number.isNaN(result.DateTimeOriginal.getTime())) {
    metadata.captureTime = result.DateTimeOriginal.toISOString();
  }

  if (typeof result.Orientation === 'number') {
    metadata.orientation = result.Orientation;
  }

  return metadata;
}
```

**Note for the implementer:** verify `exifr`'s actual TypeScript types after installing (`node_modules/exifr/index.d.ts` or similar) — if the installed version's `parse` signature or field names differ from what's assumed above (e.g. `Orientation` typed as an enum object rather than `number`), adjust the `ExifParseResult` interface and the default parameter's cast accordingly. The mapping logic and every test above stay correct regardless — only the type annotations might need tweaking.

- [ ] **Step 5: Run tests, verify pass**

Run: `npm run test -- metadata.test.ts`
Expected: PASS, all 6 tests green.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/media/metadata.ts src/tests/metadata.test.ts
git commit -m "feat: add EXIF/GPS metadata extraction"
```

---

### Task 2: HEIC/HEIF Detection and Conversion

**Files:**
- Create: `src/media/imageDecoder.ts`
- Test: `src/tests/imageDecoder.test.ts`

**Interfaces:**
- Consumes: `heic2any` (new dependency).
- Produces: `isHeic(file: File): boolean`; `canDecodeNatively(file: File, decodeCheck?: (file: File) => Promise<boolean>): Promise<boolean>`; `type HeicConversionResult = { ok: true; blob: Blob } | { ok: false; error: string }`; `convertHeicToJpeg(file: File, convert?: (file: File) => Promise<Blob>): Promise<HeicConversionResult>`.

- [ ] **Step 1: Install heic2any**

```bash
npm install heic2any
```

If TypeScript reports it cannot find type declarations for `heic2any` after this task's implementation step, try `npm install -D @types/heic2any` first; if that package does not exist on npm, instead create `src/types/heic2any.d.ts` with a minimal ambient declaration:

```ts
declare module 'heic2any' {
  interface Heic2AnyOptions {
    blob: Blob;
    toType?: string;
    quality?: number;
  }
  export default function heic2any(options: Heic2AnyOptions): Promise<Blob | Blob[]>;
}
```

- [ ] **Step 2: Write the failing test**

`src/tests/imageDecoder.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isHeic, canDecodeNatively, convertHeicToJpeg } from '../media/imageDecoder';

function makeFile(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe('isHeic', () => {
  it('returns true for image/heic MIME type', () => {
    expect(isHeic(makeFile('photo.heic', 'image/heic'))).toBe(true);
  });

  it('returns true for image/heif MIME type', () => {
    expect(isHeic(makeFile('photo.heif', 'image/heif'))).toBe(true);
  });

  it('returns true based on .heic extension when MIME type is empty', () => {
    expect(isHeic(makeFile('IMG_1234.HEIC', ''))).toBe(true);
  });

  it('returns false for JPEG, PNG, and WebP', () => {
    expect(isHeic(makeFile('photo.jpg', 'image/jpeg'))).toBe(false);
    expect(isHeic(makeFile('photo.png', 'image/png'))).toBe(false);
    expect(isHeic(makeFile('photo.webp', 'image/webp'))).toBe(false);
  });
});

describe('canDecodeNatively', () => {
  it('returns true when the injected decode check succeeds', async () => {
    const result = await canDecodeNatively(makeFile('a.heic', 'image/heic'), async () => true);
    expect(result).toBe(true);
  });

  it('returns false when the injected decode check fails', async () => {
    const result = await canDecodeNatively(makeFile('a.heic', 'image/heic'), async () => false);
    expect(result).toBe(false);
  });
});

describe('convertHeicToJpeg', () => {
  it('returns ok:true with the converted blob on success', async () => {
    const jpegBlob = new Blob([new Uint8Array([9, 9, 9])], { type: 'image/jpeg' });
    const result = await convertHeicToJpeg(makeFile('a.heic', 'image/heic'), async () => jpegBlob);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.blob).toBe(jpegBlob);
    }
  });

  it('returns ok:false with a human-readable error instead of throwing', async () => {
    const failingConvert = async (): Promise<Blob> => {
      throw new Error('decode failed');
    };
    const result = await convertHeicToJpeg(makeFile('a.heic', 'image/heic'), failingConvert);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('decode failed');
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- imageDecoder.test.ts`
Expected: FAIL — cannot resolve `../media/imageDecoder`.

- [ ] **Step 4: Implement src/media/imageDecoder.ts**

```ts
import heic2any from 'heic2any';

const HEIC_MIME_TYPES = ['image/heic', 'image/heif'];
const HEIC_EXTENSIONS = ['.heic', '.heif'];

export function isHeic(file: File): boolean {
  const mimeType = file.type.toLowerCase();
  if (HEIC_MIME_TYPES.includes(mimeType)) return true;

  const name = file.name.toLowerCase();
  return HEIC_EXTENSIONS.some((ext) => name.endsWith(ext));
}

async function defaultDecodeCheck(file: File): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(file);
    bitmap.close();
    return true;
  } catch {
    return false;
  }
}

export async function canDecodeNatively(
  file: File,
  decodeCheck: (file: File) => Promise<boolean> = defaultDecodeCheck,
): Promise<boolean> {
  return decodeCheck(file);
}

export type HeicConversionResult = { ok: true; blob: Blob } | { ok: false; error: string };

async function defaultHeic2AnyConvert(file: File): Promise<Blob> {
  const result = await heic2any({ blob: file, toType: 'image/jpeg' });
  return Array.isArray(result) ? result[0] : result;
}

export async function convertHeicToJpeg(
  file: File,
  convert: (file: File) => Promise<Blob> = defaultHeic2AnyConvert,
): Promise<HeicConversionResult> {
  try {
    const blob = await convert(file);
    return { ok: true, blob };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown HEIC conversion error';
    return { ok: false, error: `Could not convert HEIC image: ${message}` };
  }
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npm run test -- imageDecoder.test.ts`
Expected: PASS, all 8 tests green.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/media/imageDecoder.ts src/tests/imageDecoder.test.ts
git add src/types/heic2any.d.ts 2>/dev/null || true
git commit -m "feat: add HEIC/HEIF detection and conversion"
```

---

### Task 3: Census Geocoder (JSONP)

**Files:**
- Create: `src/destination/censusGeocoder.ts`
- Test: `src/tests/censusGeocoder.test.ts`

**Interfaces:**
- Consumes: none (no dependency on Tasks 1-2).
- Produces: `interface GeocodeResult { matchedAddress: string; latitude: number; longitude: number }`; `interface GeocodingProvider { geocode(address: string): Promise<GeocodeResult | null> }`; `censusGeocode(address: string, options?: { injectScript?: (src: string) => () => void; timeoutMs?: number }): Promise<GeocodeResult | null>`; `censusGeocoderProvider: GeocodingProvider` — consumed by Task 5's `resolveFromAddress`.

- [ ] **Step 1: Write the failing tests**

`src/tests/censusGeocoder.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { censusGeocode } from '../destination/censusGeocoder';

afterEach(() => {
  vi.useRealTimers();
});

function injectScriptResolvingWith(response: unknown) {
  return vi.fn((src: string) => {
    const url = new URL(src);
    const callbackName = url.searchParams.get('callback')!;
    queueMicrotask(() => {
      (globalThis as Record<string, unknown>)[callbackName](response);
    });
    return vi.fn();
  });
}

describe('censusGeocode', () => {
  it('resolves a match from the JSONP callback', async () => {
    const injectScript = injectScriptResolvingWith({
      result: {
        addressMatches: [
          { matchedAddress: '123 MAIN ST, ANYTOWN, ST, 12345', coordinates: { x: -74.006, y: 40.7128 } },
        ],
      },
    });

    const result = await censusGeocode('123 Main St', { injectScript });

    expect(result).toEqual({
      matchedAddress: '123 MAIN ST, ANYTOWN, ST, 12345',
      latitude: 40.7128,
      longitude: -74.006,
    });
  });

  it('calls the cleanup function returned by injectScript exactly once on success', async () => {
    const cleanupSpy = vi.fn();
    const injectScript = vi.fn((src: string) => {
      const url = new URL(src);
      const callbackName = url.searchParams.get('callback')!;
      queueMicrotask(() => {
        (globalThis as Record<string, unknown>)[callbackName]({ result: { addressMatches: [] } });
      });
      return cleanupSpy;
    });

    await censusGeocode('123 Main St', { injectScript });
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it('resolves null when there are no address matches', async () => {
    const injectScript = injectScriptResolvingWith({ result: { addressMatches: [] } });
    const result = await censusGeocode('nonexistent address', { injectScript });
    expect(result).toBeNull();
  });

  it('resolves null on timeout and cleans up', async () => {
    vi.useFakeTimers();
    const cleanupSpy = vi.fn();
    const injectScript = vi.fn(() => cleanupSpy); // never invokes the callback

    const promise = censusGeocode('slow address', { injectScript, timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;

    expect(result).toBeNull();
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it('deletes the globalThis callback after resolving, leaving no leaked global', async () => {
    let capturedCallbackName = '';
    const injectScript = vi.fn((src: string) => {
      const url = new URL(src);
      capturedCallbackName = url.searchParams.get('callback')!;
      queueMicrotask(() => {
        (globalThis as Record<string, unknown>)[capturedCallbackName]({ result: { addressMatches: [] } });
      });
      return vi.fn();
    });

    await censusGeocode('123 Main St', { injectScript });
    expect(capturedCallbackName in (globalThis as Record<string, unknown>)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- censusGeocoder.test.ts`
Expected: FAIL — cannot resolve `../destination/censusGeocoder`.

- [ ] **Step 3: Implement src/destination/censusGeocoder.ts**

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
  injectScript?: (src: string) => () => void;
  timeoutMs?: number;
}

const CENSUS_GEOCODER_BASE_URL = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

function defaultInjectScript(src: string): () => void {
  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  document.head.appendChild(script);
  return () => {
    script.remove();
  };
}

function buildCallbackName(): string {
  return `_censusGeocoderCallback_${Math.random().toString(36).slice(2)}`;
}

interface CensusResponse {
  result?: {
    addressMatches?: Array<{
      matchedAddress: string;
      coordinates: { x: number; y: number };
    }>;
  };
}

export async function censusGeocode(address: string, options: JsonpOptions = {}): Promise<GeocodeResult | null> {
  const injectScript = options.injectScript ?? defaultInjectScript;
  const timeoutMs = options.timeoutMs ?? 10000;
  const callbackName = buildCallbackName();

  return new Promise<GeocodeResult | null>((resolve) => {
    let settled = false;
    let cleanupScript: () => void = () => {};

    const cleanup = () => {
      delete (globalThis as Record<string, unknown>)[callbackName];
      cleanupScript();
    };

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    }, timeoutMs);

    (globalThis as Record<string, unknown>)[callbackName] = (response: CensusResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      cleanup();

      const match = response?.result?.addressMatches?.[0];
      if (!match) {
        resolve(null);
        return;
      }

      resolve({
        matchedAddress: match.matchedAddress,
        latitude: match.coordinates.y,
        longitude: match.coordinates.x,
      });
    };

    const url = `${CENSUS_GEOCODER_BASE_URL}?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=jsonp&callback=${callbackName}`;
    cleanupScript = injectScript(url);
  });
}

export const censusGeocoderProvider: GeocodingProvider = { geocode: censusGeocode };
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test -- censusGeocoder.test.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/destination/censusGeocoder.ts src/tests/censusGeocoder.test.ts
git commit -m "feat: add Census Geocoder JSONP integration"
```

---

### Task 4: Device Geolocation

**Files:**
- Create: `src/destination/geolocation.ts`
- Test: `src/tests/geolocation.test.ts`

**Interfaces:**
- Consumes: none (no dependency on Tasks 1-3).
- Produces: `interface DeviceLocationResult { latitude: number; longitude: number }`; `type GetCurrentPosition = Pick<Geolocation, 'getCurrentPosition'>`; `getDeviceLocation(geo?: GetCurrentPosition, timeoutMs?: number): Promise<DeviceLocationResult>` — consumed by Task 5's `resolveFromDeviceLocation`.

- [ ] **Step 1: Write the failing tests**

`src/tests/geolocation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getDeviceLocation, type GetCurrentPosition } from '../destination/geolocation';

describe('getDeviceLocation', () => {
  it('resolves latitude/longitude on success', async () => {
    const fakeGeo: GetCurrentPosition = {
      getCurrentPosition: (success) => {
        success({
          coords: { latitude: 37.7749, longitude: -122.4194 },
        } as GeolocationPosition);
      },
    };

    const result = await getDeviceLocation(fakeGeo);
    expect(result).toEqual({ latitude: 37.7749, longitude: -122.4194 });
  });

  it('rejects with the browser error on permission denial', async () => {
    const permissionDeniedError = { code: 1, message: 'User denied Geolocation' } as GeolocationPositionError;
    const fakeGeo: GetCurrentPosition = {
      getCurrentPosition: (_success, error) => {
        error?.(permissionDeniedError);
      },
    };

    await expect(getDeviceLocation(fakeGeo)).rejects.toBe(permissionDeniedError);
  });

  it('rejects when the browser reports a timeout error', async () => {
    const timeoutError = { code: 3, message: 'Timeout expired' } as GeolocationPositionError;
    const fakeGeo: GetCurrentPosition = {
      getCurrentPosition: (_success, error) => {
        error?.(timeoutError);
      },
    };

    await expect(getDeviceLocation(fakeGeo, 1000)).rejects.toBe(timeoutError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- geolocation.test.ts`
Expected: FAIL — cannot resolve `../destination/geolocation`.

- [ ] **Step 3: Implement src/destination/geolocation.ts**

```ts
export interface DeviceLocationResult {
  latitude: number;
  longitude: number;
}

export type GetCurrentPosition = Pick<Geolocation, 'getCurrentPosition'>;

export async function getDeviceLocation(
  geo: GetCurrentPosition = navigator.geolocation,
  timeoutMs = 10000,
): Promise<DeviceLocationResult> {
  return new Promise<DeviceLocationResult>((resolve, reject) => {
    geo.getCurrentPosition(
      (position) => {
        resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      },
      (error) => {
        reject(error);
      },
      { timeout: timeoutMs },
    );
  });
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test -- geolocation.test.ts`
Expected: PASS, all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/destination/geolocation.ts src/tests/geolocation.test.ts
git commit -m "feat: add device geolocation service"
```

---

### Task 5: Destination Resolver

**Files:**
- Create: `src/destination/resolver.ts`
- Test: `src/tests/resolver.test.ts`

**Interfaces:**
- Consumes: `Destination` from `src/models/project.ts`; `ExtractedMediaMetadata` from `src/media/metadata.ts`; `censusGeocoderProvider`, `GeocodingProvider` from `src/destination/censusGeocoder.ts`; `getDeviceLocation`, `GetCurrentPosition` from `src/destination/geolocation.ts`.
- Produces: `resolveFromPhotoGps(metadata: ExtractedMediaMetadata): Destination | null`; `resolveFromDeviceLocation(geo?: GetCurrentPosition): Promise<Destination>`; `resolveFromAddress(address: string, geocoder?: GeocodingProvider): Promise<Destination>`; `resolveManual(latitude: number, longitude: number): Destination`.

- [ ] **Step 1: Write the failing tests**

`src/tests/resolver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  resolveFromPhotoGps,
  resolveFromDeviceLocation,
  resolveFromAddress,
  resolveManual,
} from '../destination/resolver';
import type { GeocodingProvider } from '../destination/censusGeocoder';
import type { GetCurrentPosition } from '../destination/geolocation';

describe('resolveFromPhotoGps', () => {
  it('returns a photo-gps Destination when coordinates are present', () => {
    const destination = resolveFromPhotoGps({ latitude: 40.7128, longitude: -74.006 });
    expect(destination).toEqual({ source: 'photo-gps', latitude: 40.7128, longitude: -74.006 });
  });

  it('returns null when metadata has no coordinates', () => {
    expect(resolveFromPhotoGps({})).toBeNull();
  });
});

describe('resolveFromDeviceLocation', () => {
  it('returns a device-location Destination from the injected geolocation source', async () => {
    const fakeGeo: GetCurrentPosition = {
      getCurrentPosition: (success) => {
        success({ coords: { latitude: 37.7749, longitude: -122.4194 } } as GeolocationPosition);
      },
    };
    const destination = await resolveFromDeviceLocation(fakeGeo);
    expect(destination).toEqual({ source: 'device-location', latitude: 37.7749, longitude: -122.4194 });
  });
});

describe('resolveFromAddress', () => {
  it('returns an address Destination with matched coordinates on success', async () => {
    const fakeGeocoder: GeocodingProvider = {
      geocode: async () => ({ matchedAddress: '123 MAIN ST', latitude: 40.7128, longitude: -74.006 }),
    };
    const destination = await resolveFromAddress('123 Main St', fakeGeocoder);
    expect(destination).toEqual({
      source: 'address',
      latitude: 40.7128,
      longitude: -74.006,
      originalAddress: '123 Main St',
      matchedAddress: '123 MAIN ST',
    });
  });

  it('returns a null-coordinate address Destination when the geocoder finds no match', async () => {
    const fakeGeocoder: GeocodingProvider = { geocode: async () => null };
    const destination = await resolveFromAddress('nowhere', fakeGeocoder);
    expect(destination).toEqual({
      source: 'address',
      latitude: null,
      longitude: null,
      originalAddress: 'nowhere',
    });
  });
});

describe('resolveManual', () => {
  it('returns a manual Destination with the given coordinates', () => {
    expect(resolveManual(51.5074, -0.1278)).toEqual({ source: 'manual', latitude: 51.5074, longitude: -0.1278 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- resolver.test.ts`
Expected: FAIL — cannot resolve `../destination/resolver`.

- [ ] **Step 3: Implement src/destination/resolver.ts**

```ts
import type { Destination } from '../models/project';
import type { ExtractedMediaMetadata } from '../media/metadata';
import { censusGeocoderProvider, type GeocodingProvider } from './censusGeocoder';
import { getDeviceLocation, type GetCurrentPosition } from './geolocation';

export function resolveFromPhotoGps(metadata: ExtractedMediaMetadata): Destination | null {
  if (typeof metadata.latitude !== 'number' || typeof metadata.longitude !== 'number') {
    return null;
  }
  return {
    source: 'photo-gps',
    latitude: metadata.latitude,
    longitude: metadata.longitude,
  };
}

export async function resolveFromDeviceLocation(geo?: GetCurrentPosition): Promise<Destination> {
  const location = await getDeviceLocation(geo);
  return {
    source: 'device-location',
    latitude: location.latitude,
    longitude: location.longitude,
  };
}

export async function resolveFromAddress(
  address: string,
  geocoder: GeocodingProvider = censusGeocoderProvider,
): Promise<Destination> {
  const result = await geocoder.geocode(address);
  if (!result) {
    return {
      source: 'address',
      latitude: null,
      longitude: null,
      originalAddress: address,
    };
  }
  return {
    source: 'address',
    latitude: result.latitude,
    longitude: result.longitude,
    originalAddress: address,
    matchedAddress: result.matchedAddress,
  };
}

export function resolveManual(latitude: number, longitude: number): Destination {
  return {
    source: 'manual',
    latitude,
    longitude,
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test -- resolver.test.ts`
Expected: PASS, all 6 tests green.

- [ ] **Step 5: Run the full test suite and build**

Run: `npm run test` — expect all suites (Phase 1's 10 + Phase 2's 6 + this plan's 5 new files = 21 files) passing.
Run: `npm run build` — expect success.

- [ ] **Step 6: Commit**

```bash
git add src/destination/resolver.ts src/tests/resolver.test.ts
git commit -m "feat: add destination resolver (photo GPS, device location, address, manual)"
```

---

## Phase 3 Completion Check

Phase 3 is done when all of the following hold:

- `npm run test` passes with all 21 test files green (Phase 1's 10, Phase 2's 6, and this plan's `metadata`, `imageDecoder`, `censusGeocoder`, `geolocation`, `resolver`).
- `npm run build` succeeds.
- `package.json` `dependencies` gained exactly `exifr` and `heic2any` (plus possibly `@types/heic2any` in `devDependencies`, or a local `src/types/heic2any.d.ts` ambient declaration, if the implementer needed the Task 2 fallback).
- Every commit from Tasks 1–5 is present in git history.

This satisfies the Phase 3 spec's acceptance criteria in full, and unblocks Phase 4 (Cesium + Quick Create/Studio UI + playback), which directly consumes `extractImageMetadata`, `isHeic`/`canDecodeNatively`/`convertHeicToJpeg`, and all four `resolveFrom*`/`resolveManual` functions built here as part of its "create draft" orchestration and destination-fallback UI.
