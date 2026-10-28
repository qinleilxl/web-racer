import { test } from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { Physics } from "../src/game/Physics";
import { Game } from "../src/game/Game";
import { createTestGround, TEST_SPAWN } from "../src/game/TestGround";
import { DEFAULT_TUNING } from "../src/game/Tuning";
import { PHYSICS_STEP } from "../src/game/Driving";
import { parked, throttle, launch, tiltDegrees } from "./helpers/driving";
import { mapFromSearch, mapURL } from "../src/game/MapMode";
import {
  nextCameraMode,
  COCKPIT_EYE,
  COCKPIT_LOOK,
} from "../src/game/CameraViews";
import { loadSettings } from "../src/game/types";

test("the proving ground has level continuous ground, open driving space and real perimeter barriers", async () => {
  const f = createTestGround();
  const p = await Physics.create(
    f.collision,
    f.track,
    DEFAULT_TUNING,
    f.environment,
  );
  try {
    assert.ok(f.track.point(0).distanceTo(TEST_SPAWN) < 1e-8);
    assert.ok(f.track.tangent(0).dot(new Vector3(0, 0, 1)) > 0.999);
    for (let i = 0; i < 120; i++) p.step(PHYSICS_STEP, parked, true, false);
    for (let i = 0; i < 720; i++) {
      p.step(PHYSICS_STEP, throttle, true, false);
      assert.equal(
        p.touchingWall,
        false,
        "reference route created an invisible wall",
      );
      assert.ok(p.contacts >= 3, "flat pad lost wheel contact");
      assert.ok(tiltDegrees(p.rotation) < 5, "flat pad disturbed chassis");
      for (let n = 0; n < 4; n++)
        if (p.wheel(n).HasContact())
          assert.ok(Math.abs(p.wheel(n).GetContactPosition().GetY()) < 0.01);
    }
    assert.ok(
      p.position.distanceTo(TEST_SPAWN) > 90,
      "car could not drive through open pad",
    );
    for (const side of [-1, 1]) {
      p.reset(f.track, 0, side * 596);
      for (let i = 0; i < 120; i++) p.step(PHYSICS_STEP, parked, true, false);
      launch(p, 40, (side * Math.PI) / 2);
      let hit = false;
      for (let i = 0; i < 180; i++) {
        p.step(PHYSICS_STEP, { ...parked, handbrake: false }, true, false);
        hit ||= p.touchingWall;
        assert.ok(Math.abs(p.position.x) < 600, "car crossed perimeter wall");
      }
      assert.ok(hit, "perimeter was only decorative");
    }
  } finally {
    p.dispose();
    f.terrain.traverse((o) => {
      if ("geometry" in o)
        (o.geometry as import("three").BufferGeometry).dispose();
    });
  }
});

test("the entire proving pad stays smooth across its old diagonal mesh seam", async () => {
  const f = createTestGround();
  const p = await Physics.create(
    f.collision,
    f.track,
    DEFAULT_TUNING,
    f.environment,
  );
  try {
    // Cross the old two-triangle seam at several points, in both directions,
    // including the far corners where sphere-cast precision used to lift tyres.
    for (const x of [-450, -300, -140, 0, 30, 140, 300, 450]) {
      for (const yaw of [0, Math.PI / 2, (Math.PI * 5) / 4]) {
        p.reset(f.track, 0);
        const direction = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        const start = new Vector3(x, 0.88, -x).addScaledVector(direction, -60);
        const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
        const position = new p.J.RVec3(start.x, start.y, start.z);
        const rotation = new p.J.Quat(q.x, q.y, q.z, q.w);
        p.system
          .GetBodyInterface()
          .SetPositionAndRotation(
            p.body.GetID(),
            position,
            rotation,
            p.J.EActivation_Activate,
          );
        p.J.destroy(position);
        p.J.destroy(rotation);
        for (let i = 0; i < 120; i++) p.step(PHYSICS_STEP, parked, true, false);
        launch(p, 160, yaw);
        const route = `seam x=${x}, yaw=${yaw}`;
        let previousSpeed = p.speed;
        for (let i = 0; i < 360; i++) {
          p.step(PHYSICS_STEP, throttle, true, false);
          assert.equal(p.touchingWall, false, `${route}: invisible obstacle`);
          assert.equal(p.contacts, 4, `${route}: wheel lifted off flat ground`);
          assert.ok(
            Math.abs(p.velocity.y) < 0.15,
            `${route}: vertical bump ${p.velocity.y} m/s`,
          );
          assert.ok(
            previousSpeed - p.speed < 0.15,
            `${route}: abrupt speed loss`,
          );
          for (let n = 0; n < 4; n++) {
            const wheel = p.wheel(n);
            assert.ok(
              Math.abs(wheel.GetContactPosition().GetY()) < 0.005,
              `${route}: tyre hit a false raised surface`,
            );
          }
          previousSpeed = p.speed;
        }
        assert.ok(
          p.position.clone().sub(start).dot(direction) > 100,
          `${route}: did not cross the seam`,
        );
      }
    }
  } finally {
    p.dispose();
    f.terrain.traverse((o) => {
      if ("geometry" in o)
        (o.geometry as import("three").BufferGeometry).dispose();
    });
  }
});

