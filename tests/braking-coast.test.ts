import { test } from "node:test";
import assert from "node:assert/strict";
import { Physics } from "../src/game/Physics";
import { PHYSICS_STEP } from "../src/game/Driving";
import { flatCircuit, parked, throttle } from "./helpers/driving";

const neutral = { ...parked, handbrake: false };

async function fixture() {
  const flat = flatCircuit();
  const p = await Physics.create(flat.road, flat.track);
  const reach = (kmh: number) => {
    p.reset(flat.track, 0);
    for (let i = 0; i < 120; i++) p.step(PHYSICS_STEP, parked, true, false);
    for (let i = 0; i < 2400 && p.speed * 3.6 < kmh; i++)
      p.step(PHYSICS_STEP, throttle, true, false);
    assert.ok(p.speed * 3.6 >= kmh, "fixture did not reach test speed");
  };
  return { p, flat, reach };
}

test("holding Space uses service-brake deceleration, overrides throttle / boost and holds without reversing", async () => {
  const { p, flat, reach } = await fixture();
  const records = [];
  try {
    for (const kmh of [60, 100, 160]) {
      const results = [];
      for (const mode of ["foot", "hand", "powered", "boosted"]) {
        reach(kmh);
        const start = p.position.clone();
        const input = {
          ...neutral,
          brake: mode === "foot" ? 1 : 0,
          handbrake: mode !== "foot",
          throttle: mode === "powered" || mode === "boosted" ? 1 : 0,
          boost: mode === "boosted",
        };
        let elapsed = 0;
        for (let i = 0; i < 1200 && p.speed * 3.6 > 3; i++) {
          p.step(PHYSICS_STEP, input, true, input.boost);
          elapsed += PHYSICS_STEP;
        }
        assert.ok(p.speed * 3.6 <= 3, `${kmh} ${mode} never stopped`);
        const distance = p.position.distanceTo(start);
        results.push({ mode, elapsed, distance });
        if (mode !== "foot") {
          assert.ok(
            elapsed <= results[0].elapsed + 0.35,
            `${kmh}: held handbrake decelerated much slower than Z: ${JSON.stringify(results)}`,
          );
          assert.ok(
            distance <= results[0].distance + (kmh / 3.6) * 0.25 + 1,
            "held handbrake retained excessive momentum",
          );
          for (let i = 0; i < 360; i++) {
            p.step(PHYSICS_STEP, input, true, input.boost);
            assert.ok(
              p.forwardSpeed > -0.05,
              "Space selected reverse or rolled backwards",
            );
          }
          assert.ok(
            p.speed < 0.03,
            "held Space did not hold the stopped vehicle",
          );
        }
      }
      records.push({ kmh, results });
    }
    console.log(JSON.stringify({ brakingComparisons: records }));
  } finally {
    p.dispose();
    flat.road.geometry.dispose();
  }
});

test("10 km/h lift-off stops naturally within eight seconds and stays at rest, while fast coasting preserves inertia", async () => {
  const { p, flat, reach } = await fixture();
  try {
    reach(10);
    const start = p.position.clone();
    let elapsed = 0;
    for (let i = 0; i < 1200 && p.speed > 0.03; i++) {
      p.step(PHYSICS_STEP, neutral, true, false);
      elapsed += PHYSICS_STEP;
      assert.ok(
        p.forwardSpeed > -0.05,
        "coasting resistance pushed the car backwards",
      );
    }
    const distance = p.position.distanceTo(start);
    assert.ok(elapsed > 2 && elapsed < 8, `10 km/h took ${elapsed}s to stop`);
    assert.ok(distance < 12, `10 km/h coast travelled ${distance}m`);
    for (let i = 0; i < 600; i++) p.step(PHYSICS_STEP, neutral, true, false);
    assert.ok(p.speed < 0.03, "stopped vehicle crept forward with no input");
    reach(100);
    for (let i = 0; i < 120; i++) p.step(PHYSICS_STEP, neutral, true, false);
    assert.ok(
      p.speed * 3.6 > 92,
      "lift-off behaved like a full service brake at speed",
    );
    console.log(
      JSON.stringify({
        lowSpeedCoastSeconds: elapsed,
        lowSpeedCoastMeters: distance,
        fastCoastAfterOneSecondKmh: p.speed * 3.6,
      }),
    );
  } finally {
    p.dispose();
    flat.road.geometry.dispose();
  }
});
