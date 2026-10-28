import { test } from "node:test";
import assert from "node:assert/strict";
import { Physics } from "../src/game/Physics";
import { PHYSICS_STEP as step } from "../src/game/Driving";
import { frameTime } from "../src/game/FrameTime";
import { LineSegments } from "three";
import { VEHICLES } from "../src/game/Vehicles";
import { vehicleDefaults } from "../src/game/Tuning";
import { createTestGround } from "../src/game/TestGround";
import { disposeObjectResources } from "../src/game/GraphicsResources";
import { parked, launch } from "./helpers/driving";

test("real Jolt displacement agrees with the speedometer and wall time from 5 to 144 FPS", async () => {
  const ground = createTestGround();
  const records = [];
  try {
    for (const vehicle of Object.values(VEHICLES)) {
      const p = await Physics.create(
        ground.collision,
        ground.track,
        vehicleDefaults(vehicle.id),
        ground.environment,
        vehicle.geometry,
      );
      try {
        let baseline = 0;
        for (const fps of [60, 5, 10, 12, 20, 30, 144]) {
          p.reset(ground.track, 0);
          for (let i = 0; i < 120; i++) p.step(step, parked, true, false);
          launch(p, 100, 0);
          p.sync();
          assert.ok(Math.abs(p.speed * 3.6 - 100) < 0.01);
          const start = p.position.clone();
          let accumulator = 0,
            integrated = 0,
            simulationSeconds = 0;
          for (let frame = 0; frame < fps; frame++) {
            accumulator += frameTime(1 / fps).simulation;
            while (accumulator >= step) {
              integrated += p.speed * step;
              p.step(step, { ...parked, handbrake: false }, true, false);
              accumulator -= step;
              simulationSeconds += step;
            }
          }
          const distance = p.position.distanceTo(start);
          assert.ok(
            Math.abs(simulationSeconds + accumulator - 1) < 1e-8,
            "low FPS lost simulation time",
          );
          assert.ok(
            distance > 26 && distance < 28.2,
            `${vehicle.id}: 100 km/h coast travelled ${distance}m`,
          );
          assert.ok(
            Math.abs(integrated - distance) < 0.06,
            "world motion disagrees with reported physical speed",
          );
          if (fps === 60) baseline = distance;
          else
            assert.ok(
              Math.abs(distance - baseline) < 0.24,
              "low FPS created slow motion",
            );
          records.push({
            vehicle: vehicle.id,
            fps,
            metresInOneWallSecond: distance,
          });
        }
      } finally {
        p.dispose();
      }
    }
    for (const spacing of [10, 50]) {
      const grid = ground.terrain.getObjectByName(`Ground grid ${spacing}m`)!;
      assert.ok(grid);
      assert.equal(grid.scale.x, 1);
      assert.equal(grid.scale.z, 1);
      const positions = (grid as LineSegments).geometry.attributes.position;
      const coordinates = [
        ...new Set(
          Array.from({ length: positions.count }, (_, i) => positions.getX(i)),
        ),
      ].sort((a, b) => a - b);
      assert.equal(coordinates[0], -600);
      assert.equal(coordinates.at(-1), 600);
      for (let i = 1; i < coordinates.length; i++)
        assert.ok(
          Math.abs(coordinates[i] - coordinates[i - 1] - spacing) < 1e-5,
          "rendered grid spacing is not in metres",
        );
    }
    console.log(JSON.stringify({ speedCalibration: records }));
  } finally {
    disposeObjectResources(ground.terrain);
  }
});

test("render damping does not limit ordinary simulation time and long stalls stay bounded", () => {
  assert.deepEqual(frameTime(0.1), { visual: 0.08, simulation: 0.1 });
  assert.deepEqual(frameTime(10), { visual: 0.08, simulation: 0.25 });
  assert.equal(frameTime(-1).simulation, 0);
  assert.equal(frameTime(NaN).simulation, 0);
});
