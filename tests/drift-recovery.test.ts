import { test } from "node:test";
import assert from "node:assert/strict";
import { Physics } from "../src/game/Physics";
import { PHYSICS_STEP } from "../src/game/Driving";
import { flatCircuit, parked, throttle, tiltDegrees } from "./helpers/driving";

test("drift recovery carries yaw inertia, restores grip progressively and never snaps into the opposite slide", async () => {
  const flat = flatCircuit(),
    p = await Physics.create(flat.road, flat.track);
  let cases = 0,
    worstOpposite = 0,
    maxGripRate = 0,
    maxLateSlip = 0;
  try {
    for (const kmh of [60, 100, 160])
      for (const direction of [-1, 1])
        for (const mode of ["neutral", "coast", "tap", "counter"]) {
          p.reset(flat.track, 0);
          for (let i = 0; i < 120; i++)
            p.step(PHYSICS_STEP, parked, true, false);
          // Reach test speed through the real gearbox, not a first-gear velocity injection.
          for (let i = 0; i < 2400 && p.speed < kmh / 3.6; i++)
            p.step(PHYSICS_STEP, throttle, true, false);
          assert.ok(p.speed >= kmh / 3.6, "fixture did not reach test speed");
          for (let i = 0; i < 108; i++)
            p.step(
              PHYSICS_STEP,
              { ...throttle, steer: direction, handbrake: i < 12 },
              true,
              false,
            );
          const initialTarget = Math.abs(p.driftTargetAngle),
            initialSpeed = p.speed;
          assert.ok(
            Math.abs(p.slipAngle) > (15 * Math.PI) / 180,
            "fixture did not enter a real drift",
          );
          let lastGrip = p.rearGripFactor,
            opposite = 0,
            minSpeed = p.speed,
            lateSlip = 0,
            maxTilt = 0;
          for (let i = 0; i < 540; i++) {
            const steer =
              (mode === "tap" && i < 12) || (mode === "counter" && i < 24)
                ? -direction
                : 0;
            p.step(
              PHYSICS_STEP,
              { ...throttle, throttle: mode === "coast" ? 0 : 1, steer },
              true,
              false,
            );
            const gripRate = (p.rearGripFactor - lastGrip) / PHYSICS_STEP;
            lastGrip = p.rearGripFactor;
            maxGripRate = Math.max(maxGripRate, gripRate);
            assert.ok(
              gripRate <= 0.40001,
              `rear tyre grip snapped back: ${gripRate}/s`,
            );
            if (i === 11)
              assert.ok(
                Math.abs(p.driftTargetAngle) > initialTarget * 0.85,
                "slip target lost its angular inertia in the first 100 ms",
              );
            const slip = (p.slipAngle * direction * 180) / Math.PI;
            if (i === 59 && (mode === "neutral" || mode === "coast"))
              assert.ok(slip > 8, "neutral input cut the inertial slide short");
            opposite = Math.max(opposite, -slip);
            minSpeed = Math.min(minSpeed, p.speed);
            if (i >= 480) lateSlip = Math.max(lateSlip, Math.abs(slip));
            maxTilt = Math.max(maxTilt, tiltDegrees(p.rotation));
          }
          assert.ok(
            opposite < 2,
            `${kmh} km/h ${direction} ${mode} flung the tail into ${opposite} degrees of opposite slip`,
          );
          assert.ok(
            lateSlip < 4,
            `${kmh} km/h ${direction} ${mode} kept oscillating after the exit: ${lateSlip}`,
          );
          assert.ok(
            p.rearGripFactor > 0.95,
            `${kmh} ${direction} ${mode} exit did not finish restoring grip: ${p.rearGripFactor}, slip ${lateSlip}`,
          );
          assert.ok(
            // Lift-off now has real drivetrain resistance. Powered exits retain
            // the original 80% bound; coasting must still keep useful momentum.
            minSpeed > initialSpeed * (mode === "coast" ? 0.6 : 0.8),
            `${kmh} ${direction} ${mode} exit killed momentum: ${minSpeed / initialSpeed}`,
          );
          assert.ok(maxTilt < 15, "exit unsettled the chassis");
          worstOpposite = Math.max(worstOpposite, opposite);
          maxLateSlip = Math.max(maxLateSlip, lateSlip);
          cases++;
        }
    console.log(
      JSON.stringify({
        driftExitCases: cases,
        worstOppositeSlipDegrees: worstOpposite,
        maxRearGripRecoveryPerSecond: maxGripRate,
        maxSlipAfter4Seconds: maxLateSlip,
      }),
    );
  } finally {
    p.dispose();
    flat.road.geometry.dispose();
  }
});
