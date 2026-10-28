import type { PhysicsTuning } from "./Tuning";
import type { Object3D } from "three";

export type VehicleId = "sparrow" | "scarlet" | "formula" | "suv" | "targa";
export type VehicleGeometry = {
  halfExtents: [number, number, number];
  frontAxle: number;
  rearAxle: number;
  halfTrack: number;
  rearHalfTrack?: number;
  rearWidth?: number;
  mountY: number;
  radius: number;
  width: number;
  modelOffset: number;
  spawnHeight: number;
};
export type VehicleDefinition = {
  id: VehicleId;
  name: string;
  english: string;
  description: string;
  asset: string;
  color: string;
  rig?: "e-final";
  convertible?: boolean;
  instrumentKind?: "none" | "digital" | "analog";
  exhausts: {
    node: string;
    radius: number;
    tilted?: boolean;
    direction?: [number, number, number];
  }[];
  /** Actual red lens meshes, grouped by physical fixture in the GLB. */
  brakeLamps: {
    name: string;
    nodes: string[];
    surrounds?: string[];
    minimumLensHeight?: number;
    shape?: "strip";
    running?: boolean;
  }[];
  geometry: VehicleGeometry;
  cockpitEye: [number, number, number];
  cockpitLook: [number, number, number];
  glassMaterial: string;
  glassMaterials?: string[];
  steeringWheelAxis?: "x" | "y";
  steeringWheelRatio?: number;
  visualSteerLimit: number;
  tuning: Partial<PhysicsTuning>;
};

