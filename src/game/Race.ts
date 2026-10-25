import { Vector3 } from "three";
import { Track } from "./Track";
export class Race {
  elapsed = 0;
  passed = 0;
  finished = false;
  penalty = 0;
  private previous = new Vector3();
  constructor(readonly track: Track) {
    this.reset();
  }
  reset() {
    this.elapsed = 0;
    this.passed = 0;
    this.finished = false;
    this.penalty = 0;
    this.previous.copy(this.track.point(0));
  }
  get safeIndex() {
    return this.passed === 0 ? 0 : this.track.gateIndices[this.passed - 1];
  }
  relocated(pos: Vector3) {
    this.previous.copy(pos);
  }
  update(dt: number, position: Vector3) {
    if (this.finished) return false;
    this.elapsed += dt;
    const index = this.track.gateIndices[this.passed];
    const center = this.track.point(index);
    const direction = this.track.tangent(index);
    const before = this.previous.clone().sub(center).dot(direction);
    const after = position.clone().sub(center).dot(direction);
    let crossed = false;
    if (before <= 0 && after > 0) {
      // Intersect the swept path with the gate plane so a fast car cannot skip a gate.
      const hit = this.previous
        .clone()
        .lerp(position, -before / (after - before));
      if (
        hit.distanceTo(center) < this.track.width * 0.68 &&
        this.previous.distanceTo(position) < 12
      ) {
        this.passed++;
        crossed = true;
        if (this.passed === this.track.gateIndices.length) this.finished = true;
      }
    }
    this.previous.copy(position);
    return crossed;
  }
  addResetPenalty() {
    this.elapsed += 3;
    this.penalty += 3;
  }
}
