import { t } from "../i18n";
import { MathUtils, Object3D, Quaternion, Vector3 } from "three";
import type { Physics } from "./Physics";
import { RigLinks } from "./RigLinks";
import { blendAngle } from "./Driving";
import { VEHICLES, type VehicleDefinition } from "./Vehicles";

const up = new Vector3(0, 1, 0),
  down = new Vector3(0, -1, 0);

/** GLBs face -X, with local Z wheel axles and model-specific suspension rigs. */
export class CarRig {
  readonly suspension: Object3D[];
  readonly steer: Object3D[];
  readonly roll: Object3D[];
  readonly lengths = new Float64Array(4);
  readonly angles = new Float64Array(4);
  pitch = 0;
  private steeringWheel: Object3D;
  private steeringWheelRest: Quaternion;
  private steeringWheelRotation = new Quaternion();
  private steeringWheelAxis = new Vector3();
  private steeringWheelDirection = 1;
  private steerRest: Quaternion[];
  private extraLinks: RigLinks;
  private axles: Object3D[] = [];
  private links: {
    coil: Object3D;
    damper: Object3D;
    shaft: Object3D;
    arms: Object3D[];
    lower?: Object3D;
  }[];
  private facing = new Quaternion().setFromAxisAngle(up, Math.PI / 2);
  private pitchRotation = new Quaternion();
  private inversePitch = new Quaternion();
  private mechanical: {
    node: Object3D;
    target: Object3D;
    axis: Vector3;
    length: number;
  }[] = [];

