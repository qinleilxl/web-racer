import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Box3, Group, Mesh, RectAreaLight, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  VEHICLES,
  vehicleFromSearch,
  type VehicleId,
} from "../src/game/Vehicles";
import { vehicleDefaults, saveTuning, loadTuning } from "../src/game/Tuning";
import { bestStorageKey } from "../src/game/types";
import { CarRig } from "../src/game/CarRig";
import { VehicleFeedback } from "../src/game/VehicleFeedback";
import { batchVehicleBody } from "../src/game/VehicleBatch";
import { Physics } from "../src/game/Physics";
import { PHYSICS_STEP } from "../src/game/Driving";
import { flatCircuit, parked, throttle, tiltDegrees } from "./helpers/driving";

async function asset(id: VehicleId) {
  const bytes = await readFile(`public${VEHICLES[id].asset}`);
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: "GeometryFixture",
    loadTexture: () => Promise.resolve(null),
  }));
  return loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
}
for (const id of ["formula", "suv", "targa"] as const)
  test(`${id}: real rig, contact, suspension and steering survive acceleration and braking`, async () => {
    const vehicle = VEHICLES[id],
      gltf = await asset(id),
      model = gltf.scene;
    const feedback = new VehicleFeedback(model, vehicle);
    const rig = new CarRig(model, vehicle),
      car = new Group();
    car.add(model);
    const count = () => {
      let n = 0;
      model.traverse((o) => {
        if (o instanceof Mesh)
          n +=
            (o.geometry.index?.count ?? o.geometry.attributes.position.count) /
            3;
      });
      return n;
    };
    const before = count();
    batchVehicleBody(model, gltf.animations);
    assert.equal(count(), before);
    const flat = flatCircuit(),
      p = await Physics.create(
        flat.road,
        flat.track,
        vehicleDefaults(id),
        { roadside: false },
        vehicle.geometry,
      );
    let maxGround = 0,
      peakPitch = 0,
      peakSpeed = 0;
    const step = (input = parked) => {
      p.step(PHYSICS_STEP, input, true, false);
      car.position.copy(p.position);
      car.quaternion.copy(p.rotation);
      rig.update(p, 1, PHYSICS_STEP);
      car.updateMatrixWorld(true);
      feedback.update(
        {
          speed: p.speed,
          rpm: p.controller.GetEngine().GetCurrentRPM(),
          braking: p.braking,
          reversing: p.reversing,
          steer: input.steer,
          headlights: true,
          active: true,
        },
        PHYSICS_STEP,
      );
      assert.equal(feedback.speedKmh, Math.round(p.speed * 3.6));
      assert.ok(tiltDegrees(p.rotation) < 25, "vehicle rolled over");
      peakPitch = Math.max(peakPitch, Math.abs(rig.pitch));
      peakSpeed = Math.max(peakSpeed, p.speed * 3.6);
      for (let i = 0; i < 4; i++)
        if (p.wheel(i).HasContact()) {
          const centre = rig.roll[i].getWorldPosition(new Vector3());
          const err = Math.abs(
            centre.y -
              p.wheel(i).GetContactPosition().GetY() -
              vehicle.geometry.radius,
          );
          maxGround = Math.max(maxGround, err);
          assert.ok(err < 0.03, `wheel ${i} contact error ${err}`);
        }
      if (id === "formula")
        for (const tag of ["FL", "FR", "RL", "RR"]) {
          const rod = model.getObjectByName(`Pushrod_${tag}`)!;
          const end = new Vector3(0, 1, 0).applyMatrix4(rod.matrixWorld);
          assert.ok(
            end.distanceTo(
              model
                .getObjectByName(`PUSHROD_END_${tag}`)!
                .getWorldPosition(new Vector3()),
            ) < 1e-5,
            "pushrod disconnected",
          );
        }
      if (id === "suv")
        for (const tag of ["front_L", "front_R", "rear_L", "rear_R"]) {
          const spring = model.getObjectByName(`Red_coil_spring_${tag}`)!;
          assert.ok(
            new Vector3(0, 1, 0)
              .applyMatrix4(spring.matrixWorld)
              .distanceTo(
                model
                  .getObjectByName(`Spring_upper_${tag}`)!
                  .getWorldPosition(new Vector3()),
              ) < 1e-5,
            "spring disconnected",
          );
        }
    };
    try {
      for (let i = 0; i < 120; i++) step();
      assert.equal(p.contacts, 4);
      const steering = model.getObjectByName(
        id === "suv"
          ? "Steering_Wheel_Pivot"
          : id === "targa"
            ? "TARGA_STEERING_WHEEL"
            : "STEERING_WHEEL_PIVOT",
      )!;
      const axis = new Vector3(
        id === "formula" || id === "targa" ? 1 : 0,
        id === "formula" || id === "targa" ? 0 : 1,
        0,
      ).applyQuaternion(steering.quaternion);
      for (const side of [-1, 1]) {
        for (let i = 0; i < 100; i++) step({ ...parked, steer: side });
        assert.ok(rig.angles[0] * side < -0.3);
        assert.ok(Math.abs(rig.angles[2]) < 1e-6);
        const now = new Vector3(
          id === "formula" || id === "targa" ? 1 : 0,
          id === "formula" || id === "targa" ? 0 : 1,
          0,
        ).applyQuaternion(steering.quaternion);
        assert.ok(axis.angleTo(now) < 1e-6, "steering wheel axis wobbled");
      }
      p.reset(flat.track, 0);
      for (let i = 0; i < 120; i++) step();
      for (let i = 0; i < 960; i++) step(throttle);
      assert.ok(peakSpeed > 90, `poor acceleration ${peakSpeed}`);
      step({ ...parked, handbrake: false, brake: 1 });
      assert.equal(feedback.brakeOn, true);
      assert.equal(feedback.reverseOn, false);
      for (let i = 0; i < 1000 && p.forwardSpeed > 0.7; i++)
        step({ ...parked, handbrake: false, brake: 1 });
      assert.ok(
        p.speed < 1,
        `failed to brake ${p.speed} forward ${p.forwardSpeed}`,
      );
      for (let i = 0; i < 150; i++)
        step({ ...parked, handbrake: false, brake: 1 });
      assert.ok(p.forwardSpeed < -0.5, "failed to reverse");
      assert.equal(feedback.reverseOn, true);
      assert.equal(feedback.brakeOn, false);
      assert.ok(peakPitch > 0.002, "no body feedback");
      console.log({ id, maxGround, peakPitch, peakSpeed });
    } finally {
      p.dispose();
      flat.road.geometry.dispose();
    }
  });