test("debug access is limited to the proving ground and map navigation preserves unrelated URL state", async () => {
  assert.equal(mapFromSearch(""), "coast");
  assert.equal(mapFromSearch("?map=unknown"), "coast");
  assert.equal(mapFromSearch("?map=test"), "test");
  const testURL = mapURL("https://example.com/game?quality=low#play", "test");
  assert.equal(new URL(testURL).searchParams.get("map"), "test");
  const coastURL = new URL(mapURL(testURL, "coast"));
  assert.equal(coastURL.searchParams.has("map"), false);
  assert.equal(coastURL.searchParams.get("quality"), "low");
  assert.equal(coastURL.hash, "#play");
  const fake = Object.create(Game.prototype) as Game;
  Object.assign(fake, {
    mapId: "coast",
    state: { debugOpen: false },
    input: { clear() {} },
    emit() {},
  });
  fake.setDebugOpen(true);
  assert.equal(fake.state.debugOpen, false);
  await assert.rejects(fake.applyTuning(DEFAULT_TUNING), /试车场/);
  Object.assign(fake, { mapId: "test" });
  fake.setDebugOpen(true);
  assert.equal(fake.state.debugOpen, true);
});

test("camera cycling includes a persisted driver-seat view facing through the windscreen", (t) => {
  assert.equal(nextCameraMode("far"), "near");
  assert.equal(nextCameraMode("near"), "cockpit");
  assert.equal(nextCameraMode("cockpit"), "far");
  assert.ok(COCKPIT_EYE.y > 1.3 && COCKPIT_EYE.y < 1.6);
  assert.ok(
    COCKPIT_LOOK.clone()
      .sub(COCKPIT_EYE)
      .normalize()
      .dot(new Vector3(-1, 0, 0)) > 0.99,
  );
  const old = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  t.after(() => {
    if (old) Object.defineProperty(globalThis, "localStorage", old);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => JSON.stringify({ camera: "cockpit" }) },
  });
  assert.equal(loadSettings().camera, "cockpit");
});

test("practice starts and restarts directly without countdown state or start beeps, while coast races retain their countdown", async () => {
  for (const mapId of ["test", "coast"]) {
    const beeps: number[] = [];
    const game = Object.assign(Object.create(Game.prototype), {
      mapId,
      disposed: false,
      startGeneration: 0,
      state: { phase: "paused", tuningBusy: false, best: null },
      audio: {
        async start() {},
        beep(value: number) {
          beeps.push(value);
        },
      },
      input: { clear() {} },
      skidActive: [false, false, false, false],
      physics: { reset() {}, position: new Vector3() },
      track: {},
      race: { reset() {}, relocated() {}, elapsed: 0, passed: 0, safeIndex: 0 },
      world: { setGate() {} },
      syncCar() {},
      emit() {},
      notice() {},
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      await game.start();
      assert.equal(game.state.phase, mapId === "test" ? "racing" : "countdown");
      assert.equal(game.state.countdown, mapId === "test" ? 0 : 3);
      assert.equal(game.countdownTime, game.state.countdown);
      assert.equal(game.lastCount, game.state.countdown);
    }
    assert.deepEqual(beeps, mapId === "test" ? [] : [440, 440]);
    if (mapId === "test") {
      game.reset();
      assert.equal(game.state.phase, "racing");
      assert.equal(game.state.countdown, 0);
      assert.deepEqual(beeps, []);
    }
  }
});
