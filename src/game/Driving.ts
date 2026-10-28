import { DEFAULT_TUNING, type PhysicsTuning } from "./Tuning";
export const PHYSICS_STEP = 1 / 120;
export const VEHICLE = {
  mass: 950,
  wheelbase: 2.46,
  maxSteer: 0.52,
  torque: 650,
  cruiseLimit: 50,
  boostLimit: 58,
} as const;
export const DRIFT = {
  entrySpeed: 40 / 3.6,
  exitSpeed: 25 / 3.6,
  entrySteer: 0.25,
  displayEnter: (12 * Math.PI) / 180,
  displayExit: (8 * Math.PI) / 180,
} as const;

const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

/** More steering reserve as speed rises, without changing the parking lock. */
export function speedSteeringGain(speed: number) {
  const kmh = Math.abs(speed) * 3.6;
  const t = Math.max(0, Math.min(1, (kmh - 20) / 190));
  return 1 + 1.15 * Math.pow(t, 1.6);
}

export function roadCorneringWeight(speed: number) {
  const kmh = Math.abs(speed) * 3.6;
  // Keep the 70–80 km/h reserve while the high-speed reserve builds. The old
  // bell-shaped mid-speed boost faded before its replacement was available.
  return smooth((kmh - 45) / 25) + 2 * smooth((kmh - 85) / 75);
}

// Keep a speed-dependent envelope, with useful authority for fast direction changes.
export function steeringAngleLimit(
  speed: number,
  drift = 0,
  lateralAcceleration = DEFAULT_TUNING.steeringGrip,
  wheelbase: number = VEHICLE.wheelbase,
  normalCornering = true,
) {
  const reserve = normalCornering ? roadCorneringWeight(speed) : 0;
  const response =
    drift === 0
      ? speedSteeringGain(speed) *
        (1 + reserve * 0.25 + Math.max(0, reserve - 1) * 0.45)
      : 1;
  return Math.min(
    VEHICLE.maxSteer,
    Math.atan(
      (wheelbase * lateralAcceleration * response) / (speed * speed + 9),
    ) *
      (1 + drift * 1.4),
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
  spinning = false;
  private requestedAngle = 0;
  private heldDirection = 0;
  private heldTime = 0;
  private handbrakeDown = false;
  private entryWindow = 0;
  private reachedSlide = false;
  get oversteer() {
    return Math.max(0, Math.min(1, (Math.abs(this.angle) - 0.65) / 0.4));
  }
  interrupt() {
    this.angle = 0;
    this.active = false;
    this.angleRate = this.requestedAngle = 0;
    this.recovering = false;
    this.spinning = false;
    this.entryWindow = 0;
    this.reachedSlide = false;
  }
  reset() {
    this.interrupt();
    this.steering = 0;
    this.heldDirection = this.heldTime = 0;
    this.handbrakeDown = false;
  }
  update(
    dt: number,
    input: number,
    handbrake: boolean,
    speed: number,
    tuning?: PhysicsTuning,
    actualSlip = 0,
  ) {
    const wasActive = this.active;
    // Only a fresh handbrake pull can arm a new drift. Ordinary cornering slip
    // cannot keep an old drift alive or re-arm it after slowing down.
    const pressed = handbrake && !this.handbrakeDown;
    this.handbrakeDown = handbrake;
    this.entryWindow = pressed ? 0.2 : Math.max(0, this.entryWindow - dt);
    const entering =
      !wasActive &&
      this.entryWindow > 0 &&
      speed >= DRIFT.entrySpeed &&
      Math.abs(input) >= DRIFT.entrySteer;
    this.reachedSlide ||=
      wasActive && Math.abs(actualSlip) >= DRIFT.displayEnter;
    const finished =
      wasActive &&
      this.reachedSlide &&
      !this.spinning &&
      Math.abs(actualSlip) < DRIFT.displayExit;
    this.active =
      entering ||
      (wasActive &&
        !finished &&
        speed >= DRIFT.exitSpeed &&
        (handbrake ||
          Math.abs(this.angle) > 0.035 ||
          Math.abs(this.angleRate) > 0.08 ||
          Math.abs(this.requestedAngle) > 0.015 ||
          Math.abs(actualSlip) > DRIFT.displayExit));
    if (entering) {
      this.entryWindow = 0;
      this.reachedSlide = false;
    }
    if (speed < DRIFT.exitSpeed) {
      this.active = false;
      this.requestedAngle = 0;
      this.entryWindow = 0;
    }
    if (wasActive && !this.active) {
      // The remaining yaw target can unwind, but steering cannot build it again
      // once the actual slide has crossed the same exit used by the HUD.
      this.requestedAngle = 0;
      this.entryWindow = 0;
      this.reachedSlide = false;
    }
    if (this.active && Math.abs(actualSlip) > 1.4 && this.oversteer > 0.6)
      this.spinning = true;
    if (this.spinning && speed < 3) this.interrupt();
    else if (Math.abs(actualSlip) < 0.35 && Math.abs(this.angle) < 0.5)
      this.spinning = false;
    const direction = Math.sign(input);
    this.heldTime =
      direction && direction === this.heldDirection ? this.heldTime + dt : 0;
    this.heldDirection = direction;
    // Immediate initial bite, then increasing lock while held. The wheel servo
    // below this controller remains fast, rather than adding a second slow ramp.
    const lock = Math.min(
      1,
      0.38 +
        this.heldTime *
          (tuning?.steeringRate ?? DEFAULT_TUNING.steeringRate) *
          0.3,
    );
    this.steering = input * lock;
    if (this.active) {
      const observedSlide =
        !this.spinning && Math.abs(actualSlip) > DRIFT.displayExit;
      const counter = input * (observedSlide ? actualSlip : this.angle) < 0;
      this.recovering = !input || counter;
      this.requestedAngle = Math.max(
        -2.8,
        Math.min(
          2.8,
          this.requestedAngle +
            input *
              dt *
              (counter
                ? (tuning?.driftCounter ?? DEFAULT_TUNING.driftCounter)
                : (tuning?.driftBuild ?? DEFAULT_TUNING.driftBuild)),
        ),
      );
      // Countersteer unwinds the actual slide. Do not build an opposite drift
      // just because the internal target crossed zero before the car caught up.
      if (counter && observedSlide && this.requestedAngle * actualSlip < 0)
        this.requestedAngle = 0;
      if (!input)
        this.requestedAngle *= Math.exp(
          -dt *
            (tuning?.driftReturn ?? DEFAULT_TUNING.driftReturn) *
            (handbrake ? 0.45 : 0.6),
        );
    } else {
      this.recovering = Math.abs(this.angle) > 0.005;
      this.requestedAngle *= Math.exp(
        (-dt * (tuning?.driftReturn ?? DEFAULT_TUNING.driftReturn) * 4) / 3,
      );
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
