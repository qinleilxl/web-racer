import { VEHICLES, type VehicleId } from "./Vehicles";

/** Versioned, bounded setup shared by the simulation and the garage debugger. */
export const TUNING_SCHEMA = {
  mass: {
    group: "动力与车身",
    label: "整备质量",
    unit: "kg",
    min: 700,
    max: 1800,
    step: 10,
    value: 950,
  },
  torque: {
    group: "动力与车身",
    label: "发动机峰值扭矩",
    unit: "N·m",
    min: 180,
    max: 1200,
    step: 10,
    value: 650,
  },
  topSpeed: {
    group: "动力与车身",
    label: "动力限速",
    unit: "km/h",
    min: 100,
    max: 240,
    step: 5,
    value: 180,
  },
  finalDrive: {
    group: "动力与车身",
    label: "主减速比",
    unit: ":1",
    min: 2.5,
    max: 5,
    step: 0.1,
    value: 3.7,
  },
  frontDrive: {
    group: "动力与车身",
    label: "前轴动力分配",
    unit: "%",
    min: 0,
    max: 100,
    step: 5,
    value: 0,
  },
  centerOfMass: {
    group: "动力与车身",
    label: "重心下移",
    unit: "m",
    min: 0.25,
    max: 0.65,
    step: 0.01,
    value: 0.54,
  },
  aeroDrag: {
    group: "动力与车身",
    label: "风阻系数 × 迎风面积",
    unit: "m²",
    min: 0.2,
    max: 1.2,
    step: 0.05,
    value: 0.55,
  },
  downforce: {
    group: "动力与车身",
    label: "下压力系数",
    unit: "N/(m/s)²",
    min: 0,
    max: 2,
    step: 0.1,
    value: 0.7,
  },
  brakeTorque: {
    group: "轮胎与制动",
    label: "单轮基准制动扭矩",
    unit: "N·m",
    min: 600,
    max: 2800,
    step: 50,
    value: 1700,
  },
  brakeBias: {
    group: "轮胎与制动",
    label: "前轴制动力分配",
    unit: "%",
    min: 45,
    max: 75,
    step: 1,
    value: 60,
  },
  longitudinalGrip: {
    group: "轮胎与制动",
    label: "纵向峰值抓地",
    unit: "μ",
    min: 0.8,
    max: 2.8,
    step: 0.05,
    value: 1.9,
  },
  frontGrip: {
    group: "轮胎与制动",
    label: "前轮横向抓地基准",
    unit: "μ",
    min: 0.7,
    max: 1.8,
    step: 0.05,
    value: 1.2,
  },
  rearGrip: {
    group: "轮胎与制动",
    label: "后轮横向抓地基准",
    unit: "μ",
    min: 0.7,
    max: 1.8,
    step: 0.05,
    value: 1.4,
  },
  loadSensitivity: {
    group: "轮胎与制动",
    label: "轮胎载荷敏感度",
    unit: "",
    min: 0,
    max: 0.3,
    step: 0.01,
    value: 0.12,
  },
  combinedGrip: {
    group: "轮胎与制动",
    label: "纵横抓地耦合",
    unit: "%",
    min: 0,
    max: 100,
    step: 5,
    value: 100,
  },
  tractionControl: {
    group: "轮胎与制动",
    label: "牵引力控制",
    unit: "%",
    min: 0,
    max: 100,
    step: 5,
    value: 65,
  },
  abs: {
    group: "轮胎与制动",
    label: "防抱死辅助",
    unit: "%",
    min: 0,
    max: 100,
    step: 5,
    value: 80,
  },
  frontFrequency: {
    group: "悬挂与转向",
    label: "前悬挂固有频率",
    unit: "Hz",
    min: 1.1,
    max: 3,
    step: 0.05,
    value: 1.65,
  },
  rearFrequency: {
    group: "悬挂与转向",
    label: "后悬挂固有频率",
    unit: "Hz",
    min: 1.1,
    max: 3,
    step: 0.05,
    value: 1.55,
  },
  suspensionDamping: {
    group: "悬挂与转向",
    label: "悬挂阻尼比",
    unit: "",
    min: 0.5,
    max: 1.5,
    step: 0.05,
    value: 1,
  },
  frontAntiRoll: {
    group: "悬挂与转向",
    label: "前防倾杆刚度",
    unit: "N/m",
    min: 1000,
    max: 14000,
    step: 500,
    value: 6000,
  },
  rearAntiRoll: {
    group: "悬挂与转向",
    label: "后防倾杆刚度",
    unit: "N/m",
    min: 1000,
    max: 14000,
    step: 500,
    value: 5000,
  },
  steeringRate: {
    group: "悬挂与转向",
    label: "方向响应速度",
    unit: "/s",
    min: 3,
    max: 16,
    step: 0.5,
    value: 9,
  },
  steeringGrip: {
    group: "悬挂与转向",
    label: "转向横向预算基准",
    unit: "m/s²",
    min: 7,
    max: 17,
    step: 0.5,
    value: 9.5,
  },
  driftBuild: {
    group: "漂移与辅助",
    label: "同向按键增角速度",
    unit: "rad/s",
    min: 0.25,
    max: 1,
    step: 0.05,
    value: 0.5,
  },
  driftCounter: {
    group: "漂移与辅助",
    label: "反打收角速度",
    unit: "rad/s",
    min: 0.8,
    max: 2.8,
    step: 0.1,
    value: 1.8,
  },
  driftReturn: {
    group: "漂移与辅助",
    label: "松方向回正速度",
    unit: "/s",
    min: 0.8,
    max: 3,
    step: 0.1,
    value: 1.8,
  },
  gripRecovery: {
    group: "漂移与辅助",
    label: "后轮抓地恢复速度",
    unit: "/s",
    min: 0.2,
    max: 0.7,
    step: 0.05,
    value: 0.4,
  },
  driftGripLoss: {
    group: "漂移与辅助",
    label: "起漂后轴抓地降低",
    unit: "%",
    min: 15,
    max: 72,
    step: 1,
    value: 25,
  },
  stability: {
    group: "漂移与辅助",
    label: "车身稳定辅助",
    unit: "%",
    min: 0,
    max: 100,
    step: 5,
    value: 85,
  },
  handbrake: {
    group: "漂移与辅助",
    label: "漂移手刹力度",
    unit: "%",
    min: 5,
    max: 35,
    step: 1,
    value: 16,
  },
  roadGrip: {
    group: "赛道与碰撞",
    label: "沥青抓地倍率",
    unit: "×",
    min: 0.4,
    max: 1.5,
    step: 0.05,
    value: 1,
  },
  shoulderGrip: {
    group: "赛道与碰撞",
    label: "路肩抓地倍率",
    unit: "×",
    min: 0.35,
    max: 1.3,
    step: 0.05,
    value: 0.85,
  },
  gravity: {
    group: "赛道与碰撞",
    label: "重力加速度",
    unit: "m/s²",
    min: 6,
    max: 14,
    step: 0.01,
    value: 9.81,
  },
  restitution: {
    group: "赛道与碰撞",
    label: "护墙回弹系数",
    unit: "",
    min: 0,
    max: 0.4,
    step: 0.01,
    value: 0.08,
  },
  maxRebound: {
    group: "赛道与碰撞",
    label: "碰撞回弹速度上限",
    unit: "m/s",
    min: 0.5,
    max: 4,
    step: 0.1,
    value: 1.1,
  },
  wallFriction: {
    group: "赛道与碰撞",
    label: "护墙接触摩擦",
    unit: "μ",
    min: 0,
    max: 0.3,
    step: 0.01,
    value: 0.06,
  },
  impactRotation: {
    group: "赛道与碰撞",
    label: "碰撞旋转响应",
    unit: "%",
    min: 0,
    max: 35,
    step: 1,
    value: 6,
  },
  wallDrag: {
    group: "赛道与碰撞",
    label: "持续擦墙减速度上限",
    unit: "m/s²",
    min: 2,
    max: 12,
    step: 0.5,
    value: 8,
  },
  wallSpeed: {
    group: "赛道与碰撞",
    label: "擦墙动力限速",
    unit: "km/h",
    min: 30,
    max: 90,
    step: 5,
    value: 65,
  },
  windRecharge: {
    group: "赛道与碰撞",
    label: "风道能量补充",
    unit: "%/s",
    min: 5,
    max: 50,
    step: 1,
    value: 24,
  },
  boostForce: {
    group: "动力与车身",
    label: "风道加速推力",
    unit: "N",
    min: 1000,
    max: 8000,
    step: 100,
    value: 5200,
  },
} as const;
export type TuningKey = keyof typeof TUNING_SCHEMA;
export type PhysicsTuning = Record<TuningKey, number>;
export const DEFAULT_TUNING = Object.fromEntries(
  Object.entries(TUNING_SCHEMA).map(([key, field]) => [key, field.value]),
) as PhysicsTuning;
export const TUNING_GROUPS = [
  ...new Set(Object.values(TUNING_SCHEMA).map((field) => field.group)),
];
export const TUNING_PRESETS: Record<
  string,
  { label: string; values: Partial<PhysicsTuning> }
