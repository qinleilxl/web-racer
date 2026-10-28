import {
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three";
import type { Physics } from "../../src/game/Physics";
import { Track } from "../../src/game/Track";
import { PHYSICS_STEP } from "../../src/game/Driving";
export const parked = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: true,
  boost: false,
};
export const throttle = { ...parked, throttle: 1, handbrake: false };
export function flatCircuit() {
  const geometry = new PlaneGeometry(5000, 5000);
  geometry.rotateX(-Math.PI / 2);
  const road = new Mesh(geometry, new MeshBasicMaterial());
  const centerline_blender = Array.from({ length: 960 }, (_, i) => {
    const a = (i / 960) * Math.PI * 2;
    return [Math.cos(a) * 500, Math.sin(a) * 500, 0];
  });
  return {
    road,
    track: new Track({
      centerline_blender,
      width_m: 1000,
      length_m: Math.PI * 1000,
    }),
  };
}
export function tiltDegrees(rotation: import("three").Quaternion) {
  return (
    (Math.acos(
      Math.max(
        -1,
        Math.min(1, new Vector3(0, 1, 0).applyQuaternion(rotation).y),
      ),
    ) *
      180) /
    Math.PI
  );
}

export function straightCircuit() {
  const flat = flatCircuit();
  flat.track.points = Array.from({ length: 960 }, (_, i) =>
    i < 240
      ? new Vector3(0, 0, (i - 120) * 2)
      : i < 480
        ? new Vector3((i - 240) * 2, 0, 240)
        : i < 720
          ? new Vector3(480, 0, 240 - (i - 480) * 2)
          : new Vector3(480 - (i - 720) * 2, 0, -240),
  );
  const track = Object.create(flat.track) as Track;
  Object.defineProperty(track, "width", { value: 8 });
  return { road: flat.road, track };
}

export function curvedCircuit(radius = 45, bend = 1) {
  const flat = flatCircuit();
  const track = new Track({
    centerline_blender: Array.from({ length: 960 }, (_, i) => [
      Math.cos((i / 960) * Math.PI * 2) * radius,
      Math.sin((i / 960) * Math.PI * 2 * bend) * radius,
      0,
    ]),
    width_m: 8,
    length_m: 2 * Math.PI * radius,
  });
  return { road: flat.road, track };
}

/** Initial conditions only; subsequent driving always uses forces and the native controller. */
export function launch(
  p: Physics,
  kmh: number,
  yaw: number,
  input = { ...parked, handbrake: false },
) {
  // Release the settling fixture's parking brake before setting initial motion.
  p.step(PHYSICS_STEP, input, true, false);
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  const v = new Vector3(0, 0, 1).applyQuaternion(q).multiplyScalar(kmh / 3.6);
  const J = p.J,
    rotation = new J.Quat(q.x, q.y, q.z, q.w),
    velocity = new J.Vec3(v.x, v.y, v.z),
    zero = new J.Vec3();
  const bodies = p.system.GetBodyInterface();
  bodies.SetRotation(p.body.GetID(), rotation, J.EActivation_Activate);
  bodies.SetLinearAndAngularVelocity(p.body.GetID(), velocity, zero);
  for (let i = 0; i < 4; i++)
    p.wheel(i).SetAngularVelocity(kmh / 3.6 / p.geometry.radius);
  [rotation, velocity, zero].forEach((o) => J.destroy(o));
}
