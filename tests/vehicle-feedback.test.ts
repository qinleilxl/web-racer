import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Group, Mesh, Quaternion, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Physics } from "../src/game/Physics";
import { CarRig } from "../src/game/CarRig";
import { PHYSICS_STEP } from "../src/game/Driving";
import {
  flatCircuit,
  straightCircuit,
  launch,
  parked,
  throttle,
  tiltDegrees,
} from "./helpers/driving";

test("countersteering after powered or coasting wall impacts releases both sides without resetting or reversing", async () => {
  const flat = straightCircuit(),
    p = await Physics.create(flat.road, flat.track);
  let cases = 0,
    longestContact = 0;
  try {
    for (const powered of [true, false])
      for (const side of [-1, 1])
        for (const kmh of [60, 100, 160])
          for (const degrees of powered ? [10, 35, 65, 85] : [10, 35, 65]) {
            p.reset(flat.track, 100, side * 1.6);
            for (let i = 0; i < 120; i++)
              p.step(PHYSICS_STEP, parked, true, false);
            launch(p, kmh, (side * degrees * Math.PI) / 180);
            for (let i = 0; i < 160 && !p.touchingWall; i++)
              p.step(
                PHYSICS_STEP,
                { ...parked, handbrake: false },
                true,
                false,
              );
            assert.ok(
              p.touchingWall,
              `fixture failed to hit wall: ${kmh}, ${degrees}`,
            );
            const impactPosition = p.position.clone();
            let touching = 0,
              maxTilt = 0;
            for (let i = 0; i < 300; i++) {
              p.step(
                PHYSICS_STEP,
                { ...throttle, throttle: powered ? 1 : 0, steer: side },
                true,
                false,
              );
              if (p.touchingWall) touching++;
              maxTilt = Math.max(maxTilt, tiltDegrees(p.rotation));
              assert.ok(
                Math.abs(p.position.x) < 4.55,
                "vehicle escaped the barrier",
              );
            }
            assert.ok(
              touching < 270,
              `${kmh} km/h, ${degrees} degrees, side ${side} stayed pinned for ${touching / 120}s`,
            );
            assert.ok(maxTilt < 25, `wall release tipped car: ${maxTilt}`);
            assert.ok(
              p.position.distanceTo(impactPosition) > 3,
              `car stayed pinned at the impact point`,
            );
            if (powered)
              assert.ok(
                p.speed > 5,
                `wall release stopped the car: ${p.speed}`,
              );
            longestContact = Math.max(longestContact, touching / 120);
            cases++;
          }
    console.log(
      JSON.stringify({
        wallReleaseCases: cases,
        longestContactSeconds: longestContact,
      }),
    );
  } finally {
    p.dispose();
    flat.road.geometry.dispose();
  }
});

test("real GLB front tyres steer both ways, rear tyres stay straight and load transfer preserves tyre-ground contact", async () => {
  const bytes = await readFile("public/assets/Sparrow_One_Animated.glb");
  const model = (
    await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "",
    )
  ).scene;
  const rig = new CarRig(model),
    car = new Group();
  car.add(model);
  const flat = flatCircuit(),
    p = await Physics.create(flat.road, flat.track);
  const render = () => {
    car.position.copy(p.position);
    car.quaternion.copy(p.rotation);
    rig.update(p, 1, PHYSICS_STEP);
    car.updateMatrixWorld(true);
  };
  const tyres = [
    "Tire_casing_0_-1",
    "Tire_casing_0_1",
    "Tire_casing_1_-1",
    "Tire_casing_1_1",
  ].map((name) => model.getObjectByName(name) as Mesh);
  const centres = tyres.map((tyre) => {
    tyre.geometry.computeBoundingBox();
    return tyre.geometry.boundingBox!.getCenter(new Vector3());
  });
  const tyre = tyres[0];
  let maxGroundError = 0;
  const checkGround = () => {
    for (let i = 0; i < 4; i++) {
      const world = centres[i].clone().applyMatrix4(tyres[i].matrixWorld),
        contact = p.wheel(i).GetContactPosition();
      maxGroundError = Math.max(
        maxGroundError,
        Math.abs(world.y - contact.GetY() - 0.433),
      );
      assert.ok(
        Math.abs(world.y - contact.GetY() - 0.433) < 0.025,
        `visual tyre ${i} left road: ${world.y - contact.GetY() - 0.433}`,
      );
    }
  };
  try {
    for (let i = 0; i < 120; i++) {
      p.step(PHYSICS_STEP, parked, true, false);
      render();
    }
    const centreAxis = new Vector3(0, 0, 1).applyQuaternion(
      tyre.getWorldQuaternion(new Quaternion()),
    );
    for (const direction of [-1, 1]) {
      for (let i = 0; i < 120; i++) {
        p.step(PHYSICS_STEP, { ...parked, steer: direction }, true, false);
        render();
      }
      const axle = new Vector3(0, 0, 1).applyQuaternion(
        tyre.getWorldQuaternion(new Quaternion()),
      );
      assert.ok(
        centreAxis.angleTo(axle) > 0.4,
        "front tyre mesh did not visibly rotate",
      );
      assert.ok(
        rig.angles[0] * direction < -0.4,
        "front wheel turned opposite to steering input",
      );
      assert.ok(Math.abs(rig.angles[2]) < 1e-6);
      assert.ok(Math.abs(rig.angles[3]) < 1e-6);
      checkGround();
    }
    p.reset(flat.track, 0);
    for (let i = 0; i < 120; i++) {
      p.step(PHYSICS_STEP, parked, true, false);
      render();
    }
    let accelRise = 0,
      brakeDive = 0,
      accelTravel = 0,
      brakeTravel = 0;
    const bodyRise = () =>
      new Vector3(-1.07, 0.85, 0).applyMatrix4(model.matrixWorld).y -
      new Vector3(1.02, 0.85, 0).applyMatrix4(model.matrixWorld).y;
    for (let i = 0; i < 360; i++) {
      p.step(PHYSICS_STEP, throttle, true, false);
      render();
      checkGround();
      accelRise = Math.max(accelRise, bodyRise());
      accelTravel = Math.max(accelTravel, rig.lengths[0] - rig.lengths[2]);
    }
    for (let i = 0; i < 120; i++) {
      p.step(
        PHYSICS_STEP,
        { ...parked, handbrake: false, brake: 1 },
        true,
        false,
      );
      render();
      checkGround();
      brakeDive = Math.max(brakeDive, -bodyRise());
      brakeTravel = Math.max(brakeTravel, rig.lengths[2] - rig.lengths[0]);
    }
    assert.ok(
      accelTravel > 0.02 && brakeTravel > 0.02,
      "front/rear suspension did not transfer load",
    );
    assert.ok(
      accelRise > 0.08 && brakeDive > 0.08,
      `body feedback missing: acceleration ${accelRise}, braking ${brakeDive}`,
    );
    console.log(
      JSON.stringify({
        accelerationNoseRiseMeters: accelRise,
        brakingNoseDiveMeters: brakeDive,
        maximumTyreContactErrorMeters: maxGroundError,
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
