import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Group, Line3, Quaternion, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ExhaustFlames, FLAME_PROFILES } from "../src/game/ExhaustFlames";
import { VEHICLES } from "../src/game/Vehicles";
import { batchVehicleBody } from "../src/game/VehicleBatch";
import { CarRig } from "../src/game/CarRig";

async function load(vehicle: (typeof VEHICLES)[keyof typeof VEHICLES]) {
  const bytes = await readFile(`public${vehicle.asset}`);
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

test("all real cars bind flame jets to their own outlets and survive body batching", async () => {
  assert.equal(
    new Set(Object.values(FLAME_PROFILES).map((p) => p.core)).size,
    Object.keys(VEHICLES).length,
  );
  assert.equal(
    new Set(Object.values(FLAME_PROFILES).map((p) => p.length)).size,
    Object.keys(VEHICLES).length,
  );
  assert.equal(
    new Set(Object.values(FLAME_PROFILES).map((p) => p.pulse)).size,
    Object.keys(VEHICLES).length,
  );
  for (const vehicle of Object.values(VEHICLES)) {
    const { scene, animations } = await load(vehicle);
    const exhaust = new ExhaustFlames(scene, vehicle);
    assert.equal(exhaust.profile, FLAME_PROFILES[vehicle.id]);
    assert.equal(exhaust.jets.length, vehicle.id === "scarlet" ? 2 : 1);
    const origins = exhaust.jets.map(({ root }) =>
      root.getWorldPosition(new Vector3()),
    );
    batchVehicleBody(scene, animations);
    exhaust.jets.forEach(({ root, flame, light }, i) => {
      assert.equal(root.visible, false);
      assert.ok(
        root.getWorldPosition(new Vector3()).distanceTo(origins[i]) < 1e-8,
      );
      const direction = new Vector3(0, 0, 1).applyQuaternion(root.quaternion);
      assert.ok(
        direction.x > 0.8,
        `${vehicle.id}: flame points into the vehicle`,
      );
      assert.ok(
        vehicle.id !== "sparrow" || direction.y > 0.3,
        "tilted pipe ignored",
      );
      assert.ok(flame.parent === root && light.parent === root.parent);
      assert.equal(flame.material.depthWrite, false);
      assert.equal(flame.material.depthTest, true);
      assert.equal(light.castShadow, false);
      assert.equal(light.color.getHex(), exhaust.profile.tip);
      assert.equal(
        flame.material.uniforms.coreColor.value.getHex(),
        exhaust.profile.core,
      );
      assert.equal(
        flame.material.uniforms.flutterRate.value,
        exhaust.profile.flutter,
      );
    });
    if (vehicle.id === "scarlet")
      assert.ok(Math.abs(origins[0].z - origins[1].z) > 0.25);
  }
});

test("throttle pops, sustained boost, braking, reverse and pause control flame lifetimes", async () => {
  const { scene } = await load(VEHICLES.scarlet);
  const exhaust = new ExhaustFlames(scene, VEHICLES.scarlet);
  const state = {
    active: true,
    throttle: 1,
    boosting: false,
    braking: false,
    reversing: false,
    handbrake: false,
    rpm: 4800,
  };
  const step = (input = state, frames = 60) => {
    for (let i = 0; i < frames; i++) exhaust.update(input, 1 / 60);
  };
  step();
  assert.ok(exhaust.intensity > 0.05 && exhaust.intensity < 0.7);
  const regularLength = exhaust.jets[0].length;
  step({ ...state, boosting: true });
  assert.ok(exhaust.intensity > 0.98);
  assert.ok(exhaust.jets[0].length > regularLength * 2);
  for (const off of [
    { throttle: 0 },
    { braking: true },
    { reversing: true },
    { handbrake: true },
  ]) {
    step({ ...state, boosting: true });
    step({ ...state, ...off });
    assert.ok(exhaust.jets.every(({ root }) => !root.visible));
  }
  step({ ...state, boosting: true });
  step({ ...state, boosting: true, active: false }, 1);
  assert.equal(exhaust.intensity, 0);
  assert.ok(
    exhaust.jets.every(
      ({ root, light }) => !root.visible && light.intensity === 0,
    ),
  );
});

test("flames bend outward from actual yaw, retain inertia on countersteer and recover smoothly", async () => {
  const { scene } = await load(VEHICLES.scarlet);
  const exhaust = new ExhaustFlames(scene, VEHICLES.scarlet);
  const state = {
    active: true,
    throttle: 1,
    boosting: true,
    braking: false,
    reversing: false,
    rpm: 4800,
    speed: 25,
    velocity: new Vector3(-25, 0, 0),
    yawRate: 0.8,
  };
  for (let i = 0; i < 120; i++) exhaust.update(state, 1 / 120);
  const jet = exhaust.jets[0];
  const turned = jet.bend.x;
  assert.ok(turned > 0.12, "physical turn did not deflect the flame outward");
  exhaust.update({ ...state, yawRate: -0.8 }, 1 / 120);
  assert.ok(
    jet.bend.x > 0,
    "countersteer snapped the flame instantly to the other side",
  );
  for (let i = 0; i < 150; i++)
    exhaust.update({ ...state, yawRate: -0.8 }, 1 / 120);
  assert.ok(jet.bend.x < -0.12);
  for (let i = 0; i < 240; i++)
    exhaust.update({ ...state, yawRate: 0 }, 1 / 120);
  assert.ok(Math.abs(jet.bend.x) < 0.005);
  for (let i = 0; i < 120; i++)
    exhaust.update(
      { ...state, yawRate: 0, velocity: new Vector3(-25, 0, 5) },
      1 / 120,
    );
  assert.ok(
    Math.abs(jet.bend.x) > 0.09,
    "sideways slip did not affect the flame without a yaw input",
  );
  exhaust.update({ ...state, active: false }, 1 / 120);
  assert.equal(jet.bend.length(), 0);
  assert.equal(exhaust.trail.particles.length, 0);
});

test("real rigs always emit away from the rear in every chassis heading", async () => {
  for (const vehicle of Object.values(VEHICLES)) {
    const { scene } = await load(vehicle);
    const exhaust = new ExhaustFlames(scene, vehicle);
    new CarRig(scene, vehicle);
    const chassis = new Group();
    chassis.add(scene);
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      chassis.rotation.y = yaw;
      chassis.updateWorldMatrix(true, true);
      const forward = new Vector3(0, 0, 1).applyQuaternion(chassis.quaternion);
      const state = {
        active: true,
        throttle: 1,
        boosting: true,
        braking: false,
        reversing: false,
        rpm: 5000,
        speed: 25,
        velocity: forward.clone().multiplyScalar(25),
        yawRate: 0,
      };
      exhaust.update({ ...state, active: false }, 1 / 60);
      for (let i = 0; i < 6; i++) exhaust.update(state, 1 / 60);
      for (const { root, flame } of exhaust.jets) {
        const direction = new Vector3(0, 0, 1).applyQuaternion(
          root.getWorldQuaternion(new Quaternion()),
        );
        assert.ok(
          direction.dot(forward) < -0.8,
          `${vehicle.id}: jet points toward the front at yaw ${yaw}`,
        );
        const base = new Vector3(0, 0, 0);
        flame.localToWorld(base);
        const tip = new Vector3(0, 0, 1);
        flame.localToWorld(tip);
        assert.ok(
          tip.sub(base).dot(direction) > 0.1,
          "jet geometry runs into its own pipe",
        );
      }
      for (const particle of exhaust.trail.particles) {
        const relativeVelocity = particle.velocity.clone().sub(state.velocity);
        assert.ok(
          relativeVelocity.dot(forward) < -1,
          "gas ejects toward the front relative to the car",
        );
      }
    }
  }
});

