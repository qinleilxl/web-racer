import { test } from "node:test";
import assert from "node:assert/strict";
import { Physics } from "../src/game/Physics";
import { PHYSICS_STEP as dt, steeringAngleLimit } from "../src/game/Driving";
import { flatCircuit, parked, throttle, tiltDegrees } from "./helpers/driving";

test("after a drift returns to straight travel, either steering direction takes effect before tyre grip finishes recovering", async () => {
  const f = flatCircuit(),
    p = await Physics.create(f.road, f.track);
  let cases = 0,
    recoveringTyreCases = 0,
    minAt100ms = Infinity,
    minAt250ms = Infinity;
  try {
    for (const kmh of [60, 100, 160])
      for (const driftSide of [-1, 1])
        for (const turn of [-1, 1])
          for (const wait of [0, 30]) {
            p.reset(f.track, 0);
            for (let i = 0; i < 120; i++) p.step(dt, parked, true, false);
            for (let i = 0; i < 2400 && p.speed * 3.6 < kmh; i++)
              p.step(dt, throttle, true, false);
            for (let i = 0; i < 108; i++)
              p.step(
                dt,
                { ...throttle, steer: driftSide, handbrake: i < 12 },
                true,
                false,
              );
            assert.ok(p.drifting, "fixture did not enter a real drift");
            let aligned = false;
            for (let i = 0; i < 720; i++) {
              p.step(dt, throttle, true, false);
              if (
                !p.drifting &&
                Math.abs(p.telemetry.slipAngle) < 2 &&
                Math.abs(p.telemetry.yawRate) < 3
              ) {
                aligned = true;
                break;
              }
            }
            assert.ok(aligned, "fixture did not return to straight travel");
            for (let i = 0; i < wait; i++) p.step(dt, throttle, true, false);
            if (p.rearGripFactor < 0.97) recoveringTyreCases++;
            const scenario = `${kmh} km/h, drift ${driftSide}, steer ${turn}, wait ${wait / 120}s`;
            let lastGrip = p.rearGripFactor;
            for (let i = 0; i < 30; i++) {
              p.step(dt, { ...throttle, steer: turn }, true, false);
              const ratio =
                (-p.wheel(0).GetSteerAngle() * turn) /
                steeringAngleLimit(p.speed);
              if (i === 11) {
                assert.ok(
                  ratio > 0.45,
                  `${scenario}: steering swallowed after 100ms: ${ratio}`,
                );
                minAt100ms = Math.min(minAt100ms, ratio);
              }
              if (i === 29) {
                assert.ok(
                  ratio > 0.85 && ratio < 1.15,
                  `${scenario}: steering still delayed after 250ms: ${ratio}`,
                );
                assert.ok(
                  -p.telemetry.yawRate * turn > 3,
                  `${scenario}: front wheels turned but the car did not respond`,
                );
                minAt250ms = Math.min(minAt250ms, ratio);
              }
              assert.ok(
                (p.rearGripFactor - lastGrip) / dt <=
                  p.tuning.gripRecovery + 1e-5,
                "handoff snapped tyre grip back",
              );
              lastGrip = p.rearGripFactor;
              assert.ok(tiltDegrees(p.rotation) < 15);
              assert.equal(
                p.drifting,
                false,
                "handing control back re-armed drift",
              );
            }
            // A second input must not reactivate the previous recovery controller.
            for (let i = 0; i < 12; i++) p.step(dt, throttle, true, false);
            for (let i = 0; i < 30; i++)
              p.step(dt, { ...throttle, steer: -turn }, true, false);
            assert.ok(
              (p.wheel(0).GetSteerAngle() * turn) /
                steeringAngleLimit(p.speed) >
                0.85,
              `${scenario}: recovery swallowed the next steering input`,
            );
            assert.equal(p.drifting, false);
            for (let i = 0; i < 120; i++) p.step(dt, throttle, true, false);
            assert.ok(
              Math.abs(p.telemetry.yawRate) < 3,
              `${scenario}: releasing steering retained a recovery turn`,
            );
            cases++;
          }
    assert.ok(
      recoveringTyreCases >= 12,
      "fixtures waited for tyre recovery and missed the handoff interval",
    );
    console.log(
      JSON.stringify({
        steeringHandoffCases: cases,
        recoveringTyreCases,
        minimumSteeringFractionAt100ms: minAt100ms,
        minimumSteeringFractionAt250ms: minAt250ms,
      }),
    );
  } finally {
    p.dispose();
    f.road.geometry.dispose();
  }
});
