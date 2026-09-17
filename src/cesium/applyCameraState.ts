import { Cartesian3, Math as CesiumMath } from 'cesium';
import type { Viewer } from 'cesium';
import type { CameraState } from '../models/scenes';

export function applyCameraState(viewer: Viewer, camera: CameraState): void {
  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(camera.longitude, camera.latitude, camera.height),
    orientation: {
      heading: CesiumMath.toRadians(camera.heading),
      pitch: CesiumMath.toRadians(camera.pitch),
      roll: CesiumMath.toRadians(camera.roll),
    },
  });
}