test("residual hot gas keeps world momentum through turns, fades after release and clears on reset", async () => {
  const { scene } = await load(VEHICLES.scarlet);
  const exhaust = new ExhaustFlames(scene, VEHICLES.scarlet);
  const state = {
    active: true,
    throttle: 1,
    boosting: true,
    braking: false,
    reversing: false,
    rpm: 4800,
    speed: 20,
    velocity: new Vector3(-20, 0, 0),
    yawRate: 0,
  };
  for (let i = 0; i < 30; i++) {
    scene.position.x -= 20 / 120;
    exhaust.update(state, 1 / 120);
  }
  assert.ok(exhaust.trail.particles.length > 10);
  const particleIndex = exhaust.trail.particles.length - 1;
  const particle = exhaust.trail.particles[particleIndex];
  const before = particle.position.clone();
  scene.rotation.y = Math.PI / 2;
  exhaust.update({ ...state, throttle: 0, boosting: false }, 0);
  assert.ok(
    particle.position.distanceTo(before) < 1e-8,
    "turning chassis dragged old gas with it",
  );
  const rendered = new Vector3().fromBufferAttribute(
    exhaust.trail.points.geometry.attributes.position,
    particleIndex,
  );
  exhaust.trail.points.localToWorld(rendered);
  assert.ok(
    rendered.distanceTo(before) < 1e-5,
    "trail coordinates moved with the car",
  );
  exhaust.update({ ...state, throttle: 0, boosting: false }, 1 / 60);
  assert.ok(
    particle.position.x < before.x,
    "gas lost all inherited forward momentum immediately",
  );
  assert.ok(
    exhaust.trail.particles.length > 0,
    "release removed the entire trail instantly",
  );
  for (let i = 0; i < 40; i++)
    exhaust.update({ ...state, throttle: 0, boosting: false }, 1 / 120);
  assert.equal(exhaust.trail.particles.length, 0);
  for (let i = 0; i < 30; i++) exhaust.update(state, 1 / 120);
  scene.position.x += 100;
  exhaust.update({ ...state, throttle: 0, boosting: false }, 1 / 120);
  assert.equal(
    exhaust.trail.particles.length,
    0,
    "reset left hot gas at the previous location",
  );
});

