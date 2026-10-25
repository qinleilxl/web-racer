import { Vector3 } from "three";
export interface RouteData {
  centerline_blender: number[][];
  width_m: number;
  length_m: number;
}
export class Track {
  points: Vector3[];
  readonly width: number;
  readonly length: number;
  readonly gateIndices: number[];
  constructor(data: RouteData) {
    const points = data.centerline_blender.map(
      ([x, y, z]) => new Vector3(x, z, -y),
    );
    // The asset's painted start line is at its supplied spawn (sample 690).
    this.points = points.slice(690).concat(points.slice(0, 690));
    this.width = data.width_m;
    this.length = data.length_m;
    this.gateIndices = Array.from(
      { length: 8 },
      (_, i) => ((i + 1) * 120) % this.points.length,
    );
  }
  point(index: number) {
    return this.points[
      ((index % this.points.length) + this.points.length) % this.points.length
    ];
  }
  tangent(index: number) {
    return this.point(index + 2)
      .clone()
      .sub(this.point(index - 2))
      .normalize();
  }
  nearest(pos: Vector3) {
    let index = 0,
      distance = Infinity;
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2;
      if (d < distance) {
        distance = d;
        index = i;
      }
    }
    return { index, distance: Math.sqrt(distance) };
  }
  wind(index: number) {
    return (index > 310 && index < 380) || (index > 650 && index < 730);
  }
}
