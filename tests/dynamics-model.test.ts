import assert from "node:assert/strict";
import { test } from "node:test";
import { Vector3 } from "three";
import { tireImpulseBudget, type TireBudgetInput } from "../src/game/TireModel";
import {
  boundedRestitution,
  contactYawTarget,
  wallTangent,
} from "../src/game/CollisionResponse";

const tyre: TireBudgetInput = {
  normalImpulse: (950 * 9.81) / 4 / 120,
  dt: 1 / 120,
  mass: 950,
  gravity: 9.81,
  longitudinalFriction: 1.35,
  lateralFriction: 1.35,
  longitudinalSlip: 0.12,
  lateralSlip: 0.15,
  gripScale: 1,
  loadSensitivity: 0.12,
  combinedGrip: 1,
};

test("combined tyre limits share a friction ellipse and braking reduces cornering capacity", () => {
  for (const x of [0, 0.3, 1.35, 2.8])
    for (const y of [0, 0.5, 1.35, 2]) {
      const budget = tireImpulseBudget({
        ...tyre,
        longitudinalFriction: x,
        lateralFriction: y,
      });
      const capacity = tyre.normalImpulse * 1.35;
      assert.ok(
        Math.hypot(
          budget.longitudinalImpulse / capacity,
          budget.lateralImpulse / capacity,
        ) <=
          1 + 1e-12,
      );
    }
  const cornering = tireImpulseBudget({ ...tyre, longitudinalFriction: 0 });
  const brakingAndTurning = tireImpulseBudget(tyre);
  assert.ok(brakingAndTurning.lateralImpulse < cornering.lateralImpulse * 0.8);
  assert.ok(brakingAndTurning.longitudinalImpulse > 0);
  const uncoupled = tireImpulseBudget({ ...tyre, combinedGrip: 0 });
  assert.ok(uncoupled.lateralImpulse > brakingAndTurning.lateralImpulse);
  const straight = tireImpulseBudget({ ...tyre, lateralSlip: 0 });
  assert.ok(
    Math.abs(
      straight.longitudinalImpulse - straight.totalLongitudinalCapacity,
    ) < 1e-10,
    "unused static lateral capacity stole straight-line acceleration",
  );
  const pureCorner = tireImpulseBudget({ ...tyre, longitudinalSlip: 0 });
  assert.ok(
    Math.abs(pureCorner.lateralImpulse - pureCorner.totalLateralCapacity) <
      1e-10,
  );
});

test("load transfer reduces total axle grip and tyre budget remains consistent across step sizes", () => {
  const balanced = tireImpulseBudget({ ...tyre, longitudinalFriction: 0 });
  const inner = tireImpulseBudget({
    ...tyre,
    longitudinalFriction: 0,
    normalImpulse: tyre.normalImpulse * 0.4,
  });
  const outer = tireImpulseBudget({
    ...tyre,
    longitudinalFriction: 0,
    normalImpulse: tyre.normalImpulse * 1.6,
  });
  assert.ok(outer.lateralImpulse > balanced.lateralImpulse);
  assert.ok(outer.loadScale < balanced.loadScale);
  assert.ok(
    inner.lateralImpulse + outer.lateralImpulse < balanced.lateralImpulse * 2,
  );
  const halfFrequency = tireImpulseBudget({
    ...tyre,
    dt: 1 / 60,
    normalImpulse: tyre.normalImpulse * 2,
  });
  const normalFrequency = tireImpulseBudget(tyre);
  assert.ok(
    Math.abs(halfFrequency.normalLoad - normalFrequency.normalLoad) < 1e-8,
  );
  assert.ok(
    Math.abs(
      halfFrequency.lateralImpulse / 2 - normalFrequency.lateralImpulse,
    ) < 1e-8,
  );
  for (const normalImpulse of [0, -1, NaN]) {
    const result = tireImpulseBudget({
      ...tyre,
      normalImpulse,
      longitudinalSlip: Infinity,
      lateralSlip: Math.PI / 2,
    });
    assert.equal(result.longitudinalImpulse, 0);
    assert.equal(result.lateralImpulse, 0);
    assert.ok(Object.values(result).every(Number.isFinite));
  }
});

test("contact tangent follows rotated walls and reversing does not reverse the car nose", () => {
  for (const angle of [0, 0.3, 1.2, -1.8]) {
    const normal = new Vector3(Math.cos(angle), 0, Math.sin(angle));
    const heading = new Vector3(-Math.sin(angle), 0, Math.cos(angle));
    for (const speed of [-20, 20]) {
      const tangent = wallTangent(
        normal,
        heading,
        heading.clone().multiplyScalar(speed),
      );
      assert.ok(Math.abs(tangent.dot(normal)) < 1e-10);
      assert.ok(tangent.dot(heading) > 0.9999);
    }
  }
  const heading = new Vector3(0, 0, 1),
    velocity = heading.clone().multiplyScalar(30);
  const straight = contactYawTarget({
    normal: new Vector3(1, 0, 0),
    heading,
    velocity,
    yawRate: 0,
  });
  const bend = contactYawTarget({
    normal: new Vector3(1, 0, -0.5),
    heading,
    velocity,
    yawRate: 0,
  });
  assert.equal(straight.torque, 0);
  assert.ok(
    bend.torque > 0,
    "new wall direction must turn the nose despite unchanged global heading",
  );
  assert.ok(
    Math.abs(
      contactYawTarget({
        normal: new Vector3(1, 0, 0),
        heading,
        velocity,
        yawRate: 100,
      }).torque,
    ) <= 4000,
  );
});

test("restitution has a bounded rebound speed and resting contacts do not gain energy", () => {
  for (const speed of [1, 5, 20, 60, 100]) {
    const coefficient = boundedRestitution(0.2, 2.4, speed);
    assert.ok(coefficient * speed <= 2.4 + 1e-12);
    assert.ok(coefficient >= 0 && coefficient <= 0.2);
  }
  assert.equal(boundedRestitution(0.2, 2.4, 0), 0);
  assert.equal(boundedRestitution(0.2, 2.4, -5), 0);
});

test("wall alignment yields to held steering once the nose clears the wall, while a pinned nose still receives escape alignment", () => {
  for (const sign of [-1, 1]) {
    const normal = new Vector3(sign, 0, 0),
      heading = new Vector3(sign * Math.sin(0.65), 0, Math.cos(0.65));
    const input = {
      normal,
      heading,
      velocity: new Vector3(sign * 4, 0, 24),
      yawRate: sign * 0.45,
      driverYawRate: sign * 0.45,
      steer: -sign,
      release: true,
    };
    const response = contactYawTarget(input);
    assert.ok(
      Math.abs(response.torque) < 1e-8,
      "wall assist fought the driver's existing turn toward open road",
    );
    const correcting = contactYawTarget({ ...input, yawRate: -sign * 0.5 });
    assert.ok(
      correcting.torque * sign > 0,
      "countersteering returned to the wall's old target",
    );
    const pinned = contactYawTarget({
      ...input,
      heading: normal.clone().negate(),
      velocity: new Vector3(),
      driverYawRate: 0,
      yawRate: 0,
    });
    assert.ok(
      Math.abs(pinned.torque) > 1000,
      "a stopped head-on impact lost its escape assist",
    );
  }
});
