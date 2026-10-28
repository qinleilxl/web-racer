import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VEHICLES, type VehicleId } from "../src/game/Vehicles";
import { VehicleFeedback } from "../src/game/VehicleFeedback";
import { CarRig } from "../src/game/CarRig";
import { batchVehicleBody } from "../src/game/VehicleBatch";

test("approved E Final, surface-fixed Formula and original Hifi are assigned to distinct vehicle identities", async () => {
  const manifest = JSON.parse(
    await readFile("models/vehicle-assets.json", "utf8"),
  );
  assert.equal(VEHICLES.sparrow.asset, "/assets/Sparrow_One_E_Final.glb");
  assert.equal(VEHICLES.sparrow.rig, "e-final");
  assert.equal(VEHICLES.scarlet.asset, "/assets/Hifi_Animated.glb");
  assert.equal(VEHICLES.scarlet.rig, undefined);
  assert.equal(
    new Set(Object.values(VEHICLES).map((v) => v.asset)).size,
    Object.keys(VEHICLES).length,
  );
  for (const id of ["sparrow", "scarlet", "formula", "targa"] as VehicleId[]) {
    const bytes = await readFile(`public${VEHICLES[id].asset}`);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      manifest[id].sha256,
    );
    assert.equal(VEHICLES[id].asset, manifest[id].asset);
    if (id === "formula")
      assert.equal(
        manifest[id].sha256,
        "fa324c045858e19bc3d972831e1bc9d18bf0ddc5d530d3df3a372b8c5cba1a0e",
      );
  }
});

test("E Final keeps live speed/RPM needles on their pins and preserves all feedback through batching", async () => {
  const vehicle = VEHICLES.sparrow;
  const bytes = await readFile(`public${vehicle.asset}`);
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: "GeometryFixture",
    loadTexture: () => Promise.resolve(null),
  }));
  const { scene, animations } = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  const feedback = new VehicleFeedback(scene, vehicle);
  new CarRig(scene, vehicle);
  batchVehicleBody(scene, animations);
  assert.equal(feedback.instrumentKind, "analog");
  const speed = scene.getObjectByName("LIVE_SPEED_NEEDLE")!;
  const rpm = scene.getObjectByName("LIVE_RPM_NEEDLE")!;
  const state = {
    speed: 0,
    rpm: 900,
    braking: false,
    reversing: false,
    steer: 0,
    headlights: true,
    active: true,
  };
  feedback.update(state, 1 / 60);
  const speedZero = speed.quaternion.clone(),
    rpmIdle = rpm.quaternion.clone();
  feedback.update(
    { ...state, speed: 100 / 3.6, rpm: 5500, braking: true },
    1 / 60,
  );
  assert.ok(speed.quaternion.angleTo(speedZero) > 2);
  assert.ok(rpm.quaternion.angleTo(rpmIdle) > 2);
  for (const [index, pivot] of [speed, rpm].entries()) {
    const pin = scene.getObjectByName(`Instrument_${index}_needle_pin`)!;
    assert.ok(
      pivot
        .getWorldPosition(new Vector3())
        .distanceTo(pin.getWorldPosition(new Vector3())) < 1e-7,
    );
    assert.ok(
      scene.getObjectByName(`Instrument_${index}_needle`),
      "needle was removed by batching",
    );
  }
  assert.ok(feedback.lamps.some((l) => l.role === "head"));
  assert.equal(feedback.brakeLights.length, 2);
  assert.ok(
    feedback.brakeLights.every((f) =>
      f.nodes.every((n) => !n.material.name.includes("amber")),
    ),
  );
});
