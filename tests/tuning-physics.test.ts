import { test } from "node:test";
import assert from "node:assert/strict";
import { Physics } from "../src/game/Physics";
import { PHYSICS_STEP } from "../src/game/Driving";
import {
  DEFAULT_TUNING,
  TUNING_PRESETS,
  tuningPreset,
  type PhysicsTuning,
} from "../src/game/Tuning";
import { flatCircuit, parked, throttle, tiltDegrees } from "./helpers/driving";

async function withCar(
  tuning: PhysicsTuning,
  action: (p: Physics) => void | Promise<void>,
) {
  const flat = flatCircuit();
  const p = await Physics.create(flat.road, flat.track, tuning);
  try {
    for (let i = 0; i < 180; i++) p.step(PHYSICS_STEP, parked, true, false);
    await action(p);
  } finally {
    p.dispose();
    flat.road.geometry.dispose();
  }
}

function checkTelemetry(p: Physics) {
  const telemetry = p.telemetry;
  for (const value of [
    p.speed,
    ...p.position.toArray(),
    ...p.rotation.toArray(),
    telemetry.slipAngle,
    telemetry.yawRate,
    telemetry.longitudinalG,
    telemetry.lateralG,
    telemetry.rearGrip,
    telemetry.impactSpeed,
    telemetry.tcs,
    telemetry.abs,
  ])
    assert.ok(
      Number.isFinite(value),
      "simulation or telemetry became non-finite",
    );
  assert.equal(telemetry.wheels.length, 4);
  for (const wheel of telemetry.wheels) {
    for (const value of [
      wheel.load,
      wheel.slipRatio,
      wheel.slipAngle,
      wheel.gripUsage,
      wheel.suspension,
    ])
      assert.ok(Number.isFinite(value), "wheel telemetry became non-finite");
    assert.ok(wheel.load >= 0);
    assert.ok(wheel.gripUsage >= 0 && wheel.gripUsage <= 2);
    if (!wheel.grounded) {
      assert.equal(wheel.load, 0);
      assert.equal(wheel.gripUsage, 0);
    }
  }
}

test("tuning reaches the native chassis, suspension and AWD drivetrain, and reduced torque slows acceleration", async () => {
  const custom = {
    ...DEFAULT_TUNING,
    mass: 1230,
    torque: 260,
    frontDrive: 35,
    finalDrive: 4.2,
    frontFrequency: 2.2,
    rearFrequency: 1.4,
    suspensionDamping: 0.8,
  };
  await withCar(custom, (p) => {
    assert.ok(
      Math.abs(
        1 / p.body.GetMotionProperties().GetInverseMass() - custom.mass,
      ) < 0.01,
    );
    assert.equal(p.controller.GetEngine().mMaxTorque, custom.torque);
    const diffs = p.controller.GetDifferentials();
    assert.equal(
      diffs.size(),
      2,
      "AWD must create a differential on each axle",
    );
    for (let axle = 0; axle < 2; axle++) {
      const diff = diffs.at(axle);
      assert.equal(diff.mLeftWheel, axle * 2);
      assert.equal(diff.mRightWheel, axle * 2 + 1);
      assert.ok(Math.abs(diff.mDifferentialRatio - custom.finalDrive) < 1e-5);
      assert.ok(
        Math.abs(diff.mEngineTorqueRatio - (axle === 0 ? 0.35 : 0.65)) < 1e-5,
      );
      const settings = p.wheel(axle * 2).GetSettings();
      assert.ok(
        Math.abs(
          settings.mSuspensionSpring.mFrequency -
            (axle === 0 ? custom.frontFrequency : custom.rearFrequency),
        ) < 1e-5,
      );
      assert.ok(
        Math.abs(
          settings.mSuspensionSpring.mDamping - custom.suspensionDamping,
        ) < 1e-5,
      );
    }
    checkTelemetry(p);
    const supportedWeight = p.telemetry.wheels.reduce(
      (total, wheel) => total + wheel.load,
      0,
    );
    assert.ok(
      Math.abs(supportedWeight / (custom.mass * custom.gravity) - 1) < 0.15,
      `suspension load does not support the configured vehicle weight: ${supportedWeight}`,
    );
  });
  const speeds: number[] = [];
  for (const torque of [180, DEFAULT_TUNING.torque]) {
    await withCar({ ...DEFAULT_TUNING, torque }, (p) => {
      for (let i = 0; i < 600; i++) p.step(PHYSICS_STEP, throttle, true, false);
      checkTelemetry(p);
      speeds.push(p.speed * 3.6);
    });
  }
  assert.ok(
    speeds[0] < speeds[1] * 0.8,
    `engine tuning did not change acceleration: low/default ${speeds}`,
  );
  console.log(
    JSON.stringify({
      tuningAccelerationKmhAfter5s: {
        torque180: speeds[0],
        standard: speeds[1],
      },
    }),
  );
});

