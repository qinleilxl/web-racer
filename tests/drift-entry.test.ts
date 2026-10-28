import { test } from "node:test";
import assert from "node:assert/strict";
import { DriftControl, DRIFT, PHYSICS_STEP as dt } from "../src/game/Driving";
import { Physics } from "../src/game/Physics";
import { flatCircuit, parked, throttle, tiltDegrees } from "./helpers/driving";

test("starting a drift requires a fresh handbrake pull, sufficient speed and deliberate steering", () => {
  const control = new DriftControl();
  for (const kmh of [10, 20, 30, 39]) {
    control.reset();
    for (let i = 0; i < 36; i++) control.update(dt, 1, i < 12, kmh / 3.6);
    assert.equal(control.active, false, `${kmh} km/h started a drift`);
    assert.equal(control.angle, 0);
  }
  for (const steer of [0, 0.1, -0.1]) {
    control.reset();
    for (let i = 0; i < 36; i++) control.update(dt, steer, i < 12, 100 / 3.6);
    assert.equal(control.active, false, "straight braking armed a drift");
  }
  control.reset();
  for (let i = 0; i < 108; i++) control.update(dt, 1, i < 12, 100 / 3.6);
  assert.ok(
    control.active && control.angle > 0.25,
    "deliberate pull did not start a drift",
  );
  for (let i = 0; i < 60; i++)
    control.update(dt, 1, false, DRIFT.exitSpeed - 0.1, undefined, 0.2);
  assert.equal(control.active, false, "slowing down retained drift permission");
  for (let i = 0; i < 480; i++)
    control.update(dt, 1, false, 100 / 3.6, undefined, 0.2);
  assert.equal(
    control.active,
    false,
    "residual slip armed a new drift without Space",
  );
  assert.ok(Math.abs(control.angle) < 0.001);
  control.update(dt, 1, true, 100 / 3.6);
  assert.equal(
    control.active,
    true,
    "a new handbrake pull could not start another drift",
  );
});

test("a real drift followed by low-speed braking and powered turns cannot re-arm itself", async () => {
  const f = flatCircuit(),
    p = await Physics.create(f.road, f.track);
  try {
    for (const side of [-1, 1])
      for (const stopSpeed of [0, 20]) {
        p.reset(f.track, 0);
        for (let i = 0; i < 120; i++) p.step(dt, parked, true, false);
        for (let i = 0; i < 2400 && p.speed * 3.6 < 100; i++)
          p.step(dt, throttle, true, false);
        for (let i = 0; i < 108; i++)
          p.step(
            dt,
            { ...throttle, steer: side, handbrake: i < 12 },
            true,
            false,
          );
        assert.ok(p.drifting, "fixture did not enter a real drift");
        for (let i = 0; i < 1200 && p.speed * 3.6 > Math.max(3, stopSpeed); i++)
          p.step(dt, { ...throttle, throttle: 0, brake: 1 }, true, false);
        if (!stopSpeed) {
          for (let i = 0; i < 120; i++) p.step(dt, parked, true, false);
          assert.ok(
            p.speed < 0.1 && Math.abs(p.slipAngle) < 0.001,
            "stopped car retained an undefined slide angle",
          );
        }
        assert.ok(
          p.speed * 3.6 <= Math.max(3, stopSpeed),
          "fixture never slowed below the exit threshold",
        );
        let lateSlip = 0;
        for (let i = 0; i < 720; i++) {
          p.step(
            dt,
            { ...throttle, steer: Math.floor(i / 72) % 2 ? -side : side },
            true,
            false,
          );
          assert.ok(
            tiltDegrees(p.rotation) < 15,
            "post-drift turn unsettled chassis",
          );
          if (i >= 180) {
            assert.equal(
              p.drifting,
              false,
              "powered steering re-entered a drift without Space",
            );
            assert.ok(
              Math.abs(p.driftTargetAngle) < 0.005,
              "steering rebuilt the old slip target",
            );
            lateSlip = Math.max(lateSlip, Math.abs(p.telemetry.slipAngle));
          }
        }
        assert.ok(
          // E Final can briefly slip in a full-lock first-gear slalom. Stay
          // below drift entry and require that no handbrake state re-arms.
          lateSlip < (DRIFT.displayEnter * 180) / Math.PI,
          `post-drift ordinary steering lost grip: ${lateSlip}`,
        );
        assert.ok(
          p.rearGripFactor > 0.99,
          "old drift tyre settings survived the next acceleration",
        );
      }
  } finally {
    p.dispose();
    f.road.geometry.dispose();
  }
});

