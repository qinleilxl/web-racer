import type { Input } from "./types";
import {
  TouchInput,
  emptyInput,
  automaticThrottle,
  touchControlsEnabled,
  type ControlMode,
  type TouchAction,
} from "./TouchInput";
export class InputManager {
  keys = new Set<string>();
  touch: Input = emptyInput();
  readonly touchPointers = new TouchInput();
  private mode: ControlMode = "auto";
  private autoThrottle = false;
  private pointerQuery = window.matchMedia("(any-pointer: coarse)");
  get touchEnabled() {
    return touchControlsEnabled(
      this.mode,
      this.pointerQuery.matches || navigator.maxTouchPoints > 0,
    );
  }
  configureControls(mode: ControlMode, autoThrottle: boolean) {
    if (this.mode !== mode || this.autoThrottle !== autoThrottle)
      this.clearTouch();
    this.mode = mode;
    this.autoThrottle = autoThrottle;
  }
  pressTouch(id: number, action: TouchAction) {
    this.touchPointers.press(id, action);
    this.touch = this.touchPointers.read();
  }
  releaseTouch(id: number) {
    this.touchPointers.release(id);
    this.touch = this.touchPointers.read();
  }
  clearTouch() {
    this.touchPointers.clear();
    this.touch = emptyInput();
  }
  constructor(private action: (key: string) => void) {
    window.addEventListener("keydown", this.down);
    window.addEventListener("keyup", this.up);
    window.addEventListener("blur", this.blur);
  }
  private down = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (
      target?.closest("input,select,textarea,button,[contenteditable=true]")
    ) {
      if (!["Escape", "F2"].includes(e.code)) return;
    }
    if (e.code === "F2") e.preventDefault();
    if (["ArrowLeft", "ArrowRight", "Space"].includes(e.code))
      e.preventDefault();
    this.keys.add(e.code);
    if (!e.repeat) this.action(e.code);
  };
  private up = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private blur = () => {
    this.clear();
    this.action("blur");
  };
  clear() {
    this.keys.clear();
    this.clearTouch();
  }
  read(): Input {
    const k = this.keys;
    return automaticThrottle(
      {
        throttle: k.has("KeyA") ? 1 : this.touch.throttle,
        brake: k.has("KeyZ") ? 1 : this.touch.brake,
        steer:
          k.has("ArrowRight") || k.has("ArrowLeft")
            ? Number(k.has("ArrowRight")) - Number(k.has("ArrowLeft"))
            : this.touch.steer,
        handbrake: k.has("Space") || this.touch.handbrake,
        boost: k.has("ShiftLeft") || k.has("ShiftRight") || this.touch.boost,
      },
      this.touchEnabled && this.autoThrottle,
    );
  }
  dispose() {
    window.removeEventListener("keydown", this.down);
    window.removeEventListener("keyup", this.up);
    window.removeEventListener("blur", this.blur);
  }
}
