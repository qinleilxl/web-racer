import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Box3, Group, Mesh, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VEHICLES, vehicleFromSearch, vehicleURL } from "../src/game/Vehicles";
import {
  vehicleDefaults,
  loadTuning,
  saveTuning,
  tuningIsStandard,
} from "../src/game/Tuning";
import { bestStorageKey, loadBest } from "../src/game/types";
import { Physics } from "../src/game/Physics";
import { CarRig } from "../src/game/CarRig";
import { batchVehicleBody } from "../src/game/VehicleBatch";
import { Race } from "../src/game/Race";
import { PHYSICS_STEP, steeringAngleLimit } from "../src/game/Driving";
import {
  flatCircuit,
  parked,
  throttle,
  launch,
  tiltDegrees,
  straightCircuit,
} from "./helpers/driving";
import { loadCoastalCircuit } from "./helpers/coastal";

const vehicle = VEHICLES.scarlet;
const setup = vehicleDefaults("scarlet");

test("Scarlet uses its real wheel geometry, articulated suspension and steering column while driving", async () => {
  const bytes = await readFile(`public${vehicle.asset}`);
  const document = JSON.parse(
    bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)),
  );
  assert.equal(document.images.length, 6);
  assert.ok(
    document.images.every(
      (image: { bufferView?: number; uri?: string }) =>
        typeof image.bufferView === "number" && !image.uri,
    ),
    "texture images must be self-contained",
  );
  assert.ok(
    document.materials.filter(
      (m: { normalTexture?: unknown }) => m.normalTexture,
    ).length >= 3,
  );
  const loader = new GLTFLoader();
  // Native tests inspect the real geometry and rig. Texture decoding / upload
  // is verified in the browser, rather than emulating a browser image API here.
  loader.register(() => ({
    name: "NodeGeometryFixture",
    loadTexture: () => Promise.resolve(null),
  }));
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  assert.deepEqual(gltf.animations.map((a) => a.name).sort(), [
    "Combined",
    "Drive",
    "Steering",
    "Suspension",
  ]);
  const model = gltf.scene;
  const statistics = () => {
    let meshes = 0,
      triangles = 0;
    model.traverse((o) => {
      if (o instanceof Mesh) {
        meshes++;
        triangles +=
          (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
      }
    });
    return { meshes, triangles };
  };
  const before = statistics();
  const bounds = new Box3().setFromObject(model);
  batchVehicleBody(model, gltf.animations);
  const after = statistics();
  assert.equal(before.triangles, 769302);
  assert.equal(
    after.triangles,
    before.triangles,
    "batching removed geometry detail",
  );
  assert.ok(
    after.meshes < before.meshes * 0.5,
    "static panels were not batched",
  );
  const batchedBounds = new Box3().setFromObject(model);
  assert.ok(
    bounds.min.distanceTo(batchedBounds.min) < 1e-5 &&
      bounds.max.distanceTo(batchedBounds.max) < 1e-5,
    "batching moved the body",
  );
  const rig = new CarRig(model, vehicle);
  const car = new Group();
  car.add(model);
  const flat = flatCircuit();
  const p = await Physics.create(
    flat.road,
    flat.track,
    setup,
    { roadside: false },
    vehicle.geometry,
  );
  const tags = ["FL", "FR", "RL", "RR"];
  const wing = model.getObjectByName("FIXED_REAR_WING")!;
  const wingPose = wing.quaternion.clone();
  const steering = model.getObjectByName("STEERING_WHEEL_PIVOT")!;
  const steeringAxis = new Vector3(0, 1, 0).applyQuaternion(
    steering.quaternion,
  );
  const tyres = tags.map(
    (tag) => model.getObjectByName(`${tag}_Sculpted_Grooved_Tire`) as Mesh,
  );
  tyres.forEach((tyre, i) => {
    tyre.geometry.computeBoundingBox();
    const size = tyre.geometry.boundingBox!.getSize(new Vector3());
    assert.ok(
      Math.abs(size.y / 2 - vehicle.geometry.radius) < 1e-5,
      "physical tyre radius does not match the replacement asset",
    );
    const hub = rig.suspension[i].position;
    const halfTrack =
      i < 2 ? vehicle.geometry.halfTrack : vehicle.geometry.rearHalfTrack!;
    assert.ok(
      Math.abs(Math.abs(hub.z) - halfTrack) < 1e-5,
      "front / rear track width does not match the replacement asset",
    );
  });
  const links: {
    node: Mesh;
    target: string;
    length: number;
    negative: boolean;
  }[] = [];
  model.traverse((o) => {
    if (o instanceof Mesh && o.userData.mechanical_target)
      links.push({
        node: o,
        target: o.userData.mechanical_target,
        length: o.userData.rest_mesh_length,
        negative: o.userData.negative_local_z,
      });
  });
  assert.equal(links.length, 28, "upper / lower suspension links are missing");
  let peakPitch = 0,
    maximumGroundError = 0;
  const step = (input = parked) => {
    p.step(PHYSICS_STEP, input, true, false);
    car.position.copy(p.position);
    car.quaternion.copy(p.rotation);
    rig.update(p, 1, PHYSICS_STEP);
    car.updateMatrixWorld(true);
    peakPitch = Math.max(peakPitch, Math.abs(rig.pitch));
    assert.ok(
      wing.quaternion.angleTo(wingPose) < 1e-8,
      "fixed rear wing moved",
    );
    assert.ok(
      new Vector3(0, 1, 0)
        .applyQuaternion(steering.quaternion)
        .angleTo(steeringAxis) < 1e-6,
      "steering column wobbled off axis",
    );
    for (let n = 0; n < 4; n++) {
      if (!p.wheel(n).HasContact()) continue;
      const centre = tyres[n].getWorldPosition(new Vector3());
      const contact = p.wheel(n).GetContactPosition();
      const error = Math.abs(
        centre.y - contact.GetY() - vehicle.geometry.radius,
      );
      maximumGroundError = Math.max(maximumGroundError, error);
      assert.ok(error < 0.025, `tyre ${n} floated or sank: ${error}m`);
    }
    for (const link of links) {
      const target = model
        .getObjectByName(link.target)!
        .getWorldPosition(new Vector3());
      const end = new Vector3(
        0,
        link.negative ? -link.length : link.length,
        0,
      ).applyMatrix4(link.node.matrixWorld);
      assert.ok(
        end.distanceTo(target) < 1e-4,
        `${link.node.name} disconnected: ${end.distanceTo(target)}m`,
      );
    }
  };
  try {
    for (let i = 0; i < 120; i++) step();
    assert.equal(p.contacts, 4);
    for (const direction of [-1, 1]) {
      for (let i = 0; i < 120; i++) step({ ...parked, steer: direction });
      assert.ok(rig.angles[0] * direction < -0.3);
      assert.ok(Math.abs(rig.angles[2]) < 1e-8);
      assert.ok(Math.abs(rig.angles[3]) < 1e-8);
    }
    p.reset(flat.track, 0);
    for (let i = 0; i < 120; i++) step();
    let zeroTo100 = 0;
    for (let i = 0; i < 2400; i++) {
      step(throttle);
      if (!zeroTo100 && p.speed * 3.6 >= 100)
        zeroTo100 = (i + 1) * PHYSICS_STEP;
    }
    const topSpeed = p.speed * 3.6;
    assert.ok(
      zeroTo100 > 0 && zeroTo100 < 3.5,
      "sports car failed to accelerate",
    );
    assert.ok(
      topSpeed > 200 && topSpeed < 225,
      `unexpected top speed: ${topSpeed}`,
    );
    for (let i = 0; i < 1200 && p.speed > 0.2; i++)
      step({ ...parked, handbrake: false, brake: 1 });
    assert.ok(p.speed < 0.3, "sports car failed to brake");
    assert.ok(peakPitch > 0.002, "no suspension load-transfer feedback");
    console.log(
      JSON.stringify({
        scarletMaximumGroundError: maximumGroundError,
        scarletPeakBodyPitch: peakPitch,
        scarletZeroTo100Seconds: zeroTo100,
        scarletSpeedAfter20Seconds: topSpeed,
        hifiBatches: { before, after },
      }),
    );
  } finally {
    p.dispose();
    flat.road.geometry.dispose();
    model.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
  }
});

