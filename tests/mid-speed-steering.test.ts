import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Group, Object3D, Quaternion, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CarRig } from "../src/game/CarRig";
import { VehicleFeedback } from "../src/game/VehicleFeedback";
import { VEHICLES, type VehicleId } from "../src/game/Vehicles";
import { vehicleDefaults } from "../src/game/Tuning";
import { Physics } from "../src/game/Physics";
import { PHYSICS_STEP, steeringAngleLimit } from "../src/game/Driving";
import {
  flatCircuit,
  parked,
  launch,
  tiltDegrees,
  throttle,
} from "./helpers/driving";

for (const id of Object.keys(VEHICLES) as VehicleId[])
  test(`${id}: steering rim turns in the driver's requested direction without changing column axis`, async () => {
    const v = VEHICLES[id],
      bytes = await readFile(`public${v.asset}`);
    const loader = new GLTFLoader();
    loader.register(() => ({
      name: "GeometryFixture",
      loadTexture: () => Promise.resolve(null),
    }));
    const { scene: model } = await loader.parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "",
    );
    new VehicleFeedback(model, v); // Includes the real Formula wheel-face correction.
    const rig = new CarRig(model, v),
      car = new Group();
    car.add(model);
    const wheel = model.getObjectByName(
      id === "suv"
        ? "Steering_Wheel_Pivot"
        : id === "targa"
          ? "TARGA_STEERING_WHEEL"
          : "STEERING_WHEEL_PIVOT",
    )!;
    model.updateWorldMatrix(true, true);
    const wheelInModel = model
      .getWorldQuaternion(new Quaternion())
      .invert()
      .multiply(wheel.getWorldQuaternion(new Quaternion()));
    const localAxis = new Vector3(
      v.steeringWheelAxis === "x" ? 1 : 0,
      v.steeringWheelAxis === "x" ? 0 : 1,
      0,
    );
    const column = localAxis.clone().applyQuaternion(wheelInModel);
    const rimTop = new Vector3(0, 1, 0)
      .addScaledVector(column, -column.y)
      .normalize();
    const marker = new Object3D();
    marker.position
      .copy(rimTop)
      .applyQuaternion(wheelInModel.clone().invert())
      .multiplyScalar(0.18);
    wheel.add(marker);
    const markerInModel = () =>
      model.worldToLocal(marker.getWorldPosition(new Vector3()));
    const flat = flatCircuit(),
      p = await Physics.create(
        flat.road,
        flat.track,
        vehicleDefaults(id),
        { roadside: false },
        v.geometry,
      );
    const render = () => {
      car.position.copy(p.position);
      car.quaternion.copy(p.rotation);
      rig.update(p, 1, PHYSICS_STEP);
      car.updateMatrixWorld(true);
    };
    try {
      for (const side of [-1, 1]) {
        p.reset(flat.track, 0);
        for (let i = 0; i < 120; i++) {
          p.step(PHYSICS_STEP, parked, true, false);
          render();
        }
        const neutral = markerInModel();
        launch(p, 80, 0);
        for (let i = 0; i < 12; i++) {
          p.step(PHYSICS_STEP, { ...throttle, steer: side }, true, false);
          render();
        }
        const rim = markerInModel();
        assert.ok(
          (neutral.z - rim.z) * side > 0.025,
          `${id}: rim moves opposite to driver input ${side}`,
        );
        assert.ok(
          rig.angles[0] * side < 0,
          "front wheel turns opposite to the rim",
        );
        const axisNow = localAxis
          .clone()
          .applyQuaternion(wheel.getWorldQuaternion(new Quaternion()))
          .applyQuaternion(model.getWorldQuaternion(new Quaternion()).invert());
        assert.ok(
          axisNow.angleTo(column) < 1e-6,
          "column axis wobbles during steering",
        );
        for (let i = 0; i < 30; i++) {
          p.step(PHYSICS_STEP, throttle, true, false);
          render();
        }
        assert.ok(
          Math.abs(markerInModel().z - neutral.z) < 0.006,
          "rim did not return smoothly to centre",
        );
      }
    } finally {
      p.dispose();
      flat.road.geometry.dispose();
    }
  });

