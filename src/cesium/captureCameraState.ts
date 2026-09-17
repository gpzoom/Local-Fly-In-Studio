import { Math as CesiumMath } from 'cesium';
import type { Viewer } from 'cesium';
import type { CameraState } from '../models/scenes';

export function captureCameraState(viewer: Viewer): CameraState {
  const { camera } = viewer;
  const { longitude, latitude, height } = camera.positionCartographic;

  return {
    longitude: CesiumMath.toDegrees(longitude),
    latitude: CesiumMath.toDegrees(latitude),
    height,
    heading: CesiumMath.toDegrees(camera.heading),
    pitch: CesiumMath.toDegrees(camera.pitch),
    roll: CesiumMath.toDegrees(camera.roll),
  };
}
