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
  camera: "near" | "far";
  assists: boolean;
};
export type Input = {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  boost: boolean;
};
export type Snapshot = {
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
};
export function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem("cloudcape.settings") || "{}");
    return {
      quality: ["low", "medium", "high"].includes(s.quality)
        ? s.quality
        : "high",
      volume:
        typeof s.volume === "number" && Number.isFinite(s.volume)
          ? Math.max(0, Math.min(1, s.volume))
          : 0.35,
      camera: s.camera === "near" ? "near" : "far",
      assists: s.assists !== false,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
export function loadBest(): number | null {
  try {
    const b = Number(localStorage.getItem("cloudcape.best"));
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
