import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { Physics } from "../src/game/Physics";
import { PHYSICS_STEP } from "../src/game/Driving";
import {
  straightCircuit,
  launch,
  parked,
  tiltDegrees,
} from "./helpers/driving";

test("glancing and head-on wall impacts at 60–210 km/h do not flip or reverse heading", async () => {
  const flat = straightCircuit(),
    track = flat.track;
  const p = await Physics.create(flat.road, track);
  const contactPoints: Vector3[] = [];
  // Observe native wall manifold points without replacing the game's contact
  // response. Their post-solve velocity includes the new physical yaw response;
  // COM velocity alone is no longer the restitution velocity at the wall.
  const listener = (
    p as unknown as {
      contactListener: {
        OnContactAdded: (
          one: number,
          two: number,
          manifold: number,
          settings: number,
        ) => void;
      };
    }
  ).contactListener;
  const originalContactAdded = listener.OnContactAdded;
  listener.OnContactAdded = (one, two, manifoldPointer, settingsPointer) => {
    originalContactAdded(one, two, manifoldPointer, settingsPointer);
    const J = p.J;
    const first = J.wrapPointer(one, J.Body).GetObjectLayer();
    const second = J.wrapPointer(two, J.Body).GetObjectLayer();
    if (!((first === 1 && second === 2) || (first === 2 && second === 1)))
      return;
    const manifold = J.wrapPointer(manifoldPointer, J.ContactManifold);
    for (let i = 0; i < manifold.mRelativeContactPointsOn1.size(); i++) {
      const point =
        first === 1
          ? manifold.GetWorldSpaceContactPointOn1(i)
          : manifold.GetWorldSpaceContactPointOn2(i);
      contactPoints.push(new Vector3(point.GetX(), point.GetY(), point.GetZ()));
      J.destroy(point);
    }
  };
  let worstTilt = 0,
    worstHeading = 0,
    lowestRetention = 1,
    lowestBounce = Infinity,
    highestBounce = 0;
  try {
    for (const side of [-1, 1])
      for (const kmh of [60, 100, 160, 210])
        for (const degrees of [10, 35, 65, 85]) {
          p.reset(track, 100, side * 1.6);
          for (let i = 0; i < 120; i++)
            p.step(PHYSICS_STEP, parked, true, false);
          contactPoints.length = 0;
          const forward = new Vector3(
            Math.sin((side * degrees * Math.PI) / 180),
            0,
            Math.cos((side * degrees * Math.PI) / 180),
          );
          launch(p, kmh, (side * degrees * Math.PI) / 180);
          let hit = false,
            maxChange = 0,
            maxTilt = 0,
            retention = 1;
          for (let i = 0; i < 144; i++) {
            const beforeZ = Math.abs(p.velocity.z);
            p.step(PHYSICS_STEP, { ...parked, handbrake: false }, true, false);
            if (!hit && p.touchingWall && beforeZ > 1) {
              retention = Math.abs(p.velocity.z) / beforeZ;
              const impactHeading = new Vector3(0, 0, 1)
                .applyQuaternion(p.rotation)
                .setY(0)
                .normalize();
              assert.ok(
                impactHeading.angleTo(forward) < 0.04,
                "contact impulse abruptly rotated the chassis",
              );
              assert.ok(
                contactPoints.length > 0,
                "wall contact had no manifold points",
              );
              const rebound =
                contactPoints.reduce((total, point) => {
                  const contact = new p.J.RVec3(point.x, point.y, point.z);
                  const velocity = p.system
                    .GetBodyInterface()
                    .GetPointVelocity(p.body.GetID(), contact);
                  const speed = -side * velocity.GetX();
                  p.J.destroy(contact);
                  p.J.destroy(velocity);
                  return total + speed;
                }, 0) / contactPoints.length;
              lowestBounce = Math.min(lowestBounce, rebound);
              highestBounce = Math.max(highestBounce, rebound);
              assert.ok(
                rebound > 0.15 && rebound < 1.6,
                `${kmh} km/h, ${degrees} degrees, side ${side}: missing or excessive contact-point rebound: ${rebound}`,
              );
            }
            hit ||= p.touchingWall;
            const heading = new Vector3(0, 0, 1).applyQuaternion(p.rotation);
            heading.y = 0;
            heading.normalize();
            assert.ok(
              Math.abs(p.position.x) < 4.55,
              `car escaped the wall at ${kmh} km/h`,
            );
            const change =
              (Math.acos(Math.max(-1, Math.min(1, heading.dot(forward)))) *
                180) /
              Math.PI;
            maxChange = Math.max(maxChange, change);
            maxTilt = Math.max(maxTilt, tiltDegrees(p.rotation));
          }
          assert.ok(hit, `no impact for ${kmh} km/h at ${degrees} degrees`);
          assert.ok(
            // Following the wall is intentional; a sudden reversal is not.
            maxChange < Math.min(95, Math.max(30, degrees + 15)),
            `wall spun car: ${kmh} km/h, ${degrees} degrees, side ${side}: ${maxChange}`,
          );
          assert.ok(
            maxTilt < (kmh > 160 ? 25 : 15),
            `wall flipped car: ${kmh} km/h, ${degrees} degrees, side ${side}: ${maxTilt}`,
          );
          if (degrees === 10) {
            const retained = retention;
            lowestRetention = Math.min(lowestRetention, retained);
            assert.ok(
              retained > 0.97,
              `glancing wall removed too much speed: ${retained}`,
            );
          }
          worstTilt = Math.max(worstTilt, maxTilt);
          worstHeading = Math.max(worstHeading, maxChange);
        }
    console.log(
      JSON.stringify({
        wallCases: 32,
        worstTiltDegrees: worstTilt,
        worstHeadingChangeDegrees: worstHeading,
        minimumGlancingSpeedRetained: lowestRetention,
        normalReboundRange: [lowestBounce, highestBounce],
      }),
    );
  } finally {
    p.dispose();
    flat.road.geometry.dispose();
  }
});
