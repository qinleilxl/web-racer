import { t } from "../i18n";
import {
  AnimationMixer,
  LoopOnce,
  type AnimationClip,
  type Object3D,
} from "three";

export type RoofStatus = "closed" | "opening" | "open" | "closing";

/** Scrub only the supplied roof clip: driving remains owned by the physics rig. */
export class ConvertibleRoof {
  private mixer: AnimationMixer;
  private action;
  progress = 0;
  targetOpen = false;
  readonly duration: number;
  constructor(
    private model: Object3D,
    clips: AnimationClip[],
  ) {
    const clip = clips.find((c) => c.name === "Roof_Open");
    if (!clip || !(clip.duration > 0))
      throw new Error(t("敞篷模型缺少有效的 Roof_Open 动画"));
    this.duration = clip.duration;
    this.mixer = new AnimationMixer(model);
    this.action = this.mixer.clipAction(clip);
    this.action.setLoop(LoopOnce, 1);
    this.action.clampWhenFinished = true;
    this.action.play();
    this.action.paused = true;
    this.apply();
  }
  get status(): RoofStatus {
    return this.targetOpen
      ? this.progress >= 1
        ? "open"
        : "opening"
      : this.progress <= 0
        ? "closed"
        : "closing";
  }
  toggle() {
    this.targetOpen = !this.targetOpen;
  }
  update(dt: number) {
    const target = this.targetOpen ? 1 : 0;
    const step = Math.max(0, Math.min(0.25, dt)) / this.duration;
    this.progress = this.targetOpen
      ? Math.min(target, this.progress + step)
      : Math.max(target, this.progress - step);
    if (Math.abs(this.progress - target) < 1e-9) this.progress = target;
    this.apply();
  }
  private apply() {
    this.action.time = this.progress * this.duration;
    this.mixer.update(0);
  }
  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
  }
}