  constructor(
    readonly model: Object3D,
    readonly vehicle: VehicleDefinition = VEHICLES.sparrow,
  ) {
    // Hide blades, arms and spindles before body batching, in every camera view.
    model.traverse((part) => {
      if (/wiper/i.test(part.name)) part.visible = false;
    });
    const node = (name: string) => {
      const result = model.getObjectByName(name);
      if (!result) throw new Error(t("车辆模型缺少节点：{0}", { 0: name }));
      return result;
    };
    const names = ["FL", "FR", "RL", "RR"];
    const solid = vehicle.id === "suv";
    const tags = solid ? ["front_L", "front_R", "rear_L", "rear_R"] : names;
    this.steer = tags.map((n) =>
      node(vehicle.id === "targa" ? `${n}_Root` : `STEER_${n}`),
    );
    this.steerRest = this.steer.map((n) => n.quaternion.clone());
    this.roll = tags.map((n) =>
      node(vehicle.id === "targa" ? `${n}_Spin` : `ROLL_${n}`),
    );
    this.suspension = solid ? this.steer : names.map((n) => node(`SUSP_${n}`));
    if (solid) this.axles = [node("AXLE_front"), node("AXLE_rear")];
    this.steeringWheel = node(
      solid
        ? "Steering_Wheel_Pivot"
        : vehicle.id === "targa"
          ? "TARGA_STEERING_WHEEL"
          : "STEERING_WHEEL_PIVOT",
    );
    this.steeringWheelRest = this.steeringWheel.quaternion.clone();
    this.steeringWheelAxis.copy(
      vehicle.steeringWheelAxis === "x" ? new Vector3(1, 0, 0) : up,
    );
    const columnInModel = this.steeringWheelAxis
      .clone()
      .applyQuaternion(this.steeringWheel.getWorldQuaternion(new Quaternion()))
      .applyQuaternion(model.getWorldQuaternion(new Quaternion()).invert());
    // A physical right turn has negative steer. Seen from the driver's +X
    // side, the rim must therefore rotate clockwise about the column.
    this.steeringWheelDirection = columnInModel.x >= 0 ? 1 : -1;
    this.links =
      !vehicle.rig && (vehicle.id === "sparrow" || vehicle.id === "scarlet")
        ? names.map((n) => ({
            coil: node(`COIL_${n}`),
            damper: node(`DAMPER_${n}`),
            shaft: node(`HALF_SHAFT_${n}`),
            arms:
              vehicle.id === "scarlet"
                ? [node(`WISHBONE_${n}`), node(`WISHBONE_${n}001`)]
                : [node(`CONTROL_ARM_${n}`)],
            lower: model.getObjectByName(`SHOCK_LOWER_${n}`),
          }))
        : [];
    this.extraLinks = new RigLinks(model, vehicle.id, vehicle.rig);
    // The Hifi GLB describes each mechanical endpoint, including upper arms and
    // the longer spring. Drive those actual links instead of the prototype rig.
    model.traverse((o) => {
      if (typeof o.userData.mechanical_target !== "string") return;
      const length = o.userData.rest_mesh_length;
      if (
        !(typeof length === "number" && Number.isFinite(length) && length > 0)
      )
        throw new Error(t("车辆连杆缺少有效长度：{0}", { 0: o.name }));
      this.mechanical.push({
        node: o,
        target: node(o.userData.mechanical_target),
        axis: o.userData.negative_local_z ? down : up,
        length,
      });
    });
    model.position.set(0, vehicle.geometry.modelOffset, 0);
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
        -this.vehicle.visualSteerLimit,
        this.vehicle.visualSteerLimit,
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
      if (!this.axles.length) {
        s.position
          .set(
            -(i < 2
              ? this.vehicle.geometry.frontAxle
              : this.vehicle.geometry.rearAxle),
            this.vehicle.geometry.mountY -
              this.vehicle.geometry.modelOffset -
              this.lengths[i],
            (i % 2 === 0 ? 1 : -1) *
              (i < 2
                ? this.vehicle.geometry.halfTrack
                : (this.vehicle.geometry.rearHalfTrack ??
                  this.vehicle.geometry.halfTrack)),
          )
          .applyQuaternion(this.inversePitch);
        s.quaternion.copy(this.inversePitch);
      }
      this.steer[i].quaternion
        .copy(this.steerRest[i])
        .multiply(new Quaternion().setFromAxisAngle(up, this.angles[i]));
      this.roll[i].rotation.z =
        blendAngle(p.previousRoll[i], wheel.GetRotationAngle(), alpha) *
        (this.vehicle.id === "targa" ? -1 : 1);
      if (this.mechanical.length || !this.links.length) continue;
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
      if (link.lower) {
        // Scarlet has a lower shock mount and two wishbones per wheel. Use the
        // actual rig endpoints rather than Sparrow's narrower suspension links.
        const lower = link.lower.position
          .clone()
          .applyQuaternion(s.quaternion)
          .add(anchor);
        connect(link.coil, lower.clone(), down, 0.25);
        connect(link.damper, lower.clone());
        connect(link.shaft, anchor.clone());
        link.arms.forEach((arm) => connect(arm, lower.clone()));
      } else {
        connect(link.coil, anchor.clone().setZ(side * 0.52), down, 0.3);
        connect(link.damper, anchor.clone().setZ(side * 0.52));
        connect(link.shaft, anchor.clone().setZ(side * 0.69));
        connect(link.arms[0], anchor.clone().setZ(side * 0.67));
      }
    }
    // Keep each solid bridge rigid: heave and roll are shared by its two hubs.
    for (let axle = 0; axle < this.axles.length; axle++) {
      const i = axle * 2,
        g = this.vehicle.geometry;
      const leftY = g.mountY - g.modelOffset - this.lengths[i];
      const rightY = g.mountY - g.modelOffset - this.lengths[i + 1];
      const tilt = Math.asin(
        MathUtils.clamp((rightY - leftY) / (2 * g.halfTrack), -1, 1),
      );
      this.axles[axle].position
        .set(-(axle === 0 ? g.frontAxle : g.rearAxle), (leftY + rightY) / 2, 0)
        .applyQuaternion(this.inversePitch);
      this.axles[axle].quaternion
        .copy(this.inversePitch)
        .multiply(
          new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), tilt),
        );
    }
    this.extraLinks.update();
    if (this.mechanical.length) {
      this.model.updateWorldMatrix(true, true);
      for (const link of this.mechanical) {
        const end = link.target.getWorldPosition(new Vector3());
        link.node.parent!.worldToLocal(end);
        const delta = end.sub(link.node.position);
        link.node.quaternion.setFromUnitVectors(
          link.axis,
          delta.clone().normalize(),
        );
        link.node.scale.y = delta.length() / link.length;
      }
    }
    // Spin around each model's local column axis, preserving its imported pose.
    this.steeringWheel.quaternion
      .copy(this.steeringWheelRest)
      .multiply(
        this.steeringWheelRotation.setFromAxisAngle(
          this.steeringWheelAxis,
          ((this.angles[0] + this.angles[1]) / 2) *
            (this.vehicle.steeringWheelRatio ?? 12) *
            this.steeringWheelDirection,
        ),
      );
  }
}
