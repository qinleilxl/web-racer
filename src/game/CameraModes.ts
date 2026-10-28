export const CAMERA_MODES = ["far", "near", "cockpit"] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];
export const CAMERA_LABELS: Record<CameraMode, string> = {
  far: "远景追尾",
  near: "近景追尾",
  cockpit: "车内驾驶位",
};
