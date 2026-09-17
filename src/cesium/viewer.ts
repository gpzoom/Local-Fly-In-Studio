import { Ion, ImageryLayer, Viewer, EllipsoidTerrainProvider } from 'cesium';
import { createUsgsImageryProvider } from './imagery';

export interface CesiumViewerHandle {
  viewer: Viewer;
  destroy: () => void;
}

export function createCesiumViewer(container: HTMLElement): CesiumViewerHandle {
  // No Cesium ion dependency anywhere in this app.
  Ion.defaultAccessToken = '';

  const viewer = new Viewer(container, {
    // NOTE: the installed cesium (1.145) Viewer.ConstructorOptions has no
    // `imageryProvider` option; the base imagery layer is supplied via
    // `baseLayer`, which takes an ImageryLayer (not a raw ImageryProvider).
    baseLayer: new ImageryLayer(createUsgsImageryProvider()),
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
