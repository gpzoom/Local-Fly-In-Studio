import { useEffect, useRef, useState } from 'react';
import { resolveFromDeviceLocation, resolveFromAddress, resolveManual } from '../../destination/resolver';
import { createCesiumViewer, type CesiumViewerHandle } from '../../cesium/viewer';
import { Cartographic, Math as CesiumMath, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium';
import type { Destination } from '../../models/project';

interface NoDestinationFallbackProps {
  onResolved: (destination: Destination) => void;
}

export function NoDestinationFallback({ onResolved }: NoDestinationFallbackProps) {
  const [mode, setMode] = useState<'choose' | 'address' | 'pick-map'>('choose');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const viewerHandleRef = useRef<CesiumViewerHandle | null>(null);

  useEffect(() => {
    if (mode !== 'pick-map' || !mapContainerRef.current) return;
    const handle = createCesiumViewer(mapContainerRef.current);
    viewerHandleRef.current = handle;

    const clickHandler = new ScreenSpaceEventHandler(handle.viewer.scene.canvas);
    clickHandler.setInputAction((click: { position: import('cesium').Cartesian2 }) => {
      const cartesian = handle.viewer.camera.pickEllipsoid(click.position, handle.viewer.scene.globe.ellipsoid);
      if (!cartesian) return;
      const cartographic = Cartographic.fromCartesian(cartesian);
      const latitude = CesiumMath.toDegrees(cartographic.latitude);
      const longitude = CesiumMath.toDegrees(cartographic.longitude);
      onResolved(resolveManual(latitude, longitude));
    }, ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      clickHandler.destroy();
      handle.destroy();
      viewerHandleRef.current = null;
    };
  }, [mode, onResolved]);

  async function handleUseCurrentLocation() {
    setError(null);
    try {
      const destination = await resolveFromDeviceLocation();
      onResolved(destination);
    } catch {
      setError('Could not get your current location. Try entering an address instead.');
    }
  }

  async function handleSubmitAddress() {
    setError(null);
    const destination = await resolveFromAddress(address);
    if (destination.latitude === null || destination.longitude === null) {
      setError('No match found for that address. Try a different address or pick on the map.');
      return;
    }
    onResolved(destination);
  }

  if (mode === 'pick-map') {
    return (
      <div className="quick-create-step">
        <h2>Pick on Map</h2>
        <p>Click anywhere on the globe to set the location.</p>
        <div ref={mapContainerRef} className="quick-create-map-picker" />
        {error && <p role="alert">{error}</p>}
      </div>
    );
  }

  if (mode === 'address') {
    return (
      <div className="quick-create-step">
        <h2>Enter Address</h2>
        <input
          type="text"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="123 Main St, City, State"
        />
        <button type="button" onClick={handleSubmitAddress} disabled={address.trim().length === 0}>
          Find Location
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className="quick-create-step">
      <h2>We couldn't find a location in that photo</h2>
      <button type="button" onClick={handleUseCurrentLocation}>
        Use Current Location
      </button>
      <button type="button" onClick={() => setMode('address')}>
        Enter Address
      </button>
      <button type="button" onClick={() => setMode('pick-map')}>
        Pick on Map
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
