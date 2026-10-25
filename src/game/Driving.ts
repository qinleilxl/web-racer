export const PHYSICS_STEP = 1 / 120;
export const VEHICLE = {
  mass: 950,
  wheelbase: 2.09,
  maxSteer: 0.52,
  torque: 440,
  cruiseLimit: 50,
  boostLimit: 58,
} as const;

// Keep keyboard steering within a predictable lateral acceleration budget.
export function steeringAngleLimit(speed: number, drift = 0) {
  return Math.min(
    VEHICLE.maxSteer,
    Math.atan((VEHICLE.wheelbase * 13) / (speed * speed + 9)) *
      (1 + drift * 0.65),
  );
}
export function blendAngle(from: number, to: number, alpha: number) {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * alpha;
}

/** Keyboard time changes slip; pushing beyond the stable grip range risks a spin. */
export class DriftControl {
  angle = 0;
  steering = 0;
  active = false;
  angleRate = 0;
  recovering = false;
  private requestedAngle = 0;
  get oversteer() {
    return Math.max(0, Math.min(1, (Math.abs(this.angle) - 0.65) / 0.4));
  }
  reset() {
    this.angle = 0;
    this.steering = 0;
    this.active = false;
    this.angleRate = this.requestedAngle = 0;
    this.recovering = false;
  }
  update(dt: number, input: number, handbrake: boolean, speed: number) {
    const wasActive = this.active;
    this.active = handbrake && speed > 5;
    if (this.active) {
      if (!wasActive) this.steering = 0;
      const counter = input * this.angle < 0;
      this.recovering = !input || counter;
      this.requestedAngle = Math.max(
        -2.8,
        Math.min(2.8, this.requestedAngle + input * dt * (counter ? 1.8 : 0.6)),
      );
      if (!input) this.requestedAngle *= Math.exp(-dt * 1.8);
      const rate = !input || counter ? 2.8 : 1.8;
      const delta = input - this.steering;
      this.steering += Math.sign(delta) * Math.min(Math.abs(delta), rate * dt);
    } else {
      this.recovering = Math.abs(this.angle) > 0.005;
      this.requestedAngle *= Math.exp(-dt * 2.4);
      const delta = input - this.steering;
      this.steering += this.recovering
        ? Math.sign(delta) * Math.min(Math.abs(delta), dt * 2.8)
        : delta;
    }
    // Critically damped slip target retains its angular momentum across release/countersteer.
    const omega = 8,
      offset = this.angle - this.requestedAngle;
    const velocity = this.angleRate + omega * offset,
      decay = Math.exp(-omega * dt);
    this.angle = this.requestedAngle + (offset + velocity * dt) * decay;
    this.angleRate = (this.angleRate - omega * velocity * dt) * decay;
  }
}
