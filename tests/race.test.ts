import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { Track } from "../src/game/Track";
import { Race } from "../src/game/Race";
import { COASTAL_ROAD_WIDTH } from "../src/game/CoastalCircuit";
const track = new Track({
  ...JSON.parse(await readFile("public/assets/track_route.json", "utf8")),
  width_m: COASTAL_ROAD_WIDTH,
});
function cross(race: Race, index: number, reverse = false, offset = 0) {
  const center = track
    .point(index)
    .clone()
    .add(new Vector3(0, 0.85, 0));
  const direction = track.tangent(index).multiplyScalar(reverse ? -1 : 1);
  const side = new Vector3(direction.z, 0, -direction.x).multiplyScalar(offset);
  race.relocated(center.clone().add(side).addScaledVector(direction, -2));
  return race.update(1 / 60, center.add(side).addScaledVector(direction, 2));
}
test("gates reject shortcuts, reverse crossings, off-road crossings and teleports", () => {
  const race = new Race(track);
  assert.equal(cross(race, 240), false);
  assert.equal(cross(race, 120, true), false);
  assert.equal(cross(race, 120, false, 9), false);
  const center = track.point(120),
    dir = track.tangent(120);
  race.relocated(center.clone().addScaledVector(dir, -20));
  assert.equal(
    race.update(1 / 60, center.clone().addScaledVector(dir, 20)),
    false,
  );
  assert.equal(race.passed, 0);
  assert.equal(cross(race, 120), true);
  assert.equal(race.passed, 1);
});
test("a lap requires all eight ordered gates and forward finish crossing", () => {
  const race = new Race(track);
  for (const index of track.gateIndices) assert.equal(cross(race, index), true);
  assert.equal(race.finished, true);
  assert.equal(race.passed, 8);
  const t = race.elapsed;
  race.update(5, new Vector3());
  assert.equal(race.elapsed, t);
  race.reset();
  assert.equal(race.finished, false);
  assert.equal(race.passed, 0);
});
test("reset returns only the last earned checkpoint and adds three seconds", () => {
  const race = new Race(track);
  assert.equal(race.safeIndex, 0);
  cross(race, 120);
  assert.equal(race.safeIndex, 120);
  const before = race.elapsed;
  race.addResetPenalty();
  assert.equal(race.elapsed, before + 3);
  assert.equal(race.penalty, 3);
});
