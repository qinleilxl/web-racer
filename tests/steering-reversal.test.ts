import { test } from "node:test";
import assert from "node:assert/strict";
import { Physics } from "../src/game/Physics";
import { PHYSICS_STEP as dt, steeringAngleLimit } from "../src/game/Driving";
import { VEHICLES } from "../src/game/Vehicles";
import { vehicleDefaults } from "../src/game/Tuning";
import {
  flatCircuit,
  parked,
  launch,
  throttle,
  tiltDegrees,
} from "./helpers/driving";

test("all four cars promptly reverse a held turn at 80-200 km/h without returning to the old rotation", async () => {
  const records = [];
  for (const vehicle of Object.values(VEHICLES)) {
    const f = flatCircuit();
    const p = await Physics.create(
      f.road,
      f.track,
      vehicleDefaults(vehicle.id),
      { roadside: false },
      vehicle.geometry,
    );
    try {
      for (const kmh of [80, 120, 160, 200])
        for (const side of [-1, 1]) {
          p.reset(f.track, 0);
          for (let i = 0; i < 120; i++) p.step(dt, parked, true, false);
          launch(p, kmh, 0);
          for (let i = 0; i < 120; i++)
            p.step(dt, { ...throttle, steer: -side }, true, false);
          assert.ok(
            p.telemetry.yawRate * side > 5,
            "fixture did not establish the original turn",
          );
          let wheelTime: number | null = null,
            yawTime: number | null = null,
            peakSlip = 0;
          for (let i = 0; i < 240; i++) {
            p.step(dt, { ...throttle, steer: side }, true, false);
            if (wheelTime === null && -p.wheel(0).GetSteerAngle() * side > 0)
              wheelTime = (i + 1) * dt;
            if (yawTime === null && -p.telemetry.yawRate * side > 1)
              yawTime = (i + 1) * dt;
            if (i >= 60)
              assert.ok(
                p.telemetry.yawRate * side < 2,
                `${vehicle.id} ${kmh}: returned to the previous turn while opposite steering stayed held`,
              );
            peakSlip = Math.max(peakSlip, Math.abs(p.telemetry.slipAngle));
            assert.equal(p.drifting, false);
            assert.ok(
              p.contacts >= 3 && tiltDegrees(p.rotation) < 18,
              "direction change lifted the car",
            );
          }
          const scenario = `${vehicle.id} ${kmh} km/h side ${side}`;
          assert.ok(
            wheelTime !== null && wheelTime <= 0.06,
            `${scenario}: front wheels reversed too late: ${wheelTime}`,
          );
          assert.ok(
            yawTime !== null && yawTime <= 0.35,
            `${scenario}: chassis reversed too late: ${yawTime}`,
          );
          assert.ok(
            peakSlip < 26,
            `${scenario}: reversal created an uncontrolled slide: ${peakSlip}`,
          );
          records.push({
            vehicle: vehicle.id,
            kmh,
            side,
            wheelTime,
            yawTime,
            peakSlip,
          });
        }
    } finally {
      p.dispose();
      f.road.geometry.dispose();
    }
  }
  console.log(JSON.stringify({ directionChanges: records }));
});

test("steering reserve grows progressively across road speeds on every wheelbase", () => {
  for (const vehicle of Object.values(VEHICLES)) {
    const t = vehicleDefaults(vehicle.id),
      wheelbase = vehicle.geometry.frontAxle - vehicle.geometry.rearAxle;
    let lastGain = 1;
    for (const kmh of [40, 60, 80, 100, 120, 160, 200]) {
      const speed = kmh / 3.6;
      const oldLimit = Math.min(
        0.52,
        Math.atan((wheelbase * t.steeringGrip) / (speed * speed + 9)),
      );
      // Disable the existing 70-80 km/h bump to inspect the new shared envelope.
      const actual = steeringAngleLimit(
        speed,
        0,
        t.steeringGrip,
        wheelbase,
        false,
      );
      const gain = actual / oldLimit;
      assert.ok(
        gain > lastGain,
        `${vehicle.id}: faster travel did not receive more steering reserve`,
      );
      lastGain = gain;
    }
  }
});
