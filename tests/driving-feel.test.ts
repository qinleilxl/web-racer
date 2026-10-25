import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Raycaster, Vector3 } from "three";
import { Physics } from "../src/game/Physics";
import { PHYSICS_STEP } from "../src/game/Driving";
import { Track } from "../src/game/Track";
import { createRoadside, SHOULDER_WIDTH } from "../src/game/Roadside";
import { flatCircuit, parked, throttle, tiltDegrees } from "./helpers/driving";
const bytes = await readFile("public/assets/Road_Collision.glb");
const collision = await new GLTFLoader().parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  "",
);
const track = new Track(
  JSON.parse(await readFile("public/assets/track_route.json", "utf8")),
);

const settle = (p: Physics) => {
  for (let i = 0; i < 120; i++) p.step(PHYSICS_STEP, parked, true, false);
};
test("0–100 below 5.5 seconds and normal top speed above 165 km/h, without wheel hop", async () => {
  const flat = flatCircuit(),
    p = await Physics.create(flat.road, flat.track);
  try {
    settle(p);
    let acceleration = 0,
      maxTilt = 0,
      minContacts = 4;
    for (let i = 0; i < 1800; i++) {
      p.step(PHYSICS_STEP, throttle, true, false);
      if (!acceleration && p.speed >= 100 / 3.6)
        acceleration = (i + 1) * PHYSICS_STEP;
      maxTilt = Math.max(maxTilt, tiltDegrees(p.rotation));
      minContacts = Math.min(minContacts, p.contacts);
    }
    assert.ok(
      acceleration > 0 && acceleration < 5.5,
      `0–100: ${acceleration}s`,
    );
    assert.ok(p.speed * 3.6 > 165 && p.speed * 3.6 < 182);
    assert.ok(maxTilt < 3);
    assert.equal(minContacts, 4);
    console.log(
      JSON.stringify({
        zeroTo100Seconds: acceleration,
        topSpeedKmh: p.speed * 3.6,
        maxStraightTiltDegrees: maxTilt,
      }),
    );
  } finally {
    p.dispose();
    flat.road.geometry.dispose();
  }
});
test("full keyboard slalom at 100 and 160 km/h stays upright and grounded", async () => {
  const flat = flatCircuit(),
    p = await Physics.create(flat.road, flat.track);
  try {
    for (const kmh of [100, 160]) {
      p.reset(flat.track, 0);
      settle(p);
      for (let i = 0; i < 1800 && p.speed * 3.6 < kmh; i++)
        p.step(PHYSICS_STEP, throttle, true, false);
      let maxTilt = 0,
        minContacts = 4;
      for (let i = 0; i < 480; i++) {
        p.step(
          PHYSICS_STEP,
          { ...throttle, steer: Math.floor(i / 80) % 2 ? 1 : -1 },
          true,
          false,
        );
        maxTilt = Math.max(maxTilt, tiltDegrees(p.rotation));
        minContacts = Math.min(minContacts, p.contacts);
      }
      assert.ok(maxTilt < 15, `${kmh} km/h slalom tilt: ${maxTilt}`);
      assert.ok(minContacts >= 3, `${kmh} km/h lost all tyre contact`);
      console.log(
        JSON.stringify({
          slalomStartKmh: kmh,
          maxTiltDegrees: maxTilt,
          minContacts,
        }),
      );
    }
  } finally {
    p.dispose();
    flat.road.geometry.dispose();
  }
});
test("handbrake creates a powered controllable slide and release restores grip", async () => {
  const flat = flatCircuit(),
    p = await Physics.create(flat.road, flat.track);
  try {
    settle(p);
    for (let i = 0; i < 360; i++) p.step(PHYSICS_STEP, throttle, true, false);
    const entrySpeed = p.speed;
    let peakSlip = 0,
      maxTilt = 0,
      sawDrift = false;
    for (let i = 0; i < 150; i++) {
      p.step(
        PHYSICS_STEP,
        { ...throttle, steer: 0.65, handbrake: true },
        true,
        false,
      );
      peakSlip = Math.max(peakSlip, (Math.abs(p.slipAngle) * 180) / Math.PI);
      maxTilt = Math.max(maxTilt, tiltDegrees(p.rotation));
      sawDrift ||= p.drifting;
    }
    assert.ok(peakSlip > 15 && peakSlip < 50, `drift slip: ${peakSlip}`);
    assert.ok(sawDrift);
    assert.ok(p.speed > entrySpeed * 0.8);
    assert.ok(maxTilt < 15);
    const releaseSpeed = p.speed;
    let minimumSpeed = releaseSpeed;
    for (let i = 0; i < 240; i++) {
      p.step(PHYSICS_STEP, throttle, true, false);
      minimumSpeed = Math.min(minimumSpeed, p.speed);
    }
    assert.ok(Math.abs(p.slipAngle) < (5 * Math.PI) / 180);
    assert.equal(p.drifting, false);
    assert.ok(minimumSpeed > releaseSpeed * 0.7);
    console.log(
      JSON.stringify({
        peakSlipDegrees: peakSlip,
        speedRetainedAfterRelease: minimumSpeed / releaseSpeed,
      }),
    );
  } finally {
    p.dispose();
    flat.road.geometry.dispose();
  }
});
test("144 Hz presentation keeps moving through frames with no physics step", async () => {
  const flat = flatCircuit(),
    p = await Physics.create(flat.road, flat.track);
  try {
    settle(p);
    let accumulator = 0;
    const previous = new Vector3().copy(p.position);
    let stalledFrames = 0,
      peakError = 0;
    for (let frame = 0; frame < 720; frame++) {
      accumulator += 1 / 144;
      while (accumulator >= PHYSICS_STEP) {
        p.step(PHYSICS_STEP, throttle, true, false);
        accumulator -= PHYSICS_STEP;
      }
      const visual = new Vector3().lerpVectors(
        p.previousPosition,
        p.position,
        accumulator / PHYSICS_STEP,
      );
      if (frame > 144) {
        const delta = visual.distanceTo(previous);
        if (delta < 1e-5) stalledFrames++;
        peakError = Math.max(peakError, Math.abs(delta - p.speed / 144));
      }
      previous.copy(visual);
    }
    assert.equal(stalledFrames, 0);
    assert.ok(peakError < 0.01, `frame movement error: ${peakError}`);
  } finally {
    p.dispose();
    flat.road.geometry.dispose();
  }
});
test("both original drainage troughs have continuous flush geometry around the entire lap", () => {
  const roadside = createRoadside(track);
  roadside.visual.updateMatrixWorld(true);
  const ray = new Raycaster();
  ray.far = 3;
  try {
    for (let i = 0; i < track.points.length; i++)
      for (const side of [-1, 1])
        for (const offset of [0.12, SHOULDER_WIDTH - 0.05]) {
          const tangent = track
            .point(i + 1)
            .clone()
            .sub(track.point(i - 1));
          const normal = new Vector3(tangent.z, 0, -tangent.x).normalize();
          const position = track
            .point(i)
            .clone()
            .addScaledVector(normal, side * (track.width / 2 + offset));
          ray.set(
            position.clone().add(new Vector3(0, 2, 0)),
            new Vector3(0, -1, 0),
          );
          const hit = ray.intersectObject(roadside.shoulders)[0];
          assert.ok(hit, `missing shoulder: sample ${i}, side ${side}`);
          assert.ok(
            Math.abs(hit.point.y - position.y) < 0.015,
            `shoulder is not flush at ${i}`,
          );
        }
  } finally {
    roadside.shoulders.geometry.dispose();
    roadside.walls.geometry.dispose();
  }
});
test("parapets never become tyre ground and the car can drive away from both shoulders", async () => {
  const p = await Physics.create(collision.scene, track);
  try {
    for (let i = 0; i < track.points.length; i += 20)
      for (const side of [-1, 1]) {
        p.reset(track, i, side * 3.65);
        // At the tightest inside bends the long chassis initially overlaps the wall.
        // Allow the contact solver to depenetrate, and check that it never falls into a trough.
        for (let j = 0; j < 360; j++) {
          p.step(PHYSICS_STEP, parked, true, false);
          assert.ok(p.position.y > track.point(i).y + 0.6);
          assert.ok(tiltDegrees(p.rotation) < 25);
        }
        assert.ok(p.contacts >= 2, `lost support at sample ${i}, side ${side}`);
        const start = p.position.clone();
        let travelled = 0;
        for (let j = 0; j < 180; j++) {
          p.step(PHYSICS_STEP, { ...throttle, steer: side * 0.7 }, true, false);
          travelled = Math.max(travelled, p.position.distanceTo(start));
          for (let wheel = 0; wheel < 4; wheel++)
            if (p.wheel(wheel).HasContact())
              assert.equal(
                p.system
                  .GetBodyInterface()
                  .GetObjectLayer(p.wheel(wheel).GetContactBodyID()),
                0,
                "tyre is climbing the parapet",
              );
          assert.ok(tiltDegrees(p.rotation) < 25);
        }
        assert.ok(
          travelled > 1,
          `car stuck at sample ${i}, side ${side}: ${travelled}m`,
        );
      }
  } finally {
    p.dispose();
  }
});

