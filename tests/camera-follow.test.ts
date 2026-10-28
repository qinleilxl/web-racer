import { test } from "node:test";
import assert from "node:assert/strict";
import { Group, PerspectiveCamera, Vector3 } from "three";
import { chaseDistance } from "../src/game/CameraViews";
import { Game } from "../src/game/Game";

// Exercise the production camera without creating a WebGL renderer or physics world.
test("chase framing preserves soft follow but bounds pullback through acceleration, boost and turns", () => {
  for (const mode of ["near", "far"]) {
    for (const fps of [30, 60, 144]) {
      const g = Object.assign(Object.create(Game.prototype), {
        physics: {
          speed: 0,
          velocity: new Vector3(),
          drifting: false,
          steering: 0,
        },
        car: new Group(),
        camera: new PerspectiveCamera(50, 16 / 9, 0.1, 2200),
        cameraLook: new Vector3(),
        cameraAnchor: new Vector3(),
        travelDirection: new Vector3(0, 0, 1),
        cameraReady: false,
        cockpitGlass: [],
        settings: { camera: mode },
        state: { phase: "racing", boosting: false },
        motionPreference: { matches: false },
      });
      g.updateCamera(1 / fps);
      g.camera.updateMatrixWorld();
      const distance = mode === "near" ? 6.6 : 8.8;
      const pullback = mode === "near" ? 0.45 : 0.55;
      let maximumPullback = 0;
      const stoppedScale =
        new Vector3(0, 1, 0).project(g.camera).y -
        new Vector3(0, 0, 0).project(g.camera).y;
      for (let i = 0; i < fps * 8; i++) {
        // Accelerate to 216 km/h, then turn while boosting; retain a bounded lag.
        const speed = Math.min(60, (i / fps) * 15);
        g.state.boosting = i > fps * 3;
        g.physics.speed = speed;
        g.car.rotation.y = Math.max(0, i / fps - 5) * 0.6;
        g.physics.velocity.set(0, 0, speed).applyQuaternion(g.car.quaternion);
        g.car.position.addScaledVector(g.physics.velocity, 1 / fps);
        g.updateCamera(1 / fps);
        const offset = g.camera.position.clone().sub(g.car.position);
        const radius = Math.hypot(offset.x, offset.z);
        maximumPullback = Math.max(maximumPullback, radius - distance);
        assert.ok(
          radius >=
            chaseDistance(mode as "near" | "far", speed) - 0.35 - 1e-8 &&
            radius <=
              chaseDistance(mode as "near" | "far", speed) + pullback + 1e-8,
          "chase camera pulled too far away or cut into the car",
        );
        assert.equal(g.camera.fov, 50);
        if (i < fps * 5) {
          g.camera.updateMatrixWorld();
          const top = g.car.position
            .clone()
            .add(new Vector3(0, 1, 0))
            .project(g.camera);
          const bottom = g.car.position.clone().project(g.camera);
          assert.ok(
            (top.y - bottom.y) / stoppedScale > 0.72 &&
              (top.y - bottom.y) / stoppedScale < 1.08,
            "accelerating made the car too small",
          );
        }
      }
      assert.ok(
        maximumPullback > 0.9,
        "camera was rigidly attached instead of following softly",
      );
      const heading = new Vector3(0, 0, 1).applyQuaternion(g.car.quaternion);
      const behind = g.car.position.clone().sub(g.camera.position);
      behind.y = 0;
      assert.ok(
        behind.normalize().angleTo(heading) > 0.03,
        "camera snapped to chassis heading during a turn",
      );
      // Once stopped, the small pullback settles rather than remaining zoomed out.
      g.physics.speed = 0;
      g.physics.velocity.set(0, 0, 0);
      for (let i = 0; i < fps * 3; i++) g.updateCamera(1 / fps);
      const settled = g.camera.position.clone().sub(g.car.position);
      assert.ok(Math.abs(Math.hypot(settled.x, settled.z) - distance) < 0.01);
    }
  }
});