test("70-80 km/h full keyboard turns have useful radii on all cars without drifting or lifting wheels", async () => {
  const limits = {
    sparrow: [34, 43],
    scarlet: [33, 43],
    formula: [27, 32],
    suv: [42, 58],
    targa: [36, 46],
  };
  const records = [];
  for (const id of Object.keys(VEHICLES) as VehicleId[]) {
    const v = VEHICLES[id],
      flat = flatCircuit(),
      p = await Physics.create(
        flat.road,
        flat.track,
        vehicleDefaults(id),
        { roadside: false },
        v.geometry,
      );
    try {
      for (const side of [-1, 1])
        for (const [n, kmh] of [70, 80].entries()) {
          p.reset(flat.track, 0);
          for (let i = 0; i < 120; i++)
            p.step(PHYSICS_STEP, parked, true, false);
          launch(p, kmh, 0);
          let distance = 0,
            angle = 0,
            peakSlip = 0,
            speed = 0,
            samples = 0;
          for (let i = 0; i < 480; i++) {
            p.step(
              PHYSICS_STEP,
              {
                throttle: Math.max(
                  0,
                  Math.min(0.8, (kmh / 3.6 - p.forwardSpeed) * 0.7 + 0.08),
                ),
                brake: 0,
                steer: side,
                handbrake: false,
                boost: false,
              },
              true,
              false,
            );
            assert.equal(p.drifting, false, "normal cornering entered drift");
            assert.equal(
              p.rearGripFactor,
              1,
              "cornering armed drift tyre settings",
            );
            assert.ok(p.contacts >= 3, "turn lifted wheels");
            assert.ok(tiltDegrees(p.rotation) < 18, "turn tipped chassis");
            peakSlip = Math.max(peakSlip, Math.abs(p.telemetry.slipAngle));
            if (i > 120) {
              distance += p.speed * PHYSICS_STEP;
              angle +=
                Math.abs(p.body.GetAngularVelocity().GetY()) * PHYSICS_STEP;
              speed += p.speed * 3.6;
              samples++;
            }
          }
          const radius = distance / angle;
          assert.ok(
            radius < limits[id][n],
            `${id} ${kmh} km/h understeers: ${radius.toFixed(2)}m`,
          );
          assert.ok(
            peakSlip < 12,
            `${id} ordinary cornering became a slide: ${peakSlip}`,
          );
          assert.ok(
            speed / samples > kmh - 6,
            "turning response depends on excessive speed loss",
          );
          records.push({ id, kmh, side, radius, peakSlip });
        }
    } finally {
      p.dispose();
      flat.road.geometry.dispose();
    }
  }
  console.log(JSON.stringify({ midSpeedTurns: records }));
});

test("unified steering increases high-speed authority while preserving parking lock and deliberate-drift steering", () => {
  for (const speed of [0, 15, 120, 160, 210])
    for (const id of Object.keys(VEHICLES) as VehicleId[]) {
      const v = VEHICLES[id],
        t = vehicleDefaults(id),
        wheelbase = v.geometry.frontAxle - v.geometry.rearAxle;
      const base = Math.min(
        0.52,
        Math.atan((wheelbase * t.steeringGrip) / ((speed / 3.6) ** 2 + 9)),
      );
      const actual = steeringAngleLimit(
        speed / 3.6,
        0,
        t.steeringGrip,
        wheelbase,
      );
      if (speed < 20) assert.ok(Math.abs(actual - base) < 1e-8);
      else {
        const minimumGain = speed === 120 ? 1.4 : speed === 160 ? 1.7 : 2.1;
        assert.ok(
          actual > base * minimumGain,
          `${id} ${speed} km/h still lacks steering reserve`,
        );
        assert.ok(actual <= 0.52);
      }
    }
  for (const drift of [0.1, 0.5, 1]) {
    const speed = 80 / 3.6,
      base = Math.min(
        0.52,
        Math.atan((2.09 * 9.5) / (speed ** 2 + 9)) * (1 + drift * 1.4),
      );
    assert.ok(
      Math.abs(steeringAngleLimit(speed, drift, 9.5, 2.09, false) - base) <
        1e-8,
    );
  }
});
