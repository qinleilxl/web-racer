import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3, Quaternion } from "three";
import { Physics } from "../src/game/Physics";
import { PHYSICS_STEP as dt } from "../src/game/Driving";
import { VEHICLES } from "../src/game/Vehicles";
import { vehicleDefaults } from "../src/game/Tuning";
import { flatCircuit, parked, throttle, tiltDegrees } from "./helpers/driving";

test("every vehicle brakes to a real stop promptly, with held Space matching service brakes", async () => {
  const records = [];
  for (const vehicle of Object.values(VEHICLES)) {
    const f = flatCircuit(),
      p = await Physics.create(
        f.road,
        f.track,
        vehicleDefaults(vehicle.id),
        { roadside: false },
        vehicle.geometry,
      );
    try {
      for (const kmh of [30, 60, 100, 140]) {
        const results = [];
        for (const mode of ["foot", "hand"]) {
          p.reset(f.track, 0);
          for (let i = 0; i < 120; i++) p.step(dt, parked, true, false);
          for (let i = 0; i < 4800 && p.speed * 3.6 < kmh; i++)
            p.step(dt, throttle, true, false);
          assert.ok(p.speed * 3.6 >= kmh, "fixture did not reach target speed");
          const position = p.position.clone();
          const input = {
            throttle: mode === "hand" ? 1 : 0,
            brake: mode === "foot" ? 1 : 0,
            steer: 0,
            handbrake: mode === "hand",
            boost: mode === "hand",
          };
          let time = 0;
          for (let i = 0; i < 1200 && p.speed > 0.05; i++) {
            p.step(dt, input, true, input.boost);
            time += dt;
            assert.ok(tiltDegrees(p.rotation) < 18);
          }
          const distance = p.position.distanceTo(position);
          const limit =
            kmh === 30
              ? [2, 10]
              : kmh === 60
                ? [2.8, 24]
                : kmh === 100
                  ? [4.2, 52]
                  : [6.1, 104];
          const scenario = vehicle.id + " " + kmh + " " + mode;
          assert.ok(
            p.speed < 0.05 && time < limit[0] + (mode === "hand" ? 0.35 : 0),
            scenario + " took " + time + " seconds to stop",
          );
          assert.ok(
            distance < limit[1] + (mode === "hand" ? (kmh / 3.6) * 0.3 : 0),
            scenario + " travelled " + distance + " metres",
          );
          if (mode === "hand") {
            assert.ok(time < results[0].time + 0.4);
            for (let i = 0; i < 180; i++) p.step(dt, input, true, true);
            assert.ok(p.speed < 0.03 && p.forwardSpeed > -0.05);
          }
          results.push({ mode, time, distance });
        }
        records.push({ vehicle: vehicle.id, kmh, results });
      }
    } finally {
      p.dispose();
      f.road.geometry.dispose();
    }
  }
  console.log(JSON.stringify({ fourCarBraking: records }));
});

test("strong ABS cannot wind down brake pressure into a prolonged coast", async () => {
  const records = [];
  for (const vehicle of Object.values(VEHICLES)) {
    const results = [];
    for (const strength of [0, 100]) {
      const f = flatCircuit(),
        p = await Physics.create(
          f.road,
          f.track,
          { ...vehicleDefaults(vehicle.id), abs: strength },
          { roadside: false },
          vehicle.geometry,
        );
      try {
        for (let i = 0; i < 120; i++) p.step(dt, parked, true, false);
        for (let i = 0; i < 3600 && p.speed * 3.6 < 100; i++)
          p.step(dt, throttle, true, false);
        const start = p.position.clone();
        let time = 0,
          peakRelease = 0;
        for (let i = 0; i < 1200 && p.speed > 0.05; i++) {
          p.step(
            dt,
            { throttle: 0, brake: 1, steer: 0, handbrake: false, boost: false },
            true,
            false,
          );
          time += dt;
          peakRelease = Math.max(peakRelease, p.telemetry.abs);
        }
        assert.ok(
          p.speed < 0.05 && time < 4.5,
          vehicle.id +
            " ABS " +
            strength +
            " stopped in " +
            time +
            "s over " +
            p.position.distanceTo(start) +
            "m; final speed " +
            p.speed,
        );
        results.push({
          strength,
          time,
          distance: p.position.distanceTo(start),
          peakRelease,
        });
      } finally {
        p.dispose();
        f.road.geometry.dispose();
      }
    }
    assert.ok(results[1].time < results[0].time * 1.45);
    assert.ok(results[1].distance < results[0].distance * 1.35);
    assert.ok(results[1].peakRelease > 0.05 && results[1].peakRelease < 0.86);
    records.push({ vehicle: vehicle.id, results });
  }
  console.log(JSON.stringify({ absBraking: records }));
});

test("braking a sideways or backward slide does not select reverse before stopping", async () => {
  const f = flatCircuit(),
    p = await Physics.create(
      f.road,
      f.track,
      vehicleDefaults("suv"),
      { roadside: false },
      VEHICLES.suv.geometry,
    );
  try {
    for (const angle of [Math.PI / 2, Math.PI]) {
      p.reset(f.track, 0);
      for (let i = 0; i < 120; i++) p.step(dt, parked, true, false);
      for (let i = 0; i < 3600 && p.speed * 3.6 < 80; i++)
        p.step(dt, throttle, true, false);
      const rotation = p.rotation
        .clone()
        .multiply(
          new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle),
        );
      const q = new p.J.Quat(rotation.x, rotation.y, rotation.z, rotation.w);
      p.system
        .GetBodyInterface()
        .SetRotation(p.body.GetID(), q, p.J.EActivation_Activate);
      p.J.destroy(q);
      p.sync();
      assert.ok(p.speed > 20 && p.forwardSpeed < 1);
      for (let i = 0; i < 600 && p.speed > 0.5; i++) {
        p.step(
          dt,
          { throttle: 0, brake: 1, steer: 0, handbrake: false, boost: false },
          true,
          false,
        );
        if (p.speed > 1)
          assert.equal(
            p.braking,
            true,
            "Z stopped applying service brakes during a slide",
          );
      }
      assert.ok(p.speed < 0.5, "sliding vehicle never stopped");
    }
  } finally {
    p.dispose();
    f.road.geometry.dispose();
  }
});
