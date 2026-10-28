import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { Physics } from "../src/game/Physics";
import { Race } from "../src/game/Race";
import { steeringAngleLimit } from "../src/game/Driving";
import { loadCoastalCircuit } from "./helpers/coastal";
const { collision, track } = await loadCoastalCircuit();
const neutral = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: true,
  boost: false,
};
test("real Jolt vehicle finishes ten independently restarted challenges without relocation during driving", async () => {
  const p = await Physics.create(collision, track);
  let maxDistance = 0;
  let minContacts = 4;
  const times: number[] = [];
  try {
    for (let lap = 0; lap < 10; lap++) {
      p.reset(track, 0);
      for (let i = 0; i < 90; i++) p.step(1 / 60, neutral, true, false);
      assert.equal(p.contacts, 4);
      assert.ok(p.speed < 0.1);
      const race = new Race(track);
      race.relocated(p.position);
      for (let i = 0; i < 9000 && !race.finished; i++) {
        const near = track.nearest(p.position),
          lookahead = 7 + p.speed * 0.65;
        let index = near.index,
          distance = 0;
        while (distance < lookahead) {
          distance += track.point(index).distanceTo(track.point(index + 1));
          index++;
        }
        const target = track.point(index).clone().sub(p.position);
        target.y = 0;
        target.normalize();
        const forward = new Vector3(0, 0, 1).applyQuaternion(p.rotation);
        let angle =
          Math.atan2(target.x, target.z) - Math.atan2(forward.x, forward.z);
        while (angle > Math.PI) angle -= Math.PI * 2;
        while (angle < -Math.PI) angle += Math.PI * 2;
        const steering =
          -Math.atan2(2 * 2.09 * Math.sin(angle), lookahead) /
          steeringAngleLimit(Math.abs(p.forwardSpeed));
        const curve = Math.acos(
          Math.max(
            -1,
            Math.min(1, track.tangent(index).dot(track.tangent(near.index))),
          ),
        );
        // The shared tire friction budget needs braking margin before corners;
        // this route driver deliberately stays below the vehicle's grip limit.
        const targetSpeed = Math.max(
          6,
          Math.min(20, Math.sqrt((3 * lookahead) / Math.max(0.001, curve))),
        );
        p.step(
          1 / 60,
          {
            throttle: p.speed < targetSpeed ? 1 : 0,
            brake: p.speed > targetSpeed + 1 ? 1 : 0,
            steer: Math.max(-1, Math.min(1, steering)),
            handbrake: false,
            boost: false,
          },
          true,
          false,
        );
        race.update(1 / 60, p.position);
        maxDistance = Math.max(maxDistance, near.distance);
        minContacts = Math.min(minContacts, p.contacts);
        assert.ok(
          Number.isFinite(p.position.y) && near.distance < 3.5,
          `lap ${lap + 1}, sample ${near.index}: unstable vehicle`,
        );
      }
      assert.equal(race.passed, 8);
      assert.equal(race.finished, true);
      assert.ok(race.elapsed > 40 && race.elapsed < 150);
      times.push(Number(race.elapsed.toFixed(2)));
    }
    console.log(
      JSON.stringify({
        challenges: times.length,
        times,
        maxCenterlineDistanceMeters: Number(maxDistance.toFixed(3)),
        minimumGroundedWheels: minContacts,
      }),
    );
  } finally {
    p.dispose();
  }
});
test("braking, reverse, boost, wall collision and repeated resets remain stable", async () => {
  const p = await Physics.create(collision, track);
  const run = (frames: number, input = neutral, boost = false) => {
    for (let i = 0; i < frames; i++) p.step(1 / 60, input, true, boost);
  };
  try {
    run(90);
    const start = p.position.clone();
    run(180, { ...neutral, handbrake: false, throttle: 1 });
    assert.ok(p.forwardSpeed > 7);
    assert.ok(p.position.distanceTo(start) > 9);
    const brakeAndReverse = { ...neutral, handbrake: false, brake: 1 };
    // First allow the tires to brake to the low-speed direction-change range.
    // Continuing S must then reverse promptly, independently of stopping time.
    for (let i = 0; i < 240 && p.forwardSpeed > 0.65; i++) {
      run(1, brakeAndReverse);
    }
    assert.ok(
      p.forwardSpeed >= 0 && p.forwardSpeed <= 0.65,
      "S must brake forward motion into the stopping range within four seconds",
    );
    for (let i = 0; i < 60 && p.forwardSpeed >= -0.5; i++) {
      run(1, brakeAndReverse);
    }
    assert.ok(
      p.forwardSpeed < -0.5,
      "continued S must reverse within one second after stopping",
    );
    p.reset(track, 0);
    run(90);
    run(180, { ...neutral, handbrake: false, throttle: 1 });
    const normal = p.speed;
    p.reset(track, 0);
    run(90);
    run(180, { ...neutral, handbrake: false, throttle: 1 }, true);
    assert.ok(
      p.speed > normal + 4,
      "wind boost must add physical acceleration",
    );
    p.reset(track, 0);
    run(90);
    run(450, { ...neutral, handbrake: false, throttle: 1, steer: 1 });
    assert.ok(
      track.nearest(p.position).distance < track.width / 2 + 0.55,
      "wall must contain a sustained turn",
    );
    assert.ok(Number.isFinite(p.position.y));
    run(120, { ...neutral, handbrake: true, throttle: 1, steer: -1 });
    assert.ok(Number.isFinite(p.speed));
    for (let i = 0; i < 10; i++) {
      p.reset(track, i * 90);
      run(90);
      assert.ok(p.speed < 0.2);
      assert.ok(p.contacts >= 3);
      assert.ok(p.position.distanceTo(track.point(i * 90)) < 1.3);
    }
  } finally {
    p.dispose();
  }
});
