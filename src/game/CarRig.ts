import { MathUtils, Object3D, Quaternion, Vector3 } from "three";
import type { Physics } from "./Physics";
import { blendAngle } from "./Driving";

const up = new Vector3(0, 1, 0),
  down = new Vector3(0, -1, 0);

/** The GLB faces -X, with local Z wheel axles and independent suspension pivots. */
export class CarRig {
  readonly suspension: Object3D[];
  readonly steer: Object3D[];
  readonly roll: Object3D[];
  readonly lengths = new Float64Array(4);
  readonly angles = new Float64Array(4);
  pitch = 0;
  private steeringWheel: Object3D;
  private links: {
    coil: Object3D;
    damper: Object3D;
    shaft: Object3D;
    arm: Object3D;
  }[];
  private facing = new Quaternion().setFromAxisAngle(up, Math.PI / 2);
  private pitchRotation = new Quaternion();
  private inversePitch = new Quaternion();

  constructor(readonly model: Object3D) {
    const node = (name: string) => {
      const result = model.getObjectByName(name);
      if (!result) throw new Error(`车辆模型缺少节点：${name}`);
      return result;
    };
    const names = ["FL", "FR", "RL", "RR"];
    this.suspension = names.map((n) => node(`SUSP_${n}`));
    this.steer = names.map((n) => node(`STEER_${n}`));
    this.roll = names.map((n) => node(`ROLL_${n}`));
    this.steeringWheel = node("STEERING_WHEEL_PIVOT");
    this.links = names.map((n) => ({
      coil: node(`COIL_${n}`),
      damper: node(`DAMPER_${n}`),
      shaft: node(`HALF_SHAFT_${n}`),
      arm: node(`CONTROL_ARM_${n}`),
    }));
    model.position.set(0, -0.84, 0);
    model.quaternion.copy(this.facing);
  }

  update(p: Physics, alpha: number, dt: number) {
    for (let i = 0; i < 4; i++) {
      this.lengths[i] = MathUtils.lerp(
        p.previousSuspension[i],
        p.wheel(i).GetSuspensionLength(),
        alpha,
      );
      const physical = MathUtils.lerp(
        p.previousSteer[i],
        p.wheel(i).GetSteerAngle(),
        alpha,
      );
      // Make small speed-limited angles readable; retain the real sign, centre and 30 degree stop.
      this.angles[i] = MathUtils.clamp(
        Math.atan(Math.tan(physical) * 2.2),
        -0.52,
        0.52,
      );
    }
    const front = (this.lengths[0] + this.lengths[1]) / 2;
    const rear = (this.lengths[2] + this.lengths[3]) / 2;
    const target = MathUtils.clamp((rear - front) * 0.95, -0.045, 0.045);
    this.pitch = MathUtils.damp(this.pitch, target, 10, dt);
    this.pitchRotation.setFromAxisAngle(new Vector3(0, 0, 1), this.pitch);
    this.inversePitch.copy(this.pitchRotation).invert();
    this.model.quaternion.copy(this.facing).multiply(this.pitchRotation);
    for (let i = 0; i < 4; i++) {
      const wheel = p.wheel(i),
        s = this.suspension[i];
      // Body feedback must not lift the wheels off their real suspension positions.
      s.position
        .set(
          i < 2 ? -1.07 : 1.02,
          0.76 - this.lengths[i],
          i % 2 === 0 ? 0.735 : -0.735,
        )
        .applyQuaternion(this.inversePitch);
      s.quaternion.copy(this.inversePitch);
      this.steer[i].rotation.y = this.angles[i];
      this.roll[i].rotation.z = blendAngle(
        p.previousRoll[i],
        wheel.GetRotationAngle(),
        alpha,
      );
      const link = this.links[i],
        side = i % 2 === 0 ? 1 : -1;
      const anchor = s.position.clone();
      const connect = (
        node: Object3D,
        end: Vector3,
        axis = up,
        unitLength = 1,
      ) => {
        const delta = end.sub(node.position);
        node.quaternion.setFromUnitVectors(axis, delta.clone().normalize());
        node.scale.y = delta.length() / unitLength;
      };
      connect(link.coil, anchor.clone().setZ(side * 0.52), down, 0.3);
      connect(link.damper, anchor.clone().setZ(side * 0.52));
      connect(link.shaft, anchor.clone().setZ(side * 0.69));
      connect(link.arm, anchor.clone().setZ(side * 0.67));
    }
    this.steeringWheel.rotation.z =
      ((this.angles[0] + this.angles[1]) / 2) * 12;
  }
}
