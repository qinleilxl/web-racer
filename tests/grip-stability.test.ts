import { test } from "node:test";
import assert from "node:assert/strict";
import { Physics } from "../src/game/Physics";
import { PHYSICS_STEP } from "../src/game/Driving";
import { flatCircuit, parked, throttle, tiltDegrees } from "./helpers/driving";

test("standard setup keeps ordinary powered, coasting, braking and alternating turns in grip", async () => {
  const f = flatCircuit();
  const p = await Physics.create(f.road, f.track);
  let worstSlip = 0,
    cases = 0;
  try {
    for (const side of [-1, 1])
      for (const kmh of [60, 100, 160])
        for (const mode of ["throttle", "coast", "slalom", "brake"]) {
          p.reset(f.track, 0);
          for (let i = 0; i < 120; i++)
            p.step(PHYSICS_STEP, parked, true, false);
          for (let i = 0; i < 2400 && p.speed < kmh / 3.6; i++)
            p.step(PHYSICS_STEP, throttle, true, false);
          assert.ok(
            p.speed >= kmh / 3.6,
            "fixture did not naturally reach target speed",
          );
          let peak = 0;
          for (let i = 0; i < 480; i++) {
            const braking = mode === "brake" && i >= 60 && i < 144;
            const steer =
              side * (mode === "slalom" && Math.floor(i / 72) % 2 ? -1 : 1);
            p.step(
              PHYSICS_STEP,
              {
                ...throttle,
                throttle: mode === "coast" || braking ? 0 : 1,
                brake: braking ? 1 : 0,
                steer,
              },
              true,
              false,
            );
            if (p.speed > 5)
              peak = Math.max(peak, Math.abs(p.telemetry.slipAngle));
            assert.ok(
              tiltDegrees(p.rotation) < 15,
              "normal turn lifted the chassis",
            );
            assert.ok(p.contacts >= 3, "normal turn lost tyre contact");
            assert.equal(
              p.drifting,
              false,
              "ordinary steering displayed a drift",
            );
            assert.equal(
              p.driftTargetAngle,
              0,
              "steering armed a drift without a handbrake pull",
            );
            assert.equal(
              p.rearGripFactor,
              1,
              "ordinary cornering retained drift tyre settings",
            );
          }
          // E Final has a longer wheelbase and wider track; allow small transient
          // slip below the drift exit angle while retaining every grip-state check.
          assert.ok(
            peak < 8,
            `${kmh} km/h ${mode} side ${side} lost grip: ${peak} degrees`,
          );
          worstSlip = Math.max(worstSlip, peak);
          cases++;
        }
    console.log(
      JSON.stringify({ normalGripCases: cases, worstSlipDegrees: worstSlip }),
    );
  } finally {
    p.dispose();
    f.road.geometry.dispose();
  }
});