test("the browser drift-into-wall sequence cannot turn a parapet into a ramp", async () => {
  const p = await Physics.create(collision.scene, track);
  let maximumHeight = 0,
    maximumTilt = 0;
  const step = (input: typeof throttle) => {
    p.step(PHYSICS_STEP, input, true, false);
    const near = track.nearest(p.position);
    maximumHeight = Math.max(
      maximumHeight,
      p.position.y - track.point(near.index).y,
    );
    maximumTilt = Math.max(maximumTilt, tiltDegrees(p.rotation));
    for (let i = 0; i < 4; i++)
      if (p.wheel(i).HasContact())
        assert.equal(
          p.system
            .GetBodyInterface()
            .GetObjectLayer(p.wheel(i).GetContactBodyID()),
          0,
        );
  };
  try {
    settle(p);
    for (let i = 0; i < 300; i++) step(throttle);
    for (let i = 0; i < 120; i++)
      step({ ...throttle, steer: -1, handbrake: true });
    for (let i = 0; i < 240; i++) step({ ...throttle, steer: 1 });
    assert.ok(
      maximumHeight < 1.4,
      `vehicle climbed onto wall: ${maximumHeight}m`,
    );
    assert.ok(maximumTilt < 25);
    console.log(
      JSON.stringify({
        wallImpactMaximumBodyHeight: maximumHeight,
        wallImpactMaximumTilt: maximumTilt,
      }),
    );
  } finally {
    p.dispose();
  }
});