test("lower track grip increases braking distance from the same naturally reached speed", async () => {
  const distances: number[] = [];
  for (const roadGrip of [1, 0.5]) {
    await withCar(
      { ...DEFAULT_TUNING, roadGrip, shoulderGrip: roadGrip },
      (p) => {
        for (let i = 0; i < 2400 && p.speed < 80 / 3.6; i++)
          p.step(PHYSICS_STEP, throttle, true, false);
        assert.ok(
          p.speed >= 80 / 3.6,
          "braking fixture failed to reach 80 km/h",
        );
        const start = p.position.clone();
        let stopped = false;
        for (let i = 0; i < 1200; i++) {
          p.step(
            PHYSICS_STEP,
            { ...throttle, throttle: 0, brake: 1 },
            true,
            false,
          );
          checkTelemetry(p);
          if (p.speed < 1.5) {
            stopped = true;
            break;
          }
        }
        assert.ok(stopped, "service braking did not stop the vehicle");
        distances.push(p.position.distanceTo(start));
      },
    );
  }
  assert.ok(
    distances[1] > distances[0] * 1.2,
    `wet track should require more braking distance: dry/wet ${distances}`,
  );
  console.log(
    JSON.stringify({
      brakingDistanceFrom80Kmh: { dry: distances[0], wet: distances[1] },
    }),
  );
});

test("all provided setup presets survive acceleration, steering, drift and recovery with valid wheel feedback", async () => {
  const records = [];
  for (const name of Object.keys(TUNING_PRESETS)) {
    await withCar(tuningPreset(name), (p) => {
      let maxTilt = 0,
        observedLoadTransfer = 0,
        observedUsage = 0;
      for (let i = 0; i < 1080; i++) {
        const input =
          i < 480
            ? throttle
            : i < 660
              ? { ...throttle, steer: i < 570 ? 0.7 : -0.7 }
              : i < 732
                ? { ...throttle, steer: 0.6, handbrake: true }
                : throttle;
        p.step(PHYSICS_STEP, input, true, false);
        checkTelemetry(p);
        const wheels = p.telemetry.wheels;
        observedUsage = Math.max(
          observedUsage,
          ...wheels.map((wheel) => wheel.gripUsage),
        );
        observedLoadTransfer = Math.max(
          observedLoadTransfer,
          Math.abs(
            wheels[0].load + wheels[1].load - wheels[2].load - wheels[3].load,
          ),
        );
        maxTilt = Math.max(maxTilt, tiltDegrees(p.rotation));
      }
      assert.ok(maxTilt < 25, `${name} preset rolled the chassis: ${maxTilt}`);
      assert.ok(
        observedLoadTransfer > 100,
        `${name} preset did not report load transfer`,
      );
      assert.ok(
        observedUsage > 0.1,
        `${name} preset never reported actual tyre work`,
      );
      records.push({ preset: name, maxTilt, maxGripUsage: observedUsage });
    });
  }
  console.log(JSON.stringify({ presetDriving: records }));
});

test("wheelspin and brake locking activate signed-slip assists, while zero-strength settings disable them", async () => {
  const records = [];
  for (const strength of [0, 100]) {
    await withCar(
      {
        ...DEFAULT_TUNING,
        torque: 700,
        roadGrip: 0.5,
        shoulderGrip: 0.5,
        brakeTorque: 2800,
        tractionControl: strength,
        abs: strength,
      },
      (p) => {
        let tcsPeak = 0,
          absPeak = 0,
          wheelspin = 0,
          locking = 0;
        for (let i = 0; i < 3000 && p.speed < 80 / 3.6; i++) {
          p.step(PHYSICS_STEP, throttle, true, false);
          checkTelemetry(p);
          tcsPeak = Math.max(tcsPeak, p.telemetry.tcs);
          wheelspin = Math.max(
            wheelspin,
            ...p.telemetry.wheels.slice(2).map((w) => w.slipRatio),
          );
          assert.equal(
            p.telemetry.abs,
            0,
            "ABS must not activate under throttle",
          );
        }
        assert.ok(
          p.speed >= 80 / 3.6,
          "assist test failed to reach braking speed",
        );
        for (let i = 0; i < 1200 && p.speed > 1.5; i++) {
          p.step(
            PHYSICS_STEP,
            { ...throttle, throttle: 0, brake: 1 },
            true,
            false,
          );
          checkTelemetry(p);
          absPeak = Math.max(absPeak, p.telemetry.abs);
          locking = Math.min(
            locking,
            ...p.telemetry.wheels.map((w) => w.slipRatio),
          );
        }
        assert.ok(
          p.speed < 1.5,
          "braking did not stop the high-power test car",
        );
        assert.ok(
          wheelspin > 0.18,
          `fixture did not create driven-wheel slip: ${wheelspin}`,
        );
        assert.ok(
          locking < -0.15,
          `fixture did not create negative locking slip: ${locking}`,
        );
        if (strength === 0) {
          assert.equal(
            tcsPeak,
            0,
            "TCS remained active with strength set to zero",
          );
          assert.equal(
            absPeak,
            0,
            "ABS remained active with strength set to zero",
          );
        } else {
          assert.ok(
            tcsPeak > 0.02,
            `wheelspin failed to activate TCS: ${tcsPeak}`,
          );
          assert.ok(
            absPeak > 0.02,
            `brake locking failed to activate ABS: ${absPeak}`,
          );
        }
        records.push({ strength, tcsPeak, absPeak, wheelspin, locking });
      },
    );
  }
  console.log(JSON.stringify({ electronicAssistScenarios: records }));
});