> = {
  balanced: { label: "小燕号 · 均衡", values: {} },
  grip: {
    label: "抓地竞速",
    values: {
      frontGrip: 1.5,
      rearGrip: 1.55,
      driftGripLoss: 20,
      frontFrequency: 1.9,
      rearFrequency: 1.8,
      tractionControl: 85,
    },
  },
  drift: {
    label: "后驱漂移",
    values: {
      rearGrip: 1.15,
      driftBuild: 0.7,
      driftGripLoss: 66,
      tractionControl: 35,
      rearAntiRoll: 7000,
    },
  },
  wet: {
    label: "湿滑路面",
    values: {
      roadGrip: 0.65,
      shoulderGrip: 0.5,
      steeringGrip: 9,
      tractionControl: 90,
      abs: 100,
    },
  },
};
export function sanitizeTuning(value: unknown): PhysicsTuning {
  const input =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    Object.entries(TUNING_SCHEMA).map(([key, field]) => {
      const n = input[key];
      return [
        key,
        typeof n === "number" && Number.isFinite(n)
          ? Math.min(field.max, Math.max(field.min, n))
          : field.value,
      ];
    }),
  ) as PhysicsTuning;
}
export function vehicleDefaults(id: VehicleId = "sparrow"): PhysicsTuning {
  return sanitizeTuning({ ...DEFAULT_TUNING, ...VEHICLES[id].tuning });
}
export function tuningPreset(
  key: string,
  id: VehicleId = "sparrow",
): PhysicsTuning {
  return sanitizeTuning({
    ...vehicleDefaults(id),
    ...TUNING_PRESETS[key]?.values,
  });
}
export function tuningIsStandard(
  tuning: PhysicsTuning,
  id: VehicleId = "sparrow",
) {
  const standard = vehicleDefaults(id);
  return (Object.keys(DEFAULT_TUNING) as TuningKey[]).every(
    (key) => tuning[key] === standard[key],
  );
}
export function serializeTuning(tuning: PhysicsTuning) {
  return JSON.stringify(
    { version: 1, setupRevision: 5, tuning: sanitizeTuning(tuning) },
    null,
    2,
  );
}
export function parseTuning(json: string): PhysicsTuning {
  const data = JSON.parse(json);
  if (
    data?.version !== 1 ||
    !data.tuning ||
    typeof data.tuning !== "object" ||
    Array.isArray(data.tuning)
  )
    throw new Error("请选择版本 1 的云岬调校 JSON");
  for (const key of Object.keys(TUNING_SCHEMA))
    if (
      typeof data.tuning[key] !== "number" ||
      !Number.isFinite(data.tuning[key])
    )
      throw new Error(`参数 ${key} 缺失或不是有效数字`);
  return sanitizeTuning(data.tuning);
}
export function loadTuning(id: VehicleId = "sparrow"): PhysicsTuning {
  try {
    const value = localStorage.getItem(tuningStorageKey(id));
    if (!value) return vehicleDefaults(id);
    const stored = parseTuning(value);
    // Migrate exact shipped setups only. Imported or deliberately edited values
    // remain literal, including old torque/grip and rebound combinations explicitly reimported.
    const revision = JSON.parse(value).setupRevision;
    const previousPower = {
      sparrow: [440, 1.45],
      scarlet: [600, 1.55],
      formula: [500, 1.6],
      targa: [470, 1.5],
      suv: [560, 1.55],
    } as const;
    const previousBase = {
      ...DEFAULT_TUNING,
      torque: 440,
      longitudinalGrip: 1.45,
      restitution: 0.16,
      maxRebound: 2.4,
    };
    const previousStandard = {
      ...vehicleDefaults(id),
      torque: previousPower[id][0],
      longitudinalGrip: previousPower[id][1],
      restitution: 0.16,
      maxRebound: 2.4,
    };
    const shippedDefault =
      revision === 4
        ? { ...vehicleDefaults(id), restitution: 0.16, maxRebound: 2.4 }
        : revision === 3 || (revision === undefined && id !== "sparrow")
          ? previousStandard
          : id === "sparrow" && revision === undefined
            ? {
                ...previousBase,
                frontGrip: 1.15,
                rearGrip: 1.15,
                steeringGrip: 13,
                driftBuild: 0.6,
                driftGripLoss: 62,
              }
            : id === "sparrow" && revision === 2
              ? { ...previousBase, driftGripLoss: 55 }
              : null;
    const wasStandard =
      shippedDefault &&
      (Object.keys(shippedDefault) as TuningKey[]).every(
        (key) => stored[key] === shippedDefault[key],
      );
    return wasStandard ? vehicleDefaults(id) : stored;
  } catch {
    return vehicleDefaults(id);
  }
}
function tuningStorageKey(id: VehicleId) {
  return id === "sparrow" ? "cloudcape.tuning.v1" : `cloudcape.tuning.${id}.v1`;
}
export function saveTuning(value: PhysicsTuning, id: VehicleId = "sparrow") {
  localStorage.setItem(tuningStorageKey(id), serializeTuning(value));
}
/** Loads in N, suspension in m, angles in degrees; slipRatio is signed (lock < 0). */
export type WheelTelemetry = {
  grounded: boolean;
  load: number;
  slipRatio: number;
  slipAngle: number;
  gripUsage: number;
  suspension: number;
};
/** Angles in degrees; yawRate in degrees/s; G relative to configured gravity. */
export type PhysicsTelemetry = {
  slipAngle: number;
  yawRate: number;
  lateralG: number;
  longitudinalG: number;
  rearGrip: number;
  wallContact: boolean;
  impactSpeed: number;
  tcs: number;
  abs: number;
  wheels: WheelTelemetry[];
};