test("after a displayed drift exits at speed, steering again cannot rebuild it until a new handbrake pull", async () => {
  const f = flatCircuit(),
    p = await Physics.create(f.road, f.track);
  try {
    for (const side of [-1, 1]) {
      p.reset(f.track, 0);
      for (let i = 0; i < 120; i++) p.step(dt, parked, true, false);
      for (let i = 0; i < 2400 && p.speed * 3.6 < 100; i++)
        p.step(dt, throttle, true, false);
      for (let i = 0; i < 108; i++)
        p.step(
          dt,
          { ...throttle, steer: side, handbrake: i < 12 },
          true,
          false,
        );
      assert.ok(p.drifting, "fixture never displayed an actual drift");
      for (let i = 0; i < 720 && p.drifting; i++)
        p.step(dt, throttle, true, false);
      assert.equal(p.drifting, false, "drift never finished");
      assert.ok(
        p.speed > DRIFT.entrySpeed,
        "exit fixture slowed below entry speed",
      );
      const exitTarget = Math.abs(p.driftTargetAngle);
      let lateSlip = 0;
      // Resume steering on the very next frame: no low-speed reset or waiting
      // for the target / tyre grip to finish its inertial recovery is allowed.
      for (let i = 0; i < 360; i++) {
        p.step(dt, { ...throttle, steer: side }, true, false);
        assert.equal(
          p.drifting,
          false,
          "steering immediately reactivated the completed drift",
        );
        assert.ok(
          Math.abs(p.driftTargetAngle) <= exitTarget + 0.01,
          "steering rebuilt the old target angle",
        );
        if (i >= 180)
          lateSlip = Math.max(lateSlip, Math.abs(p.telemetry.slipAngle));
      }
      assert.ok(
        Math.abs(p.driftTargetAngle) < 0.001 && p.rearGripFactor > 0.99,
        "drift authority did not finish clearing",
      );
      assert.ok(
        lateSlip < 6,
        `ordinary steering kept the physical slide alive: ${lateSlip}`,
      );
      for (let i = 0; i < 108; i++)
        p.step(
          dt,
          { ...throttle, steer: side, handbrake: i < 12 },
          true,
          false,
        );
      assert.ok(
        p.drifting,
        "a fresh handbrake pull could not initiate the next drift",
      );
    }
  } finally {
    p.dispose();
    f.road.geometry.dispose();
  }
});

test("a controlled drift follows a tighter real path than grip steering, with more lateral authority and comparable speed", async () => {
  const f = flatCircuit(),
    p = await Physics.create(f.road, f.track),
    records = [];
  try {
    for (const side of [-1, 1])
      for (const kmh of [60, 100, 140]) {
        const results = [];
        for (const drift of [false, true]) {
          p.reset(f.track, 0);
          for (let i = 0; i < 120; i++) p.step(dt, parked, true, false);
          for (let i = 0; i < 2400 && p.speed * 3.6 < kmh; i++)
            p.step(dt, throttle, true, false);
          let distance = 0,
            turn = 0,
            lateralAcceleration = 0,
            meanSpeed = 0,
            peakSlip = 0;
          for (let i = 0; i < 180; i++) {
            const before = p.velocity.clone().setY(0).normalize();
            p.step(
              dt,
              { ...throttle, steer: side, handbrake: drift && i < 12 },
              true,
              false,
            );
            const after = p.velocity.clone().setY(0).normalize();
            const angle = Math.atan2(
              before.clone().cross(after).y,
              before.dot(after),
            );
            assert.ok(
              tiltDegrees(p.rotation) < 15,
              "tightened turn lifted chassis",
            );
            peakSlip = Math.max(peakSlip, Math.abs(p.telemetry.slipAngle));
            // Curvature comes from the velocity path, never just the car's yaw.
            if (i >= 60 && i < 156) {
              distance += p.speed * dt;
              turn += Math.abs(angle);
              lateralAcceleration += ((Math.abs(angle) / dt) * p.speed) / 96;
              meanSpeed += p.speed / 96;
            }
          }
          results.push({
            radius: distance / turn,
            lateralAcceleration,
            meanSpeed,
            peakSlip,
          });
        }
        const [grip, drift] = results;
        assert.ok(
          drift.peakSlip > 15 && drift.peakSlip < 50,
          "fixture was not a controlled drift",
        );
        assert.ok(
          drift.radius < grip.radius * 0.84,
          `${kmh} km/h drift widened the actual path: ${JSON.stringify(results)}`,
        );
        assert.ok(
          drift.meanSpeed > grip.meanSpeed * 0.88,
          "smaller radius came only from excessive braking",
        );
        assert.ok(
          drift.lateralAcceleration > grip.lateralAcceleration * 1.05,
          `drift added yaw without adding actual cornering authority: ${JSON.stringify(results)}`,
        );
        records.push({
          side,
          kmh,
          gripRadiusMeters: grip.radius,
          driftRadiusMeters: drift.radius,
        });
      }
    console.log(JSON.stringify({ controlledDriftPaths: records }));
  } finally {
    p.dispose();
    f.road.geometry.dispose();
  }
});
