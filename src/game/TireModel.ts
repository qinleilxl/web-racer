/** Maximum tyre impulses for one solver step; SI units throughout. */
export type TireBudgetInput = {
  normalImpulse: number;
  dt: number;
  mass: number;
  gravity: number;
  /** The native slip curves have already evaluated these coefficients. */
  longitudinalFriction: number;
  lateralFriction: number;
  longitudinalSlip: number;
  /** Radians, as supplied by Jolt's tyre callback. */
  lateralSlip: number;
  gripScale: number;
  loadSensitivity: number;
  /** 0 retains independent axes, 1 enforces the complete friction ellipse. */
  combinedGrip: number;
  peakLongitudinalFriction?: number;
  peakLateralFriction?: number;
  longitudinalGripScale?: number;
  lateralGripScale?: number;
};

export type TireBudget = {
  longitudinalImpulse: number;
  lateralImpulse: number;
  totalLongitudinalCapacity: number;
  totalLateralCapacity: number;
  normalLoad: number;
  loadScale: number;
  /** Ellipse usage of the maximum impulse pair, not measured tyre force. */
  utilization: number;
  combinedSlip: number;
};

const positive = (value: number) =>
  Number.isFinite(value) ? Math.max(0, value) : 0;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

/**
 * Suspension impulse carries the real load transfer from the rigid body. Tyre
 * coefficient falls with load, so doubling load gives less than twice the grip.
 * The final rectangular solver limits fit inside one friction ellipse: drive,
 * braking and cornering cannot each spend the full contact patch's capacity.
 * No extra body-side grip force is needed to enforce this budget.
 */
export function tireImpulseBudget(input: TireBudgetInput): TireBudget {
  const impulse = positive(input.normalImpulse);
  const dt = positive(input.dt);
  if (dt < 1e-6 || impulse === 0)
    return {
      longitudinalImpulse: 0,
      lateralImpulse: 0,
      totalLongitudinalCapacity: 0,
      totalLateralCapacity: 0,
      normalLoad: 0,
      loadScale: 1,
      utilization: 0,
      combinedSlip: 0,
    };

  const normalLoad = impulse / dt;
  const referenceLoad = Math.max(
    1,
    (positive(input.mass) * positive(input.gravity)) / 4,
  );
  const loadScale = clamp(
    Math.pow(
      Math.max(0.05, normalLoad / referenceLoad),
      -clamp(input.loadSensitivity, 0, 0.5),
    ),
    0.65,
    1.35,
  );
  const capacity = impulse * clamp(input.gripScale, 0, 4) * loadScale;
  const longitudinalScale = clamp(input.longitudinalGripScale ?? 1, 0, 4);
  const lateralScale = clamp(input.lateralGripScale ?? 1, 0, 4);
  const longitudinalCapacity =
    capacity *
    positive(input.peakLongitudinalFriction ?? 1.35) *
    longitudinalScale;
  const lateralCapacity =
    capacity * positive(input.peakLateralFriction ?? 1.35) * lateralScale;
  let longitudinalImpulse =
    longitudinalCapacity > 0
      ? capacity * positive(input.longitudinalFriction) * longitudinalScale
      : 0;
  let lateralImpulse =
    lateralCapacity > 0
      ? capacity * positive(input.lateralFriction) * lateralScale
      : 0;
  const longitudinalSlip = clamp(Math.abs(input.longitudinalSlip), 0, 10);
  const lateralSlip = clamp(Math.abs(input.lateralSlip), 0, 1.45);
  // Reserve the patch in the direction of the measured slip demand. A native
  // lateral curve may provide static capacity even at zero angle; that unused
  // reserve must not steal 29% of straight-line acceleration from the engine.
  const x =
    longitudinalCapacity > 0 && longitudinalImpulse > 0
      ? clamp(longitudinalSlip / 0.12, 0, 1)
      : 0;
  const y =
    lateralCapacity > 0 && lateralImpulse > 0
      ? clamp(Math.sin(lateralSlip) / Math.sin(0.12), 0, 1)
      : 0;
  const demand = Math.hypot(x, y);
  const activation = clamp(demand / 0.15, 0, 1);
  const blend = activation * activation * (3 - 2 * activation);
  // Around rest, retain a symmetric static reserve. The convex blend remains
  // within the unit circle and avoids a divide-by-zero / discontinuity at rest.
  const xShare =
    Math.SQRT1_2 +
    ((demand > 0 ? x / demand : Math.SQRT1_2) - Math.SQRT1_2) * blend;
  const yShare =
    Math.SQRT1_2 +
    ((demand > 0 ? y / demand : Math.SQRT1_2) - Math.SQRT1_2) * blend;
  const combined = clamp(input.combinedGrip, 0, 1);
  longitudinalImpulse +=
    (Math.min(longitudinalImpulse, longitudinalCapacity * xShare) -
      longitudinalImpulse) *
    combined;
  lateralImpulse +=
    (Math.min(lateralImpulse, lateralCapacity * yShare) - lateralImpulse) *
    combined;
  return {
    longitudinalImpulse,
    lateralImpulse,
    totalLongitudinalCapacity: longitudinalCapacity,
    totalLateralCapacity: lateralCapacity,
    normalLoad,
    loadScale,
    utilization: Math.hypot(
      longitudinalCapacity > 0 ? longitudinalImpulse / longitudinalCapacity : 0,
      lateralCapacity > 0 ? lateralImpulse / lateralCapacity : 0,
    ),
    combinedSlip: Math.hypot(longitudinalSlip, Math.tan(lateralSlip)),
  };
}