test("every real vehicle has isolated working lamps and a live speed instrument where fitted", async () => {
  for (const id of Object.keys(VEHICLES) as VehicleId[]) {
    const { scene, animations } = await asset(id),
      f = new VehicleFeedback(scene, VEHICLES[id]);
    batchVehicleBody(scene, animations);
    assert.ok(
      f.lamps.some((l) => l.role === "tail"),
      `${id} has no brake lamps`,
    );
    if (id !== "formula")
      assert.ok(
        f.lamps.some((l) => l.role === "head"),
        `${id} has no headlights`,
      );
    const state = {
      speed: 100 / 3.6,
      rpm: 5000,
      braking: false,
      reversing: false,
      steer: 0,
      headlights: true,
      active: true,
    };
    f.update(state, 0.01);
    const tail = f.lamps.find((l) => l.role === "tail")!.material;
    const dim = tail.emissiveIntensity;
    f.update({ ...state, braking: true }, 0.01);
    assert.ok(tail.emissiveIntensity > dim * 5);
    f.update({ ...state, headlights: false }, 0.01);
    assert.equal(f.headlightsOn, false);
    assert.ok(
      f.lamps
        .filter((l) => l.role === "head")
        .every((l) => l.material.emissiveIntensity < 0.1),
    );
    f.update({ ...state, reversing: true, braking: false }, 0.01);
    if (id !== "formula")
      assert.ok(
        f.lamps.some(
          (l) => l.role === "reverse" && l.material.emissiveIntensity > 3,
        ),
      );
    assert.equal(f.speedKmh, 100);
    if (id === "suv") {
      const needle = scene.getObjectByName("LIVE_SPEED_NEEDLE")!;
      assert.ok(
        Math.abs(needle.rotation.x - (-86.66666667 * Math.PI) / 180) < 1e-6,
      );
      f.update({ ...state, speed: 0 }, 0.01);
      assert.ok(Math.abs(needle.rotation.x - (130 * Math.PI) / 180) < 1e-6);
      assert.ok(
        needle.position.distanceTo(
          scene.getObjectByName("Speedometer_needle_cap")!.position,
        ) < 0.006,
      );
    } else if (f.instrumentKind === "digital") {
      const display = scene.getObjectByName("LIVE_SPEED_KMH")!;
      assert.ok(display);
      assert.equal(
        display.children.filter((c) => c.visible).length,
        14,
        "100 should light two complete zeroes plus two bars",
      );
      f.update({ ...state, speed: 0 }, 0.01);
      assert.equal(display.children.filter((c) => c.visible).length, 6);
    }
    const originalMaterials = new Set(f.lamps.map((l) => l.material));
    assert.equal(
      originalMaterials.size,
      f.lamps.length,
      "lamps share mutable materials",
    );
  }
});

