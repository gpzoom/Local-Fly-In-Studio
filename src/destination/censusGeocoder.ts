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

      // The payload comes from a JSONP script injected into the page, so its shape isn't
      // guaranteed. Guard against a malformed/unexpected shape (e.g. a match missing
      // `coordinates`) so a thrown error here can't leave the promise unsettled forever -
      // this callback runs outside the executor's call stack, so nothing else would catch it.
      try {
        const match = response?.result?.addressMatches?.[0];
        if (!match || typeof match.coordinates?.x !== 'number' || typeof match.coordinates?.y !== 'number') {
          resolve(null);
          return;
        }

        resolve({
          matchedAddress: match.matchedAddress,
          latitude: match.coordinates.y,
          longitude: match.coordinates.x,
        });
      } catch {
        resolve(null);
      }
    };

    const url = `${CENSUS_GEOCODER_BASE_URL}?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=jsonp&callback=${callbackName}`;
    cleanupScript = injectScript(url);
  });
}

export const censusGeocoderProvider: GeocodingProvider = { geocode: censusGeocode };