test("Scarlet completes the widened coastal lap through native driver inputs", async () => {
  const map = await loadCoastalCircuit();
  const p = await Physics.create(
    map.collision,
    map.track,
    setup,
    {},
    vehicle.geometry,
  );
  const race = new Race(map.track);
  let maxDistance = 0;
  try {
    for (let i = 0; i < 120; i++) p.step(PHYSICS_STEP, parked, true, false);
    race.relocated(p.position);
    for (let i = 0; i < 18000 && !race.finished; i++) {
      const near = map.track.nearest(p.position),
        lookahead = 7 + p.speed * 0.65;
      let index = near.index,
        distance = 0;
      while (distance < lookahead) {
        distance += map.track
          .point(index)
          .distanceTo(map.track.point(index + 1));
        index++;
      }
      const target = map.track
        .point(index)
        .clone()
        .sub(p.position)
        .setY(0)
        .normalize();
      const forward = new Vector3(0, 0, 1).applyQuaternion(p.rotation);
      const angle = Math.atan2(
        forward.clone().cross(target).y,
        forward.dot(target),
      );
      const wheelbase = vehicle.geometry.frontAxle - vehicle.geometry.rearAxle;
      const steer =
        -Math.atan2(2 * wheelbase * Math.sin(angle), lookahead) /
        steeringAngleLimit(
          Math.abs(p.forwardSpeed),
          0,
          setup.steeringGrip,
          wheelbase,
        );
      const curve = Math.acos(
        Math.max(
          -1,
          Math.min(
            1,
            map.track.tangent(index).dot(map.track.tangent(near.index)),
          ),
        ),
      );
      const speed = Math.max(
        6,
        Math.min(20, Math.sqrt((3 * lookahead) / Math.max(0.001, curve))),
      );
      p.step(
        PHYSICS_STEP,
        {
          ...throttle,
          throttle: p.speed < speed ? 1 : 0,
          brake: p.speed > speed + 1 ? 1 : 0,
          steer: Math.max(-1, Math.min(1, steer)),
        },
        true,
        false,
      );
      race.update(PHYSICS_STEP, p.position);
      maxDistance = Math.max(maxDistance, near.distance);
      assert.ok(near.distance < 4, "sports car left the course");
      assert.ok(tiltDegrees(p.rotation) < 20, "sports car rolled over");
    }
    assert.equal(race.finished, true);
    assert.equal(race.passed, 8);
    console.log(
      JSON.stringify({
        scarletLapSeconds: race.elapsed,
        scarletMaxCentrelineDistance: maxDistance,
      }),
    );
  } finally {
    p.dispose();
  }
});

