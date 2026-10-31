import { t } from "../i18n";
import { Object3D, Vector3 } from "three";
import type { VehicleId } from "./Vehicles";

const up = new Vector3(0, 1, 0);
type Link = {
  node: Object3D;
  start?: Object3D;
  end: Object3D;
  axis: Vector3;
  length: number;
  fraction: number;
  trim?: number;
  minimum?: number;
  offset?: Vector3;
};

/** Endpoint bindings for the supplied pushrod and solid-axle rigs. */
export class RigLinks {
  private links: Link[] = [];
  constructor(
    private model: Object3D,
    id: VehicleId,
    variant?: "e-final",
  ) {
    const node = (name: string) => {
      const n = model.getObjectByName(name);
      if (!n) throw new Error(t("车辆连杆缺少节点：{0}", { 0: name }));
      return n;
    };
    const add = (name: string, end: string, start?: string, fraction = 1) => {
      const n = node(name);
      n.userData.runtime_rig = true;
      this.links.push({
        node: n,
        end: node(end),
        start: start ? node(start) : undefined,
        axis: up,
        length: 1,
        fraction,
      });
    };
    if (variant === "e-final") {
      const bind = (name: string, end: string, options: Partial<Link> = {}) => {
        const part = node(name);
        part.userData.runtime_rig = true;
        this.links.push({
          node: part,
          end: node(end),
          axis: up,
          length: 1,
          fraction: 1,
          ...options,
        });
      };
      for (const tag of ["FL", "FR", "RL", "RR"]) {
        bind(`COIL_${tag}`, `LOWER_SHOCK_${tag}`, {
          axis: new Vector3(0, -1, 0),
          length: 0.38,
        });
        bind(`SHOCK_BODY_${tag}`, `LOWER_SHOCK_${tag}`, {
          fraction: 0,
          minimum: 0.2,
        });
        bind(`SHOCK_ROD_${tag}`, `UPPER_SHOCK_${tag}`, {
          trim: 0.12,
          minimum: 0.14,
        });
        bind(`HALF_SHAFT_${tag}`, `SUSP_${tag}`);
        for (const suffix of ["-019", "019"])
          bind(`CONTROL_ARM_${tag}${suffix}`, `LOWER_SHOCK_${tag}`);
      }
    }
    if (id === "targa") {
      model.updateWorldMatrix(true, true);
      for (const tag of ["FL", "FR", "RL", "RR"]) {
        for (const [name, length] of [
          [`Suspension_coil_${tag}`, 0.32],
          [`Damper_rod_${tag}`, 1],
          [`Halfshaft_${tag}`, 1],
          [`Wishbone_${tag}-018`, 1],
          [`Wishbone_${tag}018`, 1],
        ] as const) {
          const part = node(name),
            end = node(`SUSP_${tag}`);
          const offset = end.worldToLocal(
            part.localToWorld(new Vector3(0, length, 0)),
          );
          part.userData.runtime_rig = true;
          this.links.push({
            node: part,
            end,
            offset,
            axis: up,
            length,
            fraction: 1,
          });
        }
      }
    }
    if (id === "formula") {
      for (const tag of ["FL", "FR", "RL", "RR"]) {
        for (const level of ["upper", "lower"])
          for (const suffix of ["", "001"])
            add(`Wishbone_${tag}_${level}${suffix}`, `JOINT_${tag}_${level}`);
        add(`Pushrod_${tag}`, `PUSHROD_END_${tag}`);
        if (tag.startsWith("F"))
          add(`Steering_tie_rod_${tag}`, `TIEROD_END_${tag}`);
      }
    }
    if (id === "suv") {
      for (const axle of ["front", "rear"])
        for (const side of ["L", "R"]) {
          const tag = `${axle}_${side}`;
          add(
            `Radius_control_arm_${tag}`,
            `Radius_arm_chassis_${tag}`,
            `Radius_arm_axle_${tag}`,
          );
          add(
            `Red_coil_spring_${tag}`,
            `Spring_upper_${tag}`,
            `Spring_lower_${tag}`,
          );
          add(
            `Shock_outer_${tag}`,
            `Shock_lower_${tag}`,
            `Shock_upper_${tag}`,
            0.62,
          );
          add(
            `Shock_piston_${tag}`,
            `Shock_upper_${tag}`,
            `Shock_lower_${tag}`,
          );
        }
      add(
        "Articulated_steering_tie_rod",
        "Tie_rod_steering_arm_R",
        "Tie_rod_steering_arm_L",
      );
    }
  }
  update() {
    if (!this.links.length) return;
    this.model.updateWorldMatrix(true, true);
    for (const link of this.links) {
      const parent = link.node.parent!;
      if (link.start)
        link.node.position.copy(
          parent.worldToLocal(link.start.getWorldPosition(new Vector3())),
        );
      const delta = parent
        .worldToLocal(
          link.offset
            ? link.end.localToWorld(link.offset.clone())
            : link.end.getWorldPosition(new Vector3()),
        )
        .sub(link.node.position);
      link.node.quaternion.setFromUnitVectors(
        link.axis,
        delta.clone().normalize(),
      );
      link.node.scale.y =
        Math.max(
          link.minimum ?? 0,
          delta.length() * link.fraction - (link.trim ?? 0),
        ) / link.length;
      link.node.updateWorldMatrix(false, true);
    }
  }
}
