import type { Input } from "./types";

export type ControlMode = "auto" | "touch" | "keyboard";
export type TouchAction =
  | "left"
  | "right"
  | "throttle"
  | "brake"
  | "handbrake"
  | "boost";
export const emptyInput = (): Input => ({
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  boost: false,
});

/** Each finger owns its action until release, cancellation or capture loss. */
export class TouchInput {
  private pointers = new Map<number, TouchAction>();
  press(id: number, action: TouchAction) {
    this.pointers.set(id, action);
  }
  release(id: number) {
    this.pointers.delete(id);
  }
  clear() {
    this.pointers.clear();
  }
  held() {
    return new Set(this.pointers.values());
  }
  read(): Input {
    const held = this.held();
    return {
      throttle: held.has("throttle") ? 1 : 0,
      brake: held.has("brake") ? 1 : 0,
      steer: Number(held.has("right")) - Number(held.has("left")),
      handbrake: held.has("handbrake"),
      boost: held.has("boost"),
    };
  }
}
export function touchAvailable() {
  return (
    (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) ||
    (typeof window !== "undefined" &&
      window.matchMedia?.("(any-pointer: coarse)").matches === true)
  );
}
export function touchControlsEnabled(mode: ControlMode, available: boolean) {
  return mode === "touch" || (mode === "auto" && available);
}
export function automaticThrottle(input: Input, enabled: boolean): Input {
  return {
    ...input,
    throttle: enabled && !input.brake && !input.handbrake ? 1 : input.throttle,
  };
}
