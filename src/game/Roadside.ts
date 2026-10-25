import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from "three";
import { Track } from "./Track";

export const SHOULDER_WIDTH = 0.55;
export function createRoadside(track: Track, wallHeight = 0.9) {
  const shoulderVertices: number[] = [],
    wallVertices: number[] = [];
  const wallEdge = track.width / 2 + SHOULDER_WIDTH,
    outerEdge = track.width / 2 + 1.12;
  const normal = (i: number) => {
    const tangent = track
      .point(i + 1)
      .clone()
      .sub(track.point(i - 1));
    return new Vector3(tangent.z, 0, -tangent.x).normalize();
  };
  const point = (i: number, side: number, offset: number, height: number) =>
    track
      .point(i)
      .clone()
      .addScaledVector(normal(i), side * offset)
      .add(new Vector3(0, height, 0));
  const quad = (
    target: number[],
    a: Vector3,
    b: Vector3,
    c: Vector3,
    d: Vector3,
  ) => {
    if (
      new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).y < 0
    )
      [b, d] = [d, b];
    target.push(
      ...a.toArray(),
      ...b.toArray(),
      ...c.toArray(),
      ...a.toArray(),
      ...c.toArray(),
      ...d.toArray(),
    );
  };
  for (let i = 0; i < track.points.length; i++) {
    for (const side of [-1, 1]) {
      // Overlap the asphalt by 4 cm. Fill the original -30 cm drainage trough flush.
      quad(
        shoulderVertices,
        point(i, side, track.width / 2 - 0.04, -0.004),
        point(i + 1, side, track.width / 2 - 0.04, -0.004),
        point(i + 1, side, outerEdge, -0.004),
        point(i, side, outerEdge, -0.004),
      );
      // A single inward-facing surface: overlapping opposite faces caused duplicate contact impulses.
      const a = point(i, side, wallEdge, -0.08),
        b = point(i + 1, side, wallEdge, -0.08),
        c = point(i + 1, side, wallEdge, wallHeight),
        d = point(i, side, wallEdge, wallHeight);
      if (side === 1) quad(wallVertices, a, b, c, d);
      else quad(wallVertices, a, d, c, b);
    }
  }
  const geometry = (vertices: number[]) => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    g.computeVertexNormals();
    return g;
  };
  const material = new MeshStandardMaterial({ color: "#d4d1bb", roughness: 1 });
  const shoulders = new Mesh(geometry(shoulderVertices), material),
    walls = new Mesh(geometry(wallVertices), material);
  shoulders.name = "Flush road shoulders";
  walls.name = "Continuous inner parapets";
  shoulders.receiveShadow = true;
  walls.receiveShadow = true;
  walls.castShadow = true;
  const visual = new Group();
  visual.add(shoulders, walls);
  return { visual, shoulders, walls };
}
