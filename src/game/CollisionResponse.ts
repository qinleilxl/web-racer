import { Vector3 } from "three";

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
const flat = (value: Vector3) =>
  new Vector3(
    Number.isFinite(value.x) ? value.x : 0,
    0,
    Number.isFinite(value.z) ? value.z : 0,
  );

/** Normal points away from the wall into the drivable surface. */
export function wallTangent(
  normal: Vector3,
  heading: Vector3,
  velocity: Vector3,
) {
  const n = flat(normal).normalize(),
    nose = flat(heading).normalize();
  if (n.lengthSq() < 0.5) {
    if (nose.lengthSq() > 0.5) return nose;
    const travel = flat(velocity).normalize();
    return travel.lengthSq() > 0.5 ? travel : new Vector3(0, 0, 1);
  }
  const tangent = new Vector3(-n.z, 0, n.x);
  const noseAlong = nose.dot(tangent);
  // Preserve the nose's tangent hemisphere even while reversing. Only use
  // velocity when the car is almost perpendicular to the contact surface.
  if ((Math.abs(noseAlong) > 0.2 ? noseAlong : flat(velocity).dot(tangent)) < 0)
    tangent.negate();
  return tangent;
}

/** Bound outgoing normal speed, with no bounce for stationary resting contact. */
export function boundedRestitution(
  factor: number,
  maxRebound: number,
  approach: number,
) {
  if (!Number.isFinite(approach) || approach <= 0.15) return 0;
  return Math.min(clamp(factor, 0, 1), Math.max(0, maxRebound) / approach);
}

export type ContactYawInput = {
  normal: Vector3;
  heading: Vector3;
  velocity: Vector3;
  yawRate: number;
  /** Rotation rate of the observed contact normal, radians/second. */
  normalYawRate?: number;
  release?: boolean;
  steer?: number;
  /** Desired bicycle-model yaw from the driver's current front-wheel angle. */
  driverYawRate?: number;
  alignStrength?: number;
  yawDamping?: number;
  maxTorque?: number;
};

/**
 * A bounded contact assist using the actual collision surface. No centreline or
 * checkpoint direction enters this calculation, including on bends and reverse.
 */
export function contactYawTarget(input: ContactYawInput) {
  const normal = flat(input.normal).normalize();
  const heading = flat(input.heading).normalize();
  const velocity = flat(input.velocity);
  const tangent = wallTangent(normal, heading, velocity);
  const along = velocity.dot(tangent);
  if (input.release) {
    if (heading.dot(normal) < -0.98 && input.steer) {
      tangent
        .set(-normal.z, 0, normal.x)
        .multiplyScalar(-Math.sign(input.steer));
    }
    tangent.addScaledVector(normal, 0.35).normalize();
  }
  const error = Math.atan2(
    heading.clone().cross(tangent).y,
    heading.dot(tangent),
  );
  const driverReleasing =
    input.release &&
    Math.abs(input.steer ?? 0) > 0.1 &&
    input.driverYawRate !== undefined &&
    heading.dot(normal) > -0.05;
  const targetYawRate = clamp(
    driverReleasing ? input.driverYawRate! : (input.normalYawRate ?? 0),
    -3,
    3,
  );
  const weight =
    normal.lengthSq() < 0.5
      ? 0
      : input.release
        ? 1
        : clamp((Math.abs(along) - 1) / 4, 0, 1);
  const maximum = Math.max(0, input.maxTorque ?? 4000);
  const torque = clamp(
    (error *
      Math.max(0, input.alignStrength ?? 6500) *
      (driverReleasing ? 0 : 1) +
      (targetYawRate - input.yawRate) * Math.max(0, input.yawDamping ?? 1100)) *
      weight,
    -maximum,
    maximum,
  );
  return { tangent, targetYawRate, torque, headingError: error };
}