test("all vehicle profiles retain independent URL selection, tuning and records", () => {
  const stored = new Map<string, string>();
  const old = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => stored.set(k, v),
    },
  });
  try {
    const keys = new Set<string>();
    for (const id of Object.keys(VEHICLES) as VehicleId[]) {
      assert.equal(vehicleFromSearch(`?car=${id}`), id);
      localStorage.setItem("cloudcape.vehicle", id);
      assert.equal(vehicleFromSearch(""), id);
      saveTuning({ ...vehicleDefaults(id), torque: 400 + keys.size * 50 }, id);
      keys.add(bestStorageKey(id));
    }
    assert.equal(keys.size, Object.keys(VEHICLES).length);
    assert.deepEqual(
      Object.keys(VEHICLES).map((id) => loadTuning(id as VehicleId).torque),
      [400, 450, 500, 550, 600],
    );
    assert.equal(vehicleFromSearch("?car=__proto__"), "suv");
  } finally {
    if (old) Object.defineProperty(globalThis, "localStorage", old);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("brake fixtures and reflections follow each car's actual red lenses, excluding amber and reverse lamps", async () => {
  const expected = {
    sparrow: [
      [1.880584, 0.7, 0.7],
      [1.880552, 0.7, -0.7],
    ],
    scarlet: [
      [2.138, 0.784, 0.65],
      [2.138, 0.784, -0.65],
      [2.272, 0.255, 0],
    ],
    formula: [[2.325, 0.457, 0]],
    targa: [[2.1645, 0.598, 0]],
    suv: [
      [1.973, 1.047, 0.785],
      [1.973, 1.047, -0.785],
      [1.8525, 1.87, 0],
    ],
  };
  for (const id of Object.keys(VEHICLES) as VehicleId[]) {
    const { scene, animations } = await asset(id);
    const feedback = new VehicleFeedback(scene, VEHICLES[id]);
    batchVehicleBody(scene, animations);
    assert.equal(feedback.brakeLights.length, expected[id].length);
    feedback.brakeLights.forEach((fixture, i) => {
      assert.ok(
        fixture.light.position.distanceTo(new Vector3(...expected[id][i])) <
          0.001,
        `${id}/${fixture.name}: reflection missed real lens`,
      );
      fixture.nodes.forEach((mesh) => {
        assert.ok(
          scene.getObjectByName(mesh.name),
          `${mesh.name} was lost in batching`,
        );
        assert.ok(
          !/Amber|ivory/i.test(mesh.material.name),
          `${mesh.name} is not a red brake lens`,
        );
      });
    });
    const state = {
      speed: 20,
      rpm: 4000,
      braking: false,
      reversing: false,
      steer: 0,
      headlights: true,
      active: true,
    };
    feedback.update(state, 0.1);
    const otherLamps = feedback.lamps.filter(
      (l) => l.role === "signal" || l.role === "reverse",
    );
    const resting = otherLamps.map((l) => l.material.emissiveIntensity);
    if (id === "suv") {
      const stop = scene.getObjectByName("High_mounted_stop_lamp") as Mesh;
      assert.equal(
        stop.material.emissiveIntensity,
        0,
        "high stop lamp must stay off during normal running",
      );
    }
    feedback.update({ ...state, braking: true }, 0.1);
    assert.ok(feedback.brakeLights.every((f) => f.light.intensity > 0));
    assert.ok(
      feedback.lamps
        .filter((l) => l.role === "tail")
        .every((l) => l.material.emissiveIntensity > 5),
    );
    assert.deepEqual(
      otherLamps.map((l) => l.material.emissiveIntensity),
      resting,
      "braking illuminated amber / white lamps",
    );
    // The bound reflection must follow the actual lens through body pitch and yaw.
    scene.position.set(12, 1, -7);
    scene.rotation.set(0.06, 0.7, 0.15);
    scene.updateMatrixWorld(true);
    for (const fixture of feedback.brakeLights) {
      const centre = fixture.light.getWorldPosition(new Vector3());
      const lens = new Box3();
      fixture.nodes.forEach((mesh) => lens.expandByObject(mesh));
      assert.ok(
        lens.distanceToPoint(centre) < 0.08,
        `${id}/${fixture.name}: reflection detached when body moved`,
      );
    }
    feedback.update({ ...state, active: false, braking: true }, 0.1);
    assert.ok(feedback.brakeLights.every((f) => f.light.intensity === 0));
  }
});

test("Scarlet's continuous middle strips use linear area reflections and retain dim outlines", async () => {
  const { scene, animations } = await asset("scarlet");
  const feedback = new VehicleFeedback(scene, VEHICLES.scarlet);
  batchVehicleBody(scene, animations);
  const state = {
    speed: 12,
    rpm: 3000,
    braking: false,
    reversing: false,
    steer: 0,
    headlights: true,
    active: true,
  };
  const bars = feedback.brakeLights.filter(
    (f) => f.name === "left" || f.name === "right",
  );
  assert.equal(bars.length, 2);
  for (const fixture of bars) {
    assert.ok(
      fixture.light instanceof RectAreaLight,
      "a point source is still used for the linear lamp",
    );
    const light = fixture.light as RectAreaLight;
    assert.ok(
      Math.abs(light.width - 0.64) < 1e-5 && light.height >= 0.013,
      "area emitter does not span the whole strip",
    );
    assert.ok(
      light.width / light.height > 40,
      "area emitter lost its linear shape",
    );
    const normal = new Vector3(0, 0, -1).applyQuaternion(light.quaternion);
    assert.ok(
      normal.distanceTo(new Vector3(1, 0, 0)) < 1e-6,
      "strip light is not emitting towards the rear",
    );
  }
  for (const braking of [false, true, false]) {
    feedback.update({ ...state, braking }, 0.1);
    for (const side of ["-1", "1"]) {
      const strip = scene.getObjectByName(
        `Tail_optical_inner_light_guide_${side}`,
      ) as Mesh;
      const frame = scene.getObjectByName(
        `Thin_red_perimeter_tail_light_${side}`,
      ) as Mesh;
      assert.ok(strip && frame, "lamp strip / surround lost during batching");
      assert.ok(
        strip.material.emissiveIntensity >= (braking ? 5 : 0.4),
        "middle LED strip failed to light",
      );
      assert.ok(
        frame.material.emissiveIntensity > 0 &&
          frame.material.emissiveIntensity <
            strip.material.emissiveIntensity / 2,
        "outline should stay lit at a lower brightness than the centre strip",
      );
      assert.notEqual(
        strip.material,
        frame.material,
        "strip and outline share mutable emission",
      );
      const stripBounds = new Box3().setFromObject(strip),
        frameBounds = new Box3().setFromObject(frame);
      assert.ok(
        Math.abs(
          stripBounds.getCenter(new Vector3()).y -
            frameBounds.getCenter(new Vector3()).y,
        ) < 1e-5,
        "strip is not centred vertically inside the housing",
      );
      assert.ok(
        stripBounds.getSize(new Vector3()).z <
          frameBounds.getSize(new Vector3()).z,
        "inner strip extends beyond lamp housing",
      );
    }
  }
});

test("all cars retain lens-shaped diffuse halos that brighten with braking and turn off with their lamps", async () => {
  for (const id of Object.keys(VEHICLES) as VehicleId[]) {
    const { scene, animations } = await asset(id);
    const feedback = new VehicleFeedback(scene, VEHICLES[id]);
    batchVehicleBody(scene, animations);
    const state = {
      speed: 15,
      rpm: 3000,
      braking: false,
      reversing: false,
      steer: 0,
      headlights: true,
      active: true,
    };
    feedback.update(state, 0.1);
    for (const fixture of feedback.brakeLights) {
      const glow = feedback.glows.find((g) => g.emitter.name === fixture.name)!;
      assert.ok(
        glow && scene.getObjectByName(glow.mesh.name),
        `${id}/${fixture.name}: halo missing after batching`,
      );
      const dim = glow.mesh.material.uniforms.strength.value;
      feedback.update({ ...state, braking: true }, 0.1);
      assert.ok(
        glow.mesh.material.uniforms.strength.value > dim * 2,
        "braking did not increase the visible halo",
      );
      const source = new Box3();
      fixture.nodes.forEach((mesh) => source.expandByObject(mesh));
      const halo = new Box3().setFromObject(glow.mesh);
      assert.ok(
        halo.getSize(new Vector3()).z > source.getSize(new Vector3()).z,
        "halo does not diffuse beyond the lens edges",
      );
      assert.ok(
        glow.mesh.material.depthTest && !glow.mesh.material.depthWrite,
        "halo must respect occlusion without blocking the scenery",
      );
      if (id === "scarlet" && fixture.name !== "central-rain") {
        const size = glow.mesh.geometry.parameters;
        assert.ok(
          size.width > size.height * 4,
          "strip halo reverted to a circular point glow",
        );
      }
      feedback.update(state, 0.1);
    }
    feedback.update({ ...state, headlights: false }, 0.1);
    const headGlows = feedback.glows.filter((g) =>
      g.emitter.name.startsWith("head_"),
    );
    if (id !== "formula") assert.ok(headGlows.length >= 2);
    assert.ok(
      headGlows.every((g) => !g.mesh.visible),
      "headlight halo remains after headlights turn off",
    );
    feedback.update({ ...state, headlights: false, reversing: true }, 0.1);
    if (id !== "formula")
      assert.ok(
        feedback.glows.some(
          (g) => g.emitter.name.startsWith("reverse_") && g.mesh.visible,
        ),
        "reverse halo missing",
      );
  }
});
