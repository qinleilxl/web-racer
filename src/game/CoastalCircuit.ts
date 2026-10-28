import { Mesh, Object3D, Vector3 } from "three";
import { Track, type RouteData } from "./Track";

export const COASTAL_ROAD_WIDTH = 12;

/** Widen across the route, preserving its centreline, elevation and length. */
export function createCoastalCircuit(
  terrain: Object3D,
  collision: Object3D,
  route: RouteData,
) {
  const source = new Track(route);
  const halfWidth = source.width / 2;
  const addedHalfWidth = (COASTAL_ROAD_WIDTH - source.width) / 2;
  const fadeStart = halfWidth + 4;
  const radius = halfWidth + 8;
  const cellSize = 16;
  const cells = new Map<string, number[]>();
  const normals = source.points.map((_, i) => {
    const tangent = source
      .point(i + 1)
      .clone()
      .sub(source.point(i - 1));
    return new Vector3(tangent.z, 0, -tangent.x).normalize();
  });
  // Only nearby route segments matter. Distant scenery is left in place and
  // large static batches do not require a whole-route search for every vertex.
  source.points.forEach((a, i) => {
    const b = source.point(i + 1);
    for (
      let x = Math.floor((Math.min(a.x, b.x) - radius) / cellSize);
      x <= Math.floor((Math.max(a.x, b.x) + radius) / cellSize);
      x++
    ) {
      for (
        let z = Math.floor((Math.min(a.z, b.z) - radius) / cellSize);
        z <= Math.floor((Math.max(a.z, b.z) + radius) / cellSize);
        z++
      ) {
        const key = `${x},${z}`;
        const bucket = cells.get(key) ?? [];
        bucket.push(i);
        cells.set(key, bucket);
      }
    }
  });
  const point = new Vector3();
  const widen = (root: Object3D) => {
    root.updateWorldMatrix(true, true);
    root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const geometry = o.geometry.clone();
      const positions = geometry.getAttribute("position");
      const inverse = o.matrixWorld.clone().invert();
      let changed = false;
      for (let v = 0; v < positions.count; v++) {
        point.fromBufferAttribute(positions, v).applyMatrix4(o.matrixWorld);
        const candidates = cells.get(
          `${Math.floor(point.x / cellSize)},${Math.floor(point.z / cellSize)}`,
        );
        if (!candidates) continue;
        let nearest = -1,
          fraction = 0,
          distanceSq = radius * radius;
        for (const i of candidates) {
          const a = source.point(i),
            b = source.point(i + 1);
          const dx = b.x - a.x,
            dz = b.z - a.z;
          const t = Math.max(
            0,
            Math.min(
              1,
              ((point.x - a.x) * dx + (point.z - a.z) * dz) /
                (dx * dx + dz * dz),
            ),
          );
          const d =
            (point.x - a.x - dx * t) ** 2 + (point.z - a.z - dz * t) ** 2;
          if (d < distanceSq) {
            nearest = i;
            fraction = t;
            distanceSq = d;
          }
        }
        if (nearest < 0) continue;
        const a = source.point(nearest),
          b = source.point(nearest + 1);
        const normal = normals[nearest]
          .clone()
          .lerp(normals[(nearest + 1) % normals.length], fraction)
          .normalize();
        const lateral =
          (point.x - a.x - (b.x - a.x) * fraction) * normal.x +
          (point.z - a.z - (b.z - a.z) * fraction) * normal.z;
        const fade = Math.max(
          0,
          (Math.sqrt(distanceSq) - fadeStart) / (radius - fadeStart),
        );
        const shift =
          addedHalfWidth *
          Math.max(-1, Math.min(1, lateral / halfWidth)) *
          (1 - fade * fade * (3 - 2 * fade));
        point.addScaledVector(normal, shift).applyMatrix4(inverse);
        positions.setXYZ(v, point.x, point.y, point.z);
        changed = true;
      }
      if (changed) {
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        o.geometry = geometry;
      } else geometry.dispose();
    });
  };
  widen(terrain);
  widen(collision);
  return {
    terrain,
    collision,
    track: new Track({ ...route, width_m: COASTAL_ROAD_WIDTH }),
    environment: {},
  };
}
