import { test } from "node:test";
import assert from "node:assert/strict";
import { Physics } from "../src/game/Physics";
import { PHYSICS_STEP, steeringAngleLimit } from "../src/game/Driving";
import {
  flatCircuit,
  straightCircuit,
  parked,
  throttle,
  launch,
  tiltDegrees,
} from "./helpers/driving";

test("keyboard steering bites promptly and builds lock with hold duration", async () => {
  const f = flatCircuit(),
    p = await Physics.create(f.road, f.track);
  const measurements = [];
  try {
    for (const direction of [-1, 1]) {
      p.reset(f.track, 0);
      for (let i = 0; i < 120; i++) p.step(PHYSICS_STEP, parked, true, false);
      for (let i = 0; i < 2400 && p.speed < 100 / 3.6; i++)
        p.step(PHYSICS_STEP, throttle, true, false);
      const samples: number[] = [];
      for (let i = 0; i < 30; i++) {
        p.step(PHYSICS_STEP, { ...throttle, steer: direction }, true, false);
        if ([2, 11, 29].includes(i))
          samples.push(
            (-p.wheel(0).GetSteerAngle() * direction) /
              steeringAngleLimit(p.speed),
          );
      }
      assert.ok(samples[0] > 0.2, "steering had no initial bite after 25ms");
      assert.ok(
        samples[1] > samples[0] + 0.15 && samples[2] > samples[1] + 0.15,
        "hold duration did not progressively increase steering",
      );
      assert.ok(
        samples[2] > 0.85 && samples[2] < 1.1,
        "held steering did not reach the current-speed limit",
      );
      for (let i = 0; i < 12; i++) p.step(PHYSICS_STEP, throttle, true, false);
      assert.ok(
        Math.abs(p.wheel(0).GetSteerAngle()) <
          steeringAngleLimit(p.speed) * 0.1,
        "released steering remained delayed",
      );
      measurements.push(samples);
    }
    console.log(
      JSON.stringify({ keyboardSteeringAt25_100_250ms: measurements }),
    );
  } finally {
    p.dispose();
    f.road.geometry.dispose();
  }
});

test("high-speed steering taps return both front wheels and powered travel to straight ahead without lifting throttle", async () => {
  const f = flatCircuit(),
    p = await Physics.create(f.road, f.track);
  let cases = 0,
    worstLateYaw = 0;
  try {
    for (const kmh of [100, 140, 170])
      for (const side of [-1, 1])
        for (const frames of [10, 30, 60]) {
          p.reset(f.track, 0);
          for (let i = 0; i < 120; i++)
            p.step(PHYSICS_STEP, parked, true, false);
          for (let i = 0; i < 2400 && p.speed * 3.6 < kmh; i++)
            p.step(PHYSICS_STEP, throttle, true, false);
          for (let i = 0; i < frames; i++)
            p.step(PHYSICS_STEP, { ...throttle, steer: side }, true, false);
          let lateYaw = 0;
          for (let i = 0; i < 360; i++) {
            p.step(PHYSICS_STEP, throttle, true, false);
            assert.equal(
              p.drifting,
              false,
              "steering release entered drift state",
            );
            if (i >= 11)
              for (const wheel of [0, 1])
                assert.ok(
                  Math.abs(p.wheel(wheel).GetSteerAngle()) <
                    steeringAngleLimit(p.speed) * 0.06,
                  "front wheel failed to return to centre after 100ms",
                );
            if (i >= 96)
              lateYaw = Math.max(lateYaw, Math.abs(p.telemetry.yawRate));
          }
          assert.ok(
            lateYaw < 2,
            `${kmh} km/h ${side} ${frames} frames kept turning under power: ${lateYaw} deg/s`,
          );
          assert.ok(
            p.speed * 3.6 > kmh * 0.95,
            "straightening cut power instead of settling yaw",
          );
          worstLateYaw = Math.max(worstLateYaw, lateYaw);
          cases++;
        }
    console.log(
      JSON.stringify({
        poweredSteeringReleaseCases: cases,
        worstLateYawDegreesPerSecond: worstLateYaw,
      }),
    );
  } finally {
    p.dispose();
    f.road.geometry.dispose();
  }
});