test("speed pullback is gradual, capped, and returns to the close framing at rest", () => {
  for (const mode of ["near", "far"] as const) {
    const stopped = chaseDistance(mode, 0);
    assert.equal(chaseDistance(mode, 30 / 3.6), stopped);
    assert.ok(chaseDistance(mode, 80 / 3.6) > stopped + 0.25);
    assert.ok(chaseDistance(mode, 120 / 3.6) > chaseDistance(mode, 80 / 3.6));
    assert.equal(
      chaseDistance(mode, 160 / 3.6),
      chaseDistance(mode, 300 / 3.6),
    );
    assert.ok(chaseDistance(mode, 300 / 3.6) - stopped <= 1.21);
  }
});

test("menu framing keeps all five vehicles inside desktop and portrait stages through a complete garage orbit", async () => {
  const { readFile } = await import("node:fs/promises");
  const { Box3 } = await import("three");
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const { VEHICLES } = await import("../src/game/Vehicles");
  const { CarRig } = await import("../src/game/CarRig");
  for (const vehicle of Object.values(VEHICLES)) {
    const bytes = await readFile(`public${vehicle.asset}`);
    const loader = new GLTFLoader();
    loader.register(() => ({
      name: "GeometryFixture",
      loadTexture: () => Promise.resolve(null),
    }));
    const { scene } = await loader.parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "",
    );
    new CarRig(scene, vehicle);
    const box = new Box3().setFromObject(scene);
    for (const [width, height] of [
      [1610, 921],
      [1024, 768],
      [768, 1024],
      [375, 812],
      [320, 568],
      [844, 390],
    ]) {
      const g = Object.assign(Object.create(Game.prototype), {
        host: { clientWidth: width, clientHeight: height },
        physics: {},
        car: new Group(),
        camera: new PerspectiveCamera(44, width / height, 0.1, 2200),
        cameraLook: new Vector3(),
        cameraAnchor: new Vector3(),
        travelDirection: new Vector3(0, 0, 1),
        cockpitGlass: [],
        settings: { camera: "far" },
        state: { phase: "menu" },
        motionPreference: { matches: false },
      });
      for (const showcase of [false, true]) {
        for (let step = 0; step < (showcase ? 24 : 1); step++) {
          g.showcase = showcase;
          g.clock = (step / 24) * Math.PI * 20;
          g.cameraReady = false;
          g.updateCamera(1);
          g.camera.updateMatrixWorld();
          for (const x of [box.min.x, box.max.x])
            for (const y of [box.min.y, box.max.y])
              for (const z of [box.min.z, box.max.z]) {
                const point = new Vector3(x, y, z).project(g.camera);
                assert.ok(
                  Math.abs(point.x) < 0.99 && Math.abs(point.y) < 0.99,
                  `${vehicle.id} cropped at ${width}x${height}, orbit ${step}: ${point.toArray()}`,
                );
              }
        }
      }
      if (width < height) {
        g.state.phase = "racing";
        for (const mode of ["near", "far"])
          for (const speed of [0, 30, 60]) {
            g.settings.camera = mode;
            g.physics = {
              speed,
              velocity: new Vector3(0, 0, speed),
              drifting: false,
              steering: 0,
            };
            g.cameraReady = false;
            g.updateCamera(1);
            g.camera.updateMatrixWorld();
            for (const x of [box.min.x, box.max.x])
              for (const y of [box.min.y, box.max.y])
                for (const z of [box.min.z, box.max.z]) {
                  const point = new Vector3(x, y, z).project(g.camera);
                  assert.ok(
                    Math.abs(point.x) < 0.99 && Math.abs(point.y) < 0.99,
                    `${vehicle.id} cropped in ${mode} portrait chase at ${speed} m/s: ${point.toArray()}`,
                  );
                }
          }
      }
    }
  }
});
