import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { VEHICLES } from "../src/game/Vehicles";
import { vehicleDefaults } from "../src/game/Tuning";
import { Physics } from "../src/game/Physics";
import { PHYSICS_STEP, steeringAngleLimit } from "../src/game/Driving";
import {
  straightCircuit,
  parked,
  throttle,
  launch,
  tiltDegrees,
} from "./helpers/driving";

test("a drift impact returns front-wheel authority to the driver at the new speed", async () => {
  const flat = straightCircuit();
  const p = await Physics.create(flat.road, flat.track);
  let cases = 0;
  try {
    for (const side of [-1, 1])
      for (const kmh of [100, 160, 210])
        for (const degrees of [35, 65, 85]) {
          p.reset(flat.track, 100, side * 1.6);
          for (let i = 0; i < 120; i++)
            p.step(PHYSICS_STEP, parked, true, false);
          launch(p, kmh, (side * degrees * Math.PI) / 180);
          for (let i = 0; i < 160 && !p.touchingWall; i++)
            p.step(
              PHYSICS_STEP,
              { ...throttle, steer: -side, handbrake: true },
              true,
              false,
            );
          const scenario = `${kmh} km/h, ${degrees} degrees, side ${side}`;
          assert.ok(p.touchingWall, `fixture missed the wall: ${scenario}`);
          assert.ok(
            p.rearGripFactor < 0.99,
            `fixture did not start a drift: ${scenario}`,
          );
          assert.ok(
            p.speed < (kmh / 3.6) * 0.9,
            `impact did not reduce speed: ${scenario}`,
          );
          let previousGrip = p.rearGripFactor;
          const recentSteeringLimits: number[] = [];
          for (let i = 0; i < 180; i++) {
            // Drive away, then reverse the steering input: neither direction
            // may be swallowed by the previous drift's automatic countersteer.
            const direction = i < 90 ? side : -side;
            // A real countersteer may temporarily align the tyre with residual
            // slip. Its servo also retains up to 100 ms of that former angle.
            recentSteeringLimits.push(
              steeringAngleLimit(p.speed, 0, p.tuning.steeringGrip) +
                Math.min(0.3, Math.abs(p.slipAngle)),
            );
            if (recentSteeringLimits.length > 12) recentSteeringLimits.shift();
            p.step(
              PHYSICS_STEP,
              { ...throttle, steer: direction },
              true,
              false,
            );
            const gripRate = (p.rearGripFactor - previousGrip) / PHYSICS_STEP;
            previousGrip = p.rearGripFactor;
            assert.ok(
              gripRate <= p.tuning.gripRecovery + 1e-5,
              `impact snapped rear grip: ${scenario}`,
            );
            assert.ok(
              tiltDegrees(p.rotation) < 25,
              `recovery tipped the car: ${scenario}`,
            );
            if ((i >= 42 && i < 90) || i >= 132) {
              const expected = steeringAngleLimit(
                p.speed,
                0,
                p.tuning.steeringGrip,
              );
              for (const wheel of [0, 1]) {
                const actual = -p.wheel(wheel).GetSteerAngle() * direction;
                assert.ok(
                  actual >= expected * 0.7,
                  `driver lost steering: ${scenario}, frame ${i}, angle ${actual}, expected ${expected}`,
                );
                assert.ok(
                  actual <= Math.max(...recentSteeringLimits) * 1.2 + 0.008,
                  `stale drift oversteered: ${scenario}, frame ${i}, angle ${actual}, expected ${expected}`,
                );
              }
            }
          }
          cases++;
        }
    console.log(JSON.stringify({ postImpactSteeringCases: cases }));
  } finally {
    p.dispose();
    flat.road.geometry.dispose();
  }
});

test("holding steering through an impact retains front tyre authority and turns every car clear without releasing the key", async () => {
  let cases = 0,
    longestEscape = 0,
    leastFrontGrip = Infinity;
  for (const vehicle of Object.values(VEHICLES)) {
    const flat = straightCircuit();
    const p = await Physics.create(
      flat.road,
      flat.track,
      vehicleDefaults(vehicle.id),
      {},
      vehicle.geometry,
    );
    try {
      for (const kmh of [80, 160])
        for (const degrees of [20, 45])
          for (const side of [-1, 1]) {
            p.reset(flat.track, 100, side * 1.6);
            for (let i = 0; i < 120; i++)
              p.step(PHYSICS_STEP, { ...parked, steer: side }, true, false);
            // Retain the held input even while setting the fixture's initial motion.
            launch(p, kmh, (side * degrees * Math.PI) / 180, {
              ...parked,
              handbrake: false,
              steer: side,
            });
            const input = { ...throttle, steer: side };
            for (let i = 0; i < 120 && !p.touchingWall; i++)
              p.step(PHYSICS_STEP, input, true, false);
            const label = `${vehicle.id}, ${kmh} km/h, ${degrees} degrees, side ${side}`;
            assert.ok(p.touchingWall, `fixture missed the wall: ${label}`);
            const normal = new Vector3(-side, 0, 0);
            let escaped = false;
            for (let i = 0; i < 192; i++) {
              p.step(PHYSICS_STEP, input, true, false);
              const native = p as unknown as {
                tireCaps: { lateral: number }[];
                surfaceGrip: number[];
                wallPinned: boolean;
              };
              if (!native.wallPinned)
                for (const wheel of [0, 1]) {
                  const load = p.telemetry.wheels[wheel].load;
                  if (load > 100) {
                    const available =
                      native.tireCaps[wheel].lateral /
                      (load *
                        PHYSICS_STEP *
                        p.tuning.frontGrip *
                        native.surfaceGrip[wheel]);
                    leastFrontGrip = Math.min(leastFrontGrip, available);
                    assert.ok(
                      available > 0.8,
                      `wall assist removed the steering tyre's grip: ${label}, ratio ${available}`,
                    );
                  }
                }
              if (i > 30) {
                const expected = steeringAngleLimit(
                  p.speed,
                  0,
                  p.tuning.steeringGrip,
                  vehicle.geometry.frontAxle - vehicle.geometry.rearAxle,
                );
                assert.ok(
                  -p.wheel(0).GetSteerAngle() * side > expected * 0.85,
                  `held steering was swallowed after impact: ${label}`,
                );
              }
              assert.ok(
                tiltDegrees(p.rotation) < 18,
                `impact escape tipped the car: ${label}`,
              );
              const heading = new Vector3(0, 0, 1).applyQuaternion(p.rotation);
              if (heading.dot(normal) > 0.15 && p.velocity.dot(normal) > 0.35) {
                longestEscape = Math.max(longestEscape, (i + 1) * PHYSICS_STEP);
                escaped = true;
                break;
              }
            }
            assert.ok(
              escaped,
              `held steering never changed actual travel away from the wall: ${label}`,
            );
            cases++;
          }
    } finally {
      p.dispose();
      flat.road.geometry.dispose();
    }
  }
  console.log(
    JSON.stringify({
      continuouslyHeldImpactCases: cases,
      longestEscapeSeconds: longestEscape,
      minimumFrontGripFraction: leastFrontGrip,
    }),
  );
});
