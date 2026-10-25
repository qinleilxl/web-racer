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
              const rebound = -side * p.velocity.x;
              lowestBounce = Math.min(lowestBounce, rebound);
              highestBounce = Math.max(highestBounce, rebound);
              assert.ok(
                rebound > 0.15 && rebound < 3,
                `missing or excessive normal rebound: ${rebound}`,
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