test("every car's bright flame and residual particles share one curved stream in both turn directions", async () => {
  for (const vehicle of Object.values(VEHICLES)) {
    const { scene } = await load(vehicle);
    const exhaust = new ExhaustFlames(scene, vehicle);
    new CarRig(scene, vehicle);
    const chassis = new Group();
    chassis.add(scene);
    for (const side of [-1, 1]) {
      exhaust.update(
        { active: false, braking: false, reversing: false, rpm: 1000 },
        1 / 120,
      );
      chassis.position.set(0, 1, 0);
      for (let i = 0; i < 120; i++) {
        const angle = ((side * i) / 120) * 0.8;
        chassis.rotation.y = angle;
        const velocity = new Vector3(0, 0, 25).applyQuaternion(
          chassis.quaternion,
        );
        chassis.position.addScaledVector(velocity, 1 / 120);
        exhaust.update(
          {
            active: true,
            throttle: 1,
            boosting: true,
            braking: false,
            reversing: false,
            rpm: 5000,
            speed: 25,
            yawRate: side * 0.8,
            velocity,
          },
          1 / 120,
        );
      }
      exhaust.jets.forEach((jet, outlet) => {
        const samples = jet.flow.map((point) =>
          jet.root.localToWorld(point.clone()),
        );
        const mouth = jet.root.getWorldPosition(new Vector3());
        assert.ok(
          samples[0].distanceTo(mouth) < 1e-6,
          "flame detached from the pipe",
        );
        assert.ok(
          jet.flow.some((point) => Math.hypot(point.x, point.y) > 0.04),
          vehicle.id + " retained a straight flame despite turning",
        );
        const particles = exhaust.trail.particles.filter(
          (p) =>
            p.outlet === outlet &&
            p.position.distanceTo(mouth) < jet.length * 0.8,
        );
        assert.ok(
          particles.length >= 2,
          "no overlapping gas samples to validate",
        );
        for (const particle of particles) {
          let distance = Infinity;
          for (let n = 1; n < samples.length; n++) {
            const nearest = new Line3(
              samples[n - 1],
              samples[n],
            ).closestPointToPoint(particle.position, true, new Vector3());
            distance = Math.min(
              distance,
              nearest.distanceTo(particle.position),
            );
          }
          assert.ok(
            distance < 0.035,
            vehicle.id +
              " flame split from its particle path by " +
              distance +
              " metres",
          );
        }
      });
    }
  }
});

test("throttle and boost never change the visible light count or detach outlet lighting", async () => {
  const { scene } = await load(VEHICLES.scarlet);
  const exhaust = new ExhaustFlames(scene, VEHICLES.scarlet);
  const state = {
    active: true,
    throttle: 1,
    boosting: false,
    braking: false,
    reversing: false,
    handbrake: false,
    rpm: 4800,
  };
  const lights = () => {
    let count = 0;
    scene.traverseVisible((node) => {
      if ((node as import("three").Light).isLight) count++;
    });
    return count;
  };
  const initial = lights();
  assert.ok(initial >= exhaust.jets.length);
  for (const update of [
    state,
    { ...state, boosting: true },
    { ...state, throttle: 0 },
    { ...state, braking: true },
    { ...state, active: false },
  ]) {
    for (let i = 0; i < 120; i++) exhaust.update(update, 1 / 60);
    scene.updateMatrixWorld(true);
    assert.equal(
      lights(),
      initial,
      "flames forced a new scene light shader variant",
    );
    for (const jet of exhaust.jets) {
      const expected = jet.root.localToWorld(new Vector3(0, 0, 0.12));
      assert.ok(
        jet.light.getWorldPosition(new Vector3()).distanceTo(expected) < 1e-6,
      );
      if (!update.active) assert.equal(jet.light.intensity, 0);
    }
  }
});
