import { Vector3 } from "three";
import { VEHICLES } from "./Vehicles";

import { CAMERA_MODES, type CameraMode } from "./CameraModes";
export { CAMERA_MODES, CAMERA_LABELS, type CameraMode } from "./CameraModes";
export function nextCameraMode(mode: CameraMode): CameraMode {
  return CAMERA_MODES[(CAMERA_MODES.indexOf(mode) + 1) % CAMERA_MODES.length];
}

/** Gentle speed pullback from 30 to 160 km/h; lens angle stays unchanged. */
export function chaseDistance(
  mode: CameraMode,
  speed: number,
  aspect = 16 / 9,
) {
  const t = Math.max(0, Math.min(1, (Math.max(0, speed) * 3.6 - 30) / 130));
  const amount = t * t * (3 - 2 * t);
  const portraitRoom = Math.max(0, 0.9 / Math.max(0.2, aspect) - 1) * 3;
  return (
    (mode === "far" ? 8.8 : 6.6) +
    portraitRoom +
    amount * (mode === "far" ? 1.2 : 0.9)
  );
}

/** Reserve the portrait menu's central stage and keep the entire orbit inside it. */
export function menuDistanceScale(
  width: number,
  height: number,
  showcase: boolean,
) {
  const aspect = Math.max(0.2, width / Math.max(1, height));
  return (
    Math.max(1, (width <= 700 ? 0.95 : 1.15) / aspect) * (showcase ? 1.25 : 1)
  );
}

// Original GLB coordinates: the car faces -X, the steering column is at Z=0.29.
// Mount inside the existing cabin, above the driver's seat and below the roof.
export const COCKPIT_EYE = new Vector3(...VEHICLES.sparrow.cockpitEye);
export const COCKPIT_LOOK = new Vector3(...VEHICLES.sparrow.cockpitLook);
