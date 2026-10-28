import type { PhysicsTelemetry, PhysicsTuning } from "./Tuning";
import type { CameraMode } from "./CameraViews";
import type { MapId } from "./MapMode";
import { touchAvailable, type ControlMode } from "./TouchInput";
import type { VehicleId } from "./Vehicles";
import type { RoofStatus } from "./ConvertibleRoof";
export type Phase =
  | "loading"
  | "menu"
  | "countdown"
  | "racing"
  | "paused"
  | "finished"
  | "error";
export type Settings = {
  quality: "low" | "medium" | "high";
  volume: number;
  camera: CameraMode;
  assists: boolean;
  controls: ControlMode;
  autoThrottle: boolean;
};
export type Input = {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  boost: boolean;
};
export type Snapshot = {
  roof?: { progress: number; targetOpen: boolean; status: RoofStatus };
  mapId: MapId;
  vehicleId: VehicleId;
  vehicleLoading?: VehicleId | null;
  vehicleLoadProgress?: number;
  vehicleSwitchError?: string;
  debugOpen: boolean;
  tuning: PhysicsTuning;
  telemetry: PhysicsTelemetry | null;
  customSetup: boolean;
  tuningBusy: boolean;
  phase: Phase;
  loaded: number;
  error: string;
  speed: number;
  gear: number;
  rpm: number;
  time: number;
  best: number | null;
  previousBest: number | null;
  checkpoint: number;
  totalCheckpoints: number;
  progress: number;
  energy: number;
  boosting: boolean;
  inWind: boolean;
  wallScrape: number;
  driftAngle: number;
  countdown: number;
  notice: string;
  offRoad: boolean;
  wrongWay: boolean;
  fps: number;
  x: number;
  z: number;
  heading: number;
};
export const DEFAULT_SETTINGS: Settings = {
  quality: "high",
  volume: 0.35,
  camera: "far",
  assists: true,
  controls: "auto",
  autoThrottle: false,
};
export function loadSettings(): Settings {
  const defaultQuality = touchAvailable() ? "medium" : "high";
  try {
    const s = JSON.parse(localStorage.getItem("cloudcape.settings") || "{}");
    return {
      quality: ["low", "medium", "high"].includes(s.quality)
        ? s.quality
        : defaultQuality,
      volume:
        typeof s.volume === "number" && Number.isFinite(s.volume)
          ? Math.max(0, Math.min(1, s.volume))
          : 0.35,
      camera:
        s.camera === "cockpit"
          ? "cockpit"
          : s.camera === "near"
            ? "near"
            : "far",
      assists: s.assists !== false,
      controls: ["auto", "touch", "keyboard"].includes(s.controls)
        ? s.controls
        : "auto",
      autoThrottle: s.autoThrottle === true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS, quality: defaultQuality };
  }
}
// Wider racing lines have their own record; keep the original 8m record saved.
export const BEST_STORAGE_KEY = "cloudcape.best.coast12.v1";
export function bestStorageKey(id: VehicleId = "sparrow") {
  return id === "sparrow" ? BEST_STORAGE_KEY : `${BEST_STORAGE_KEY}.${id}`;
}
export function loadBest(id: VehicleId = "sparrow"): number | null {
  try {
    const b = Number(localStorage.getItem(bestStorageKey(id)));
    return b > 0 && Number.isFinite(b) ? b : null;
  } catch {
    return null;
  }
}
export function formatTime(t: number | null): string {
  if (t === null) return "— — : — —";
  const ms = Math.floor(t * 1000);
  return `${Math.floor(ms / 60000)
    .toString()
    .padStart(2, "0")}:${Math.floor((ms / 1000) % 60)
    .toString()
    .padStart(2, "0")}.${Math.floor((ms % 1000) / 10)
    .toString()
    .padStart(2, "0")}`;
}
