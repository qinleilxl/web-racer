import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Mesh } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ConvertibleRoof } from "../src/game/ConvertibleRoof";
import { CarRig } from "../src/game/CarRig";
import { VehicleFeedback } from "../src/game/VehicleFeedback";
import { batchVehicleBody } from "../src/game/VehicleBatch";
import { VEHICLES } from "../src/game/Vehicles";
import { Game } from "../src/game/Game";
import { disposeObjectResources } from "../src/game/GraphicsResources";

async function model() {
  const bytes = await readFile(`public${VEHICLES.targa.asset}`),
    loader = new GLTFLoader();
  loader.register(() => ({
    name: "GeometryFixture",
    loadTexture: () => Promise.resolve(null),
  }));
  return loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
}
function advance(roof: ConvertibleRoof, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 60); i++) roof.update(1 / 60);
}

test("Targa retains its full articulated roof through batching and returns exactly to the closed pose", async () => {
  const { scene, animations } = await model();
  assert.deepEqual(animations.map((a) => a.name).sort(), [
    "Combined",
    "Drive",
    "Roof_Close",
    "Roof_Open",
    "Steering",
    "Suspension",
  ]);
  const roof = new ConvertibleRoof(scene, animations);
  new VehicleFeedback(scene, VEHICLES.targa);
  const rig = new CarRig(scene, VEHICLES.targa);
  const names = [
    ...new Set(
      animations
        .find((a) => a.name === "Roof_Open")!
        .tracks.map((t) => t.name.split(".")[0]),
    ),
  ];
  const before = names.map((name) => {
    const n = scene.getObjectByName(name)!;
    return {
      name,
      node: n,
      p: n.position.clone(),
      q: n.quaternion.clone(),
      s: n.scale.clone(),
    };
  });
  const count = () => {
    let n = 0;
    scene.traverse((o) => {
      if (o instanceof Mesh)
        n +=
          (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
    });
    return n;
  };
  const triangles = count();
  batchVehicleBody(scene, animations);
  assert.equal(count(), triangles, "batching deleted vehicle or roof detail");
  for (const pose of before)
    assert.equal(scene.getObjectByName(pose.name), pose.node);
  assert.ok(Math.abs(roof.duration - 19) < 0.1);
  const roll = rig.roll.map((n) => n.quaternion.clone());
  const root = scene.getObjectByName("TARGA_CAR_ROOT")!;
  const fixed = scene.getObjectByName("Fixed_brushed_Targa_rollbar") ?? root;
  const fixedPose = fixed.quaternion.clone();
  roof.toggle();
  advance(roof, 20);
  assert.equal(roof.status, "open");
  assert.equal(roof.progress, 1);
  assert.ok(
    before.some((p) => p.node.position.distanceTo(p.p) > 0.4),
    "top never moved into storage",
  );
  for (const pose of before) {
    if (
      /Roof_panel_transport|Roof_front_fold_hinge|Rear_glass_and_deck_carrier|Rear_glass_tilt_pivot|Rollbar_side_flap_hinge/.test(
        pose.name,
      )
    )
      assert.ok(
        pose.node.scale.distanceTo(pose.s) < 1e-5,
        "roof panel was scaled instead of folded",
      );
    assert.equal(pose.node.visible, true);
  }
  assert.ok(fixed.quaternion.angleTo(fixedPose) < 1e-7);
  rig.roll.forEach((n, i) =>
    assert.ok(
      n.quaternion.angleTo(roll[i]) < 1e-7,
      "roof animation overwrote wheel roll",
    ),
  );
  roof.toggle();
  advance(roof, 20);
  assert.equal(roof.status, "closed");
  for (const pose of before) {
    assert.ok(
      pose.node.position.distanceTo(pose.p) < 1e-6,
      pose.name + " failed to reseat",
    );
    assert.ok(
      pose.node.quaternion
        .clone()
        .normalize()
        .angleTo(pose.q.clone().normalize()) < 1e-6,
    );
    assert.ok(pose.node.scale.distanceTo(pose.s) < 1e-6);
  }
  roof.dispose();
  disposeObjectResources(scene);
});

test("a partially moving roof reverses without jumping and is controlled by the game independently of driving", async () => {
  const { scene, animations } = await model(),
    roof = new ConvertibleRoof(scene, animations);
  const g = Object.assign(Object.create(Game.prototype), { roof, emit() {} });
  g.toggleRoof();
  assert.equal(roof.status, "opening");
  advance(roof, 8);
  const panel = scene.getObjectByName("Roof_panel_transport")!;
  const position = panel.position.clone(),
    rotation = panel.quaternion.clone(),
    progress = roof.progress;
  g.toggleRoof();
  roof.update(0);
  assert.equal(roof.status, "closing");
  assert.equal(roof.progress, progress);
  assert.ok(
    panel.position.distanceTo(position) < 1e-8 &&
      panel.quaternion.angleTo(rotation) < 1e-6,
  );
  advance(roof, 2);
  assert.ok(roof.progress < progress);
  g.toggleRoof();
  advance(roof, 20);
  assert.equal(roof.status, "open");
  Object.assign(g, { roof: undefined });
  assert.doesNotThrow(() => g.toggleRoof());
  roof.dispose();
  disposeObjectResources(scene);
});

test("Targa glazing stays optically present through roof movement and releases its own reflection on vehicle disposal", async () => {
  const { scene, animations } = await model();
  const g = Object.create(Game.prototype);
  const prepared = g.prepareVehicleVisual(scene, animations, VEHICLES.targa);
  const rear = scene.getObjectByName("Wraparound_rear_glass") as Mesh;
  assert.ok(rear?.isMesh, "moving glass was lost in batching");
  const glass = rear.material as import("three").MeshPhysicalMaterial;
  assert.equal(glass.isMeshPhysicalMaterial, true);
  assert.equal(glass.opacity, 1, "alpha must not erase physical transmission");
  assert.equal(glass.transparent, false);
  assert.ok(glass.transmission > 0.65 && glass.transmission < 0.95);
  assert.ok(glass.ior >= 1.45 && glass.ior <= 1.55);
  assert.ok(
    glass.envMap,
    "a scene without an environment needs glass reflections",
  );
  assert.equal(
    rear.castShadow,
    false,
    "a thin glass sheet must not black out its cabin",
  );
  assert.ok(
    prepared.cockpitGlass.includes(rear),
    "driver view no longer hides the window",
  );
  const pose = rear.getWorldPosition(new (await import("three")).Vector3());
  prepared.roof.toggle();
  advance(prepared.roof, 6);
  assert.ok(rear.getWorldPosition(pose.clone()).distanceTo(pose) > 0.1);
  assert.equal(rear.material, glass);
  let disposed = 0;
  glass.envMap!.addEventListener("dispose", () => disposed++);
  prepared.roof.dispose();
  disposeObjectResources(scene);
  assert.equal(
    disposed,
    1,
    "shared window reflection leaked or was disposed repeatedly",
  );
});