test("a handbrake tap can be held into a spin and its released rotation carries inertia", async () => {
  const f = flatCircuit(),
    p = await Physics.create(f.road, f.track);
  const records = [];
  try {
    for (const direction of [-1, 1]) {
      p.reset(f.track, 0);
      for (let i = 0; i < 120; i++) p.step(PHYSICS_STEP, parked, true, false);
      for (let i = 0; i < 2400 && p.speed < 100 / 3.6; i++)
        p.step(PHYSICS_STEP, throttle, true, false);
      let spun = false,
        lastGrip = p.rearGripFactor;
      for (let i = 0; i < 600; i++) {
        p.step(
          PHYSICS_STEP,
          { ...throttle, steer: direction, handbrake: i < 30 },
          true,
          false,
        );
        assert.ok(
          tiltDegrees(p.rotation) < 20,
          "held steering rolled the chassis",
        );
        if (Math.abs(p.telemetry.slipAngle) > 105) {
          spun = true;
          break;
        }
      }
      assert.ok(
        spun,
        "releasing the handbrake cancelled the held steering's spin",
      );
      const start = p.position.clone(),
        speed = p.speed,
        yaw = p.telemetry.yawRate;
      assert.ok(
        Math.abs(yaw) > 30,
        "spin fixture did not have angular momentum",
      );
      lastGrip = p.rearGripFactor;
      for (let i = 0; i < 30; i++) {
        p.step(PHYSICS_STEP, { ...throttle, throttle: 0 }, true, false);
        assert.ok(
          (p.rearGripFactor - lastGrip) / PHYSICS_STEP <=
            p.tuning.gripRecovery + 1e-5,
          "spin snapped rear grip back",
        );
        lastGrip = p.rearGripFactor;
        if (i < 18)
          assert.ok(
            p.telemetry.yawRate * yaw > 0,
            "neutral input instantly reversed spin rotation",
          );
      }
      const distance = p.position.distanceTo(start);
      assert.ok(
        distance > speed * 0.25 * 0.65,
        "neutral input killed the inertial slide",
      );
      records.push({
        direction,
        spinSlipDegrees: p.telemetry.slipAngle,
        coastDistance: distance,
        yawBefore: yaw,
        yawAfter: p.telemetry.yawRate,
      });
    }
    console.log(JSON.stringify({ tapInitiatedSpins: records }));
  } finally {
    p.dispose();
    f.road.geometry.dispose();
  }
});

test("throttle and steering can drive away after a stopped wall impact", async () => {
  const f = straightCircuit(),
    p = await Physics.create(f.road, f.track);
  try {
    for (const side of [-1, 1]) {
      p.reset(f.track, 100, side * 1.6);
      for (let i = 0; i < 120; i++) p.step(PHYSICS_STEP, parked, true, false);
      launch(p, 30, (side * 85 * Math.PI) / 180);
      for (let i = 0; i < 180 && !p.touchingWall; i++)
        p.step(PHYSICS_STEP, { ...parked, handbrake: false }, true, false);
      assert.ok(p.touchingWall, "fixture missed wall");
      for (let i = 0; i < 180; i++) p.step(PHYSICS_STEP, parked, true, false);
      assert.ok(p.speed < 1, "fixture did not stop after impact");
      const start = p.position.clone();
      let escaped = false;
      for (let i = 0; i < 360; i++) {
        p.step(PHYSICS_STEP, { ...throttle, steer: side }, true, false);
        if (
          !p.touchingWall &&
          p.forwardSpeed > 3 &&
          p.position.distanceTo(start) > 3
        ) {
          escaped = true;
          break;
        }
      }
      assert.ok(
        escaped,
        "engine could not accelerate the car away from the wall",
      );
    }
  } finally {
    p.dispose();
    f.road.geometry.dispose();
  }
});