export const VEHICLES: Record<VehicleId, VehicleDefinition> = {
  sparrow: {
    id: "sparrow",
    name: "小燕号",
    english: "SPARROW ONE",
    description:
      "奶油白低伏车身，陶红车顶与外露机械。带着复古的温度，追逐海岸的风。",
    asset: "/assets/Sparrow_One_E_Final.glb",
    color: "#d5c8a3",
    rig: "e-final",
    instrumentKind: "analog",
    exhausts: [
      {
        node: "Exhaust_outlet_rolled_metal_lip",
        radius: 0.052,
        direction: [0.92, 0.36, -0.16],
      },
    ],
    brakeLamps: [
      {
        name: "left",
        nodes: ["Rear_lamp_inset_domed_fluted_lens"],
      },
      {
        name: "right",
        nodes: ["Rear_lamp_inset_domed_fluted_lens002"],
      },
    ],
    geometry: {
      halfExtents: [1.05, 0.27, 2],
      frontAxle: 1.23,
      rearAxle: -1.23,
      halfTrack: 0.9,
      mountY: -0.12,
      radius: 0.395,
      width: 0.3,
      modelOffset: -0.9,
      spawnHeight: 0.95,
    },
    cockpitEye: [0.3, 1.4, 0.34],
    cockpitLook: [-20, -0.4, 0.34],
    glassMaterial: "Window glass",
    visualSteerLimit: (28 * Math.PI) / 180,
    tuning: {},
  },
  scarlet: {
    id: "scarlet",
    name: "赤风号",
    english: "SCARLET",
    description: "深红车身，低伏车姿与双管排气。带着炽热声浪，追逐海岸的风。",
    asset: "/assets/Hifi_Animated.glb",
    color: "#ae2925",
    exhausts: [
      { node: "Exhaust_deep_bore_darkness", radius: 0.065 },
      { node: "Exhaust_deep_bore_darkness001", radius: 0.065 },
    ],
    brakeLamps: [
      {
        name: "left",
        nodes: ["Tail_optical_inner_light_guide_-1"],
        surrounds: ["Thin_red_perimeter_tail_light_-1"],
        minimumLensHeight: 0.014,
        shape: "strip",
      },
      {
        name: "right",
        nodes: ["Tail_optical_inner_light_guide_1"],
        surrounds: ["Thin_red_perimeter_tail_light_1"],
        minimumLensHeight: 0.014,
        shape: "strip",
      },
      {
        name: "central-rain",
        nodes: ["Red_vertical_rain_lamp_lens"],
        running: false,
      },
    ],
    geometry: {
      halfExtents: [1.1, 0.22, 2.15],
      frontAxle: 1.36,
      rearAxle: -1.36,
      halfTrack: 1.06,
      rearHalfTrack: 1.075,
      mountY: 0.04,
      radius: 0.377,
      width: 0.29,
      modelOffset: -0.72,
      spawnHeight: 0.77,
    },
    cockpitEye: [0.2, 1.08, 0.34],
    cockpitLook: [-20, -0.6, 0.34],
    glassMaterial: "Smoked clear glass",
    visualSteerLimit: 0.52,
    tuning: {
      mass: 1250,
      torque: 1000,
      topSpeed: 220,
      finalDrive: 3.4,
      centerOfMass: 0.32,
      aeroDrag: 0.5,
      downforce: 1.1,
      brakeTorque: 2300,
      frontFrequency: 3,
      rearFrequency: 3.2,
      frontGrip: 1.25,
      rearGrip: 1.4,
      longitudinalGrip: 2.15,
      boostForce: 6500,
    },
  },
  formula: {
    id: "formula",
    name: "苍穹号",
    english: "AZURE FORMULA",
    description: "开放式座舱，推杆悬挂与宽幅光头胎。贴着海风，驶向天际。",
    asset: "/assets/Formula_Animated.glb",
    color: "#4778bd",
    exhausts: [{ node: "Open_exhaust_titanium", radius: 0.067 }],
    brakeLamps: [
      {
        name: "rear-led",
        nodes: Array.from(
          { length: 12 },
          (_, i) => `Rain_LED_lens${i ? String(i).padStart(3, "0") : ""}`,
        ),
      },
    ],
    geometry: {
      halfExtents: [1.05, 0.18, 2.65],
      frontAxle: 1.65,
      rearAxle: -1.65,
      halfTrack: 0.86,
      mountY: 0.08,
      radius: 0.4312,
      width: 0.394,
      rearWidth: 0.474,
      modelOffset: -0.77,
      spawnHeight: 0.82,
    },
    cockpitEye: [0.18, 0.86, 0],
    cockpitLook: [-20, -1.5, 0],
    glassMaterial: "",
    visualSteerLimit: 0.46,
    steeringWheelAxis: "x",
    steeringWheelRatio: 3,
    tuning: {
      mass: 750,
      torque: 750,
      topSpeed: 240,
      finalDrive: 3.4,
      centerOfMass: 0.38,
      aeroDrag: 0.5,
      downforce: 2,
      brakeTorque: 2200,
      frontFrequency: 3.5,
      rearFrequency: 3.6,
      frontGrip: 1.55,
      rearGrip: 1.65,
      longitudinalGrip: 2.25,
      boostForce: 4800,
    },
  },
  targa: {
    id: "targa",
    name: "银隼号",
    english: "SILVER TARGA",
    description: "银色经典车身，暖棕座舱与折叠顶棚。打开车顶，让海风同行。",
    asset: "/assets/Targa_JoinFix_V2.glb",
    color: "#c8ccca",
    convertible: true,
    instrumentKind: "analog",
    exhausts: [{ node: "Hollow_exhaust_tip", radius: 0.042 }],
    brakeLamps: [
      {
        name: "rear-bar",
        nodes: Array.from({ length: 7 }, (_, i) => `Rear_lamp_lens_${i + 1}`),
        shape: "strip",
      },
    ],
    geometry: {
      halfExtents: [0.94, 0.23, 2.06],
      frontAxle: 1.175,
      rearAxle: -1.175,
      halfTrack: 0.78,
      mountY: -0.08,
      radius: 0.365,
      width: 0.25,
      modelOffset: -0.84,
      spawnHeight: 0.89,
    },
    cockpitEye: [0.18, 1.15, 0.34],
    cockpitLook: [-20, -1.2, 0.34],
    glassMaterial: "Clear cabin glazing",
    steeringWheelAxis: "x",
    visualSteerLimit: (25 * Math.PI) / 180,
    tuning: {
      mass: 1100,
      torque: 700,
      topSpeed: 205,
      finalDrive: 3.5,
      centerOfMass: 0.43,
      brakeTorque: 2100,
      frontFrequency: 2.1,
      rearFrequency: 2.3,
      frontGrip: 1.3,
      rearGrip: 1.45,
      longitudinalGrip: 1.95,
      boostForce: 5300,
    },
  },
  suv: {
    id: "suv",
    name: "山雀号",
    english: "HIGHLAND 4×4",
    description: "草绿车身，复古仪表与整体桥悬挂。带上行囊，翻过下一座山。",
    asset: "/assets/SUV_Animated.glb",
    color: "#66774c",
    exhausts: [{ node: "Exhaust_dark_opening", radius: 0.043 }],
    brakeLamps: [
      {
        name: "left",
        nodes: [
          "Rear_lens_segment001",
          "Tail_lens_molded_flute003",
          "Tail_lens_molded_flute004",
          "Tail_lens_molded_flute005",
        ],
      },
      {
        name: "right",
        nodes: [
          "Rear_lens_segment004",
          "Tail_lens_molded_flute012",
          "Tail_lens_molded_flute013",
          "Tail_lens_molded_flute014",
        ],
      },
      { name: "high-stop", nodes: ["High_mounted_stop_lamp"], running: false },
    ],
    geometry: {
      halfExtents: [1.12, 0.48, 2.06],
      frontAxle: 1.225,
      rearAxle: -1.225,
      halfTrack: 0.985,
      mountY: -0.04,
      radius: 0.45,
      width: 0.34,
      modelOffset: -0.85,
      spawnHeight: 0.9,
    },
    cockpitEye: [0.23, 1.61, 0.4],
    cockpitLook: [-10, -1.1, 0.43],
    glassMaterial: "Clear windows",
    glassMaterials: [
      "Clear windows",
      "Lightly tinted optical glass -1",
      "Lightly tinted optical glass 1",
    ],
    visualSteerLimit: 0.52,
    tuning: {
      mass: 1700,
      torque: 1000,
      topSpeed: 155,
      finalDrive: 4.2,
      frontDrive: 50,
      centerOfMass: 0.45,
      brakeTorque: 2600,
      abs: 60,
      frontFrequency: 2.1,
      rearFrequency: 2.2,
      frontGrip: 1.35,
      rearGrip: 1.5,
      longitudinalGrip: 1.95,
      boostForce: 7000,
    },
  },
};

export function vehicleModelRoot(model: Object3D) {
  return (
    model.getObjectByName("CAR_ROOT") ??
    model.getObjectByName("SUV_ROOT") ??
    model.getObjectByName("TARGA_CAR_ROOT") ??
    model
  );
}

export function vehicleFromSearch(search: string): VehicleId {
  const id = new URLSearchParams(search).get("car");
  if (isVehicleId(id)) return id;
  try {
    const saved = localStorage.getItem("cloudcape.vehicle");
    return isVehicleId(saved) ? saved : "sparrow";
  } catch {
    return "sparrow";
  }
}

function isVehicleId(id: string | null): id is VehicleId {
  return id !== null && Object.hasOwn(VEHICLES, id);
}

export function vehicleURL(href: string, id: VehicleId) {
  const url = new URL(href);
  url.searchParams.set("car", id);
  return url.href;
}
