import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { Physics } from "../src/game/Physics";
import { PHYSICS_STEP } from "../src/game/Driving";
import {
  flatCircuit,
  curvedCircuit,
  launch,
  parked,
  throttle,
  tiltDegrees,
} from "./helpers/driving";
const settle = (p: Physics) => {
  for (let i = 0; i < 120; i++) p.step(PHYSICS_STEP, parked, true, false);
};

test("keyboard hold duration gives distinct controlled drift angles at 60 and 120 Hz", async () => {
  const measurements: number[][] = [];
  for (const hz of [60, 120]) {
    const flat = flatCircuit(),
      p = await Physics.create(flat.road, flat.track);
    const angles: number[] = [];
    try {
      for (const hold of [0.25, 0.5, 0.8, 1.2]) {
        p.reset(flat.track, 0);
        settle(p);
        const t = flat.track.tangent(0);
        launch(p, 100, Math.atan2(t.x, t.z));
        let peak = 0;
        for (let i = 0; i < Math.round((hold + 0.6) * hz); i++) {
          p.step(
            1 / hz,
            {
              ...throttle,
              steer: i < Math.round(hold * hz) ? 1 : 0,
              handbrake: true,
            },
            true,
            false,
          );
          peak = Math.max(peak, (Math.abs(p.slipAngle) * 180) / Math.PI);
          assert.ok(
            tiltDegrees(p.rotation) < 15,
            "controlled drift lifted the car",
          );
        }
        angles.push(peak);
        assert.ok(peak < 50, `drift spun out: ${hold}s -> ${peak}`);
      }
      for (let i = 1; i < 4; i++)
        assert.ok(
          angles[i] > angles[i - 1] + 5,
          `duration lost angle control: ${angles}`,
        );
      assert.ok(
        angles[0] > 3 && angles[0] < 15,
        `tap did not make a small slide: ${angles[0]}`,
      );
      measurements.push(angles);
    } finally {
      p.dispose();
      flat.road.geometry.dispose();
    }
  }
  for (let i = 0; i < 4; i++)
    assert.ok(
      Math.abs(measurements[0][i] - measurements[1][i]) < 3,
      "drift depended on update frequency",
    );
  console.log(
    JSON.stringify({
      durationSeconds: [0.25, 0.5, 0.8, 1.2],
      peakSlipDegrees: measurements,
    }),
  );
});

test("countersteer reduces a held drift and releasing the handbrake restores grip", async () => {
  const flat = flatCircuit(),
    p = await Physics.create(flat.road, flat.track);
  try {
    settle(p);
    const t = flat.track.tangent(0);
    launch(p, 100, Math.atan2(t.x, t.z));
    for (let i = 0; i < 96; i++)
      p.step(
        PHYSICS_STEP,
        { ...throttle, steer: 1, handbrake: true },
        true,
        false,
      );
    for (let i = 0; i < 48; i++)
      p.step(PHYSICS_STEP, { ...throttle, handbrake: true }, true, false);
    const held = Math.abs(p.slipAngle);
    for (let i = 0; i < 30; i++)
      p.step(
        PHYSICS_STEP,
        { ...throttle, steer: -1, handbrake: true },
        true,
        false,
      );
    for (let i = 0; i < 48; i++)
      p.step(PHYSICS_STEP, { ...throttle, handbrake: true }, true, false);
    const corrected = Math.abs(p.slipAngle);
    assert.ok(
      corrected < held * 0.7,
      `countersteer did not unwind the slide: ${held} -> ${corrected}`,
    );
    const releaseSpeed = p.speed;
    let minSpeed = releaseSpeed;
    for (let i = 0; i < 240; i++) {
      p.step(PHYSICS_STEP, throttle, true, false);
      minSpeed = Math.min(minSpeed, p.speed);
    }
    assert.ok(
      Math.abs(p.slipAngle) < (5 * Math.PI) / 180,
      "handbrake release did not regain grip",
    );
    assert.ok(
      minSpeed > releaseSpeed * 0.75,
      "recovery caused a sudden speed collapse",
    );
  } finally {
    p.dispose();
    flat.road.geometry.dispose();
  }
});

