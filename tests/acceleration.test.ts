import { test } from "node:test";
import assert from "node:assert/strict";
import { Physics } from "../src/game/Physics";
import { PHYSICS_STEP as dt } from "../src/game/Driving";
import { VEHICLES, type VehicleId } from "../src/game/Vehicles";
import { vehicleDefaults } from "../src/game/Tuning";
import { flatCircuit, parked, throttle, tiltDegrees } from "./helpers/driving";

test("all five factory cars launch promptly without boost, fake speed or wheel hop, with assists on or off", async () => {
  const records = [];
  const limits: Record<VehicleId, [number, number]> = {
    sparrow: [2.2, 3.9],
    scarlet: [1.9, 3.5],
    formula: [1.85, 3.2],
    targa: [2, 3.8],
    suv: [2.2, 4.8],
  };
  for (const vehicle of Object.values(VEHICLES))
    for (const assists of [true, false]) {
      const f = flatCircuit(),
        p = await Physics.create(
          f.road,
          f.track,
          vehicleDefaults(vehicle.id),
          { roadside: false },
          vehicle.geometry,
        );
      try {
        for (let i = 0; i < 180; i++) p.step(dt, parked, assists, false);
        assert.ok(p.speed < 0.05);
        let zero50 = 0,
          zero100 = 0,
          eighty = 0,
          rolling = 0,
          maximumTilt = 0,
          minContacts = 4,
          integratedDistance = 0;
        const start = p.position.clone();
        for (let i = 1; i <= 1200; i++) {
          p.step(dt, throttle, assists, false);
          integratedDistance += p.speed * dt;
          maximumTilt = Math.max(maximumTilt, tiltDegrees(p.rotation));
          minContacts = Math.min(minContacts, p.contacts);
          if (!zero50 && p.speed * 3.6 >= 50) zero50 = i * dt;
          if (!eighty && p.speed * 3.6 >= 80) eighty = i * dt;
          if (!zero100 && p.speed * 3.6 >= 100) zero100 = i * dt;
          if (p.speed * 3.6 >= 120) {
            rolling = i * dt - eighty;
            break;
          }
        }
        const label = `${vehicle.id}, assists ${assists}`;
        assert.ok(
          zero50 > 0 && zero50 < limits[vehicle.id][0],
          `${label}: 0–50 ${zero50}s`,
        );
        assert.ok(
          zero100 > 0 && zero100 < limits[vehicle.id][1],
          `${label}: 0–100 ${zero100}s`,
        );
        assert.ok(rolling > 0 && rolling < 2.6, `${label}: 80–120 ${rolling}s`);
        assert.equal(minContacts, 4, `${label}: launch lost tyre contact`);
        assert.ok(maximumTilt < 4, `${label}: chassis bucked at launch`);
        assert.ok(
          Math.abs(p.position.distanceTo(start) - integratedDistance) < 0.15,
          `${label}: HUD speed no longer matches real world motion`,
        );
        records.push({
          vehicle: vehicle.id,
          assists,
          zero50,
          zero100,
          eightyTo120: rolling,
          maximumTilt,
        });
      } finally {
        p.dispose();
        f.road.geometry.dispose();
        f.road.material.dispose();
      }
    }
  console.log(JSON.stringify({ acceleration: records }));
});
