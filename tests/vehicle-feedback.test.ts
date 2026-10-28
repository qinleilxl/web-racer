import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Group, Mesh, Quaternion, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VEHICLES } from "../src/game/Vehicles";
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
              maxTilt = 0,
              released = false;
            const scenario = `${powered ? "powered" : "coasting"}, ${kmh} km/h, ${degrees} degrees, side ${side}`;
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
                `${scenario}: vehicle escaped the barrier`,
              );
              // Accept the first completed exit. Continuing full countersteer
              // after this event drives across the lane into the opposite wall
              // and would conflate a second collision with the original release.
              if (
                !p.touchingWall &&
                Math.abs(p.position.x) < flat.track.width / 2 - 0.6 &&
                p.forwardSpeed > 0.65 &&
                p.position.distanceTo(impactPosition) > 3
              ) {
                released = true;
                break;
              }
            }
            assert.ok(
              released,
              `${scenario}: did not complete the first wall exit within 2.5s; forward=${p.forwardSpeed.toFixed(2)} m/s, x=${p.position.x.toFixed(2)}, distance=${p.position.distanceTo(impactPosition).toFixed(2)} m, touching=${p.touchingWall}`,
            );
            assert.ok(maxTilt < 25, `wall release tipped car: ${maxTilt}`);
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
  const vehicle = VEHICLES.sparrow;
  const bytes = await readFile(`public${vehicle.asset}`);
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: "GeometryFixture",
    loadTexture: () => Promise.resolve(null),
  }));
  const model = (
    await loader.parseAsync(
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
  const tyres = rig.roll;
  const centres = tyres.map(() => new Vector3());
  const tyre = tyres[0];
  const wheel = model.getObjectByName("STEERING_WHEEL_PIVOT")!;
  const ring = model.getObjectByName("Steering_•_walnut_rim") as Mesh;
  const spoke = model.getObjectByName("Steering_•_pierced_spoke_0")!;
  const wheelCentre = wheel.position.clone();
  const columnAxis = new Vector3(0, 1, 0).applyQuaternion(wheel.quaternion);
  model.updateWorldMatrix(true, true);
  const worldColumn = new Vector3(0, 1, 0).applyQuaternion(
    wheel.getWorldQuaternion(new Quaternion()),
  );
  const positions = ring.geometry.attributes.position;
  let near = Infinity,
    far = -Infinity;
  for (let i = 0; i < positions.count; i++) {
    const depth = new Vector3()
      .fromBufferAttribute(positions, i)
      .applyMatrix4(ring.matrixWorld)
      .dot(worldColumn);
    near = Math.min(near, depth);
    far = Math.max(far, depth);
  }
  assert.ok(
    far - near < 0.04,
    "rim does not lie perpendicular to the real steering column",
  );
  const restingSpoke = new Vector3(0, 1, 0).applyQuaternion(spoke.quaternion);
  const checkSteeringWheel = () => {
    const axis = new Vector3(0, 1, 0).applyQuaternion(wheel.quaternion);
    assert.ok(
      axis.angleTo(columnAxis) < 1e-6,
      "steering wheel wobbled off its column axis",
    );
    assert.ok(
      wheel.position.distanceTo(wheelCentre) < 1e-9,
      "steering wheel centre moved",
    );
    const actual = restingSpoke.clone().applyQuaternion(wheel.quaternion);
    const expected = restingSpoke
      .clone()
      .applyAxisAngle(columnAxis, (rig.angles[0] + rig.angles[1]) * 6);
    assert.ok(
      actual.angleTo(expected) < 1e-6,
      "spokes did not follow the front steering around the column",
    );
  };
  let maxGroundError = 0;
  const checkGround = () => {
    for (let i = 0; i < 4; i++) {
      const world = centres[i].clone().applyMatrix4(tyres[i].matrixWorld),
        contact = p.wheel(i).GetContactPosition();
      maxGroundError = Math.max(
        maxGroundError,
        Math.abs(world.y - contact.GetY() - vehicle.geometry.radius),
      );
      assert.ok(
        Math.abs(world.y - contact.GetY() - vehicle.geometry.radius) < 0.025,
        `visual tyre ${i} left road: ${world.y - contact.GetY() - vehicle.geometry.radius}`,
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
        checkSteeringWheel();
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
      new Vector3(-vehicle.geometry.frontAxle, 0.85, 0).applyMatrix4(
        model.matrixWorld,
      ).y -
      new Vector3(-vehicle.geometry.rearAxle, 0.85, 0).applyMatrix4(
        model.matrixWorld,
      ).y;
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
