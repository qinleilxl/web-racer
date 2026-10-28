import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Mesh, Raycaster, Vector3 } from "three";
import { Track } from "../src/game/Track";
import { loadCoastalCircuit } from "./helpers/coastal";

test("the widened coastal asphalt and collision agree across the entire lap without changing the route", async () => {
  const map = await loadCoastalCircuit(true);
  const original = new Track(
    JSON.parse(await readFile("public/assets/track_route.json", "utf8")),
  );
  assert.equal(map.track.width, 12);
  assert.equal(map.track.length, original.length);
  const asphalt: Mesh[] = [];
  map.terrain.traverse((o) => {
    if (
      o instanceof Mesh &&
      !Array.isArray(o.material) &&
      o.material.name === "Weathered asphalt"
    )
      asphalt.push(o);
  });
  assert.ok(asphalt.length > 0, "real rendered road was not loaded");
  map.terrain.updateWorldMatrix(true, true);
  map.collision.updateWorldMatrix(true, true);
  const ray = new Raycaster();
  ray.far = 3;
  for (let i = 0; i < map.track.points.length; i++) {
    assert.ok(map.track.point(i).equals(original.point(i)), "centreline moved");
    const tangent = map.track
      .point(i + 1)
      .clone()
      .sub(map.track.point(i - 1));
    const normal = new Vector3(tangent.z, 0, -tangent.x).normalize();
    // Both added lanes must be real asphalt, including the tight inner corners
    // and bridge. A width label / moved wall alone cannot satisfy this check.
    for (const offset of [-5.8, -4.8, 0, 4.8, 5.8]) {
      const point = map.track.point(i).clone().addScaledVector(normal, offset);
      ray.set(point.add(new Vector3(0, 2, 0)), new Vector3(0, -1, 0));
      const visible = ray.intersectObjects(asphalt)[0];
      const physical = ray.intersectObject(map.collision)[0];
      assert.ok(visible, `missing widened asphalt: ${i}, ${offset}m`);
      assert.ok(physical, `missing widened collision: ${i}, ${offset}m`);
      assert.ok(
        Math.abs(visible.point.y - physical.point.y) < 0.005,
        `visual / physical road mismatch: ${i}, ${offset}m`,
      );
    }
  }
  for (const root of [map.terrain, map.collision])
    root.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
});