test("rubbing clockwise and anticlockwise walls follows the changing road tangent and progressively loses speed", async () => {
  const records = [];
  for (const bend of [-1, 1]) {
    const f = curvedCircuit(45, bend),
      p = await Physics.create(f.road, f.track),
      side = -bend;
    try {
      p.reset(f.track, 100, side * 3);
      settle(p);
      const t = f.track.tangent(100);
      launch(p, 120, Math.atan2(t.x, t.z) + side * 0.15);
      const start = new Vector3();
      // Capture the road's initial direction; world heading must not remain locked to it.
      start.copy(t).setY(0).normalize();
      let maxError = 0,
        contactSteps = 0,
        maxLateSpeed = 0,
        maxTilt = 0,
        maxPenalty = 0;
      for (let i = 0; i < 960; i++) {
        p.step(PHYSICS_STEP, { ...throttle, steer: -side }, true, false);
        const route = f.track
          .tangent(f.track.nearest(p.position).index)
          .setY(0)
          .normalize();
        const heading = new Vector3(0, 0, 1)
          .applyQuaternion(p.rotation)
          .setY(0)
          .normalize();
        if (p.touchingWall) {
          contactSteps++;
          maxError = Math.max(
            maxError,
            (heading.angleTo(route) * 180) / Math.PI,
          );
        }
        if (i > 360) maxLateSpeed = Math.max(maxLateSpeed, p.speed * 3.6);
        maxTilt = Math.max(maxTilt, tiltDegrees(p.rotation));
        maxPenalty = Math.max(maxPenalty, p.wallScrape);
      }
      const final = new Vector3(0, 0, 1)
        .applyQuaternion(p.rotation)
        .setY(0)
        .normalize();
      assert.ok(
        contactSteps > 800,
        "fixture did not sustain contact with the curved wall",
      );
      assert.ok(
        maxError < 32,
        `nose did not follow the curved road: ${maxError}`,
      );
      assert.ok(
        start.angleTo(final) > Math.PI / 2,
        "world heading stayed fixed while road turned",
      );
      assert.ok(
        maxPenalty > 0.95 && maxLateSpeed < 72,
        `wall riding retained racing speed: ${maxLateSpeed}`,
      );
      assert.ok(
        p.speed * 3.6 > 30 && maxTilt < 25,
        "wall response pinned or flipped the car",
      );
      p.reset(f.track, 0);
      assert.equal(p.wallScrape, 0, "reset retained the wall speed penalty");
      records.push({
        bend,
        maxHeadingErrorDegrees: maxError,
        maxSpeedAfter3Seconds: maxLateSpeed,
        maxTiltDegrees: maxTilt,
      });
    } finally {
      p.dispose();
      f.road.geometry.dispose();
    }
  }
  console.log(JSON.stringify({ curvedWallCases: records }));
});

test("tapping either direction during a drift changes slip, while neutral input progressively returns to grip", async () => {
  const f = flatCircuit(),
    p = await Physics.create(f.road, f.track),
    angles: number[] = [];
  try {
    for (const tap of [-1, 0, 1]) {
      p.reset(f.track, 0);
      settle(p);
      const t = f.track.tangent(0);
      launch(p, 100, Math.atan2(t.x, t.z));
      for (let i = 0; i < 90; i++)
        p.step(
          PHYSICS_STEP,
          { ...throttle, steer: 1, handbrake: true },
          true,
          false,
        );
      for (let i = 0; i < 12; i++)
        p.step(
          PHYSICS_STEP,
          { ...throttle, steer: tap, handbrake: true },
          true,
          false,
        );
      for (let i = 0; i < 30; i++)
        p.step(PHYSICS_STEP, { ...throttle, handbrake: true }, true, false);
      angles.push((Math.abs(p.slipAngle) * 180) / Math.PI);
    }
    assert.ok(
      angles[0] < angles[1] - 2 && angles[2] > angles[1] + 2,
      `drift taps did not adjust slip: ${angles}`,
    );
    const before = p.driftTargetAngle;
    for (let i = 0; i < 12; i++)
      p.step(PHYSICS_STEP, { ...throttle, handbrake: true }, true, false);
    assert.ok(
      p.driftTargetAngle < before * 1.05 && p.driftTargetAngle > before * 0.6,
      "neutral input snapped instead of decaying",
    );
    for (let i = 0; i < 228; i++)
      p.step(PHYSICS_STEP, { ...throttle, handbrake: true }, true, false);
    assert.ok(
      Math.abs(p.slipAngle) < (4 * Math.PI) / 180 && !p.drifting,
      "holding Space without direction did not restore grip",
    );
    assert.ok(
      p.forwardSpeed > p.speed * 0.98 && p.contacts >= 3,
      "neutral drift recovery lost forward traction",
    );
    console.log(
      JSON.stringify({ slipAfter100msTapAnd250msSettle: angles }),
    );
  } finally {
    p.dispose();
    f.road.geometry.dispose();
  }
});

test("holding a drift direction beyond the grip range can spin the car on both sides without rolling it", async () => {
  const f = flatCircuit(),
    p = await Physics.create(f.road, f.track),
    records = [];
  try {
    for (const direction of [-1, 1]) {
      p.reset(f.track, 0);
      settle(p);
      const t = f.track.tangent(0);
      launch(p, 100, Math.atan2(t.x, t.z));
      let heading = t.clone().setY(0).normalize(),
        turn = 0,
        peakSlip = 0,
        maxTilt = 0;
      for (let i = 0; i < 480; i++) {
        p.step(
          PHYSICS_STEP,
          { ...throttle, steer: direction, handbrake: true },
          true,
          false,
        );
        const next = new Vector3(0, 0, 1)
          .applyQuaternion(p.rotation)
          .setY(0)
          .normalize();
        turn += Math.atan2(heading.clone().cross(next).y, heading.dot(next));
        heading = next;
        if (p.speed > 4)
          peakSlip = Math.max(
            peakSlip,
            (Math.abs(p.slipAngle) * 180) / Math.PI,
          );
        maxTilt = Math.max(maxTilt, tiltDegrees(p.rotation));
      }
      assert.ok(
        Math.abs(turn) > (150 * Math.PI) / 180 && peakSlip > 100,
        `overholding never spun the car: ${(turn * 180) / Math.PI}, ${peakSlip}`,
      );
      assert.ok(maxTilt < 25, "spin rolled the chassis");
      records.push({
        direction,
        totalYawDegrees: (turn * 180) / Math.PI,
        peakSlipDegrees: peakSlip,
        maxTiltDegrees: maxTilt,
      });
    }
    console.log(JSON.stringify({ overheldDrift: records }));
  } finally {
    p.dispose();
    f.road.geometry.dispose();
  }
});
