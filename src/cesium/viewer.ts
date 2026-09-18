import { Ion, ImageryLayer, Viewer, EllipsoidTerrainProvider, CreditDisplay, Credit } from 'cesium';
import { createUsgsImageryProvider } from './imagery';

// No Cesium ion dependency anywhere in this app. A one-time global neutralization —
// runs at import, not per viewer instance.
Ion.defaultAccessToken = '';

// Every CreditDisplay defaults to showing a "Cesium ion" logo credit, but that credit is
// only required when actually using ion-hosted assets/tokens (which this app never does).
// Overriding the static default — Cesium's own supported mechanism for this — with an
// empty, off-screen Credit removes it; the real USGS attribution lives in PreviewStage.
CreditDisplay.cesiumCredit = new Credit('', false);

export interface CesiumViewerHandle {
  viewer: Viewer;
  destroy: () => void;
}

export function createCesiumViewer(
  container: HTMLElement,
  onImageryError?: (message: string) => void,
): CesiumViewerHandle {
  const imageryProvider = createUsgsImageryProvider();
  if (onImageryError) {
    // Fires per failed tile request, which can repeat rapidly (e.g. offline) — the
    // listener itself only reports the first one; PreviewStage debounces the rest.
    imageryProvider.errorEvent.addEventListener((error) => {
      onImageryError(error.message || 'Map imagery could not be loaded.');
    });
  }

  const viewer = new Viewer(container, {
    // NOTE: the installed cesium (1.145) Viewer.ConstructorOptions has no
    // `imageryProvider` option; the base imagery layer is supplied via
    // `baseLayer`, which takes an ImageryLayer (not a raw ImageryProvider).
    baseLayer: new ImageryLayer(imageryProvider),
    terrainProvider: new EllipsoidTerrainProvider(),
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
  });

  return {
    viewer,
    destroy: () => viewer.destroy(),
  };
}