test("Scarlet's larger collision body remains stable in left and right wall impacts", async () => {
  const flat = straightCircuit();
  const p = await Physics.create(
    flat.road,
    flat.track,
    setup,
    {},
    vehicle.geometry,
  );
  try {
    for (const side of [-1, 1])
      for (const speed of [60, 160, 210]) {
        p.reset(flat.track, 100, side * 1.6);
        for (let i = 0; i < 120; i++) p.step(PHYSICS_STEP, parked, true, false);
        launch(p, speed, (side * Math.PI) / 4);
        let hit = false,
          maxTilt = 0;
        for (let i = 0; i < 240; i++) {
          p.step(PHYSICS_STEP, { ...parked, handbrake: false }, true, false);
          hit ||= p.touchingWall;
          maxTilt = Math.max(maxTilt, tiltDegrees(p.rotation));
          assert.ok(
            Math.abs(p.position.x) < 4.55,
            "sports car escaped through wall",
          );
        }
        assert.ok(hit, "collision fixture did not hit wall");
        assert.ok(maxTilt < 25, `sports car flipped: ${maxTilt} degrees`);
      }
  } finally {
    p.dispose();
    flat.road.geometry.dispose();
  }
});

test("vehicle choice, tuning and personal records remain isolated and survive reload", (t) => {
  const old = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    },
  });
  t.after(() => {
    if (old) Object.defineProperty(globalThis, "localStorage", old);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  assert.equal(vehicleFromSearch(""), "sparrow");
  localStorage.setItem("cloudcape.vehicle", "scarlet");
  assert.equal(vehicleFromSearch(""), "scarlet");
  assert.equal(vehicleFromSearch("?car=sparrow"), "sparrow");
  const url = new URL(
    vehicleURL("https://example.com/?map=test&quality=low#play", "scarlet"),
  );
  assert.equal(url.searchParams.get("map"), "test");
  assert.equal(url.searchParams.get("car"), "scarlet");
  assert.equal(url.hash, "#play");
  const sparrow = { ...vehicleDefaults(), torque: 470 };
  const scarlet = { ...setup, torque: 650 };
  saveTuning(sparrow);
  saveTuning(scarlet, "scarlet");
  assert.equal(loadTuning().torque, 470);
  assert.equal(loadTuning("scarlet").torque, 650);
  assert.ok(tuningIsStandard(setup, "scarlet"));
  assert.ok(!tuningIsStandard(setup));
  localStorage.setItem(bestStorageKey(), "92.3");
  localStorage.setItem(bestStorageKey("scarlet"), "82.1");
  assert.equal(loadBest(), 92.3);
  assert.equal(loadBest("scarlet"), 82.1);
});
