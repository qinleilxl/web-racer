import type { Input } from "./types";
export class InputManager {
  keys = new Set<string>();
  touch: Input = {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    boost: false,
  };
  constructor(private action: (key: string) => void) {
    window.addEventListener("keydown", this.down);
    window.addEventListener("keyup", this.up);
    window.addEventListener("blur", this.blur);
  }
  private down = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.matches("input,select,button")) {
      if (!["Escape"].includes(e.code)) return;
    }
    if (
      [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Space",
        "Tab",
      ].includes(e.code) &&
      e.code !== "Tab"
    )
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
    this.touch = {
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: false,
      boost: false,
    };
  }
  read(): Input {
    const k = this.keys;
    return {
      throttle: k.has("KeyW") || k.has("ArrowUp") ? 1 : this.touch.throttle,
      brake: k.has("KeyS") || k.has("ArrowDown") ? 1 : this.touch.brake,
      steer:
        (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) -
          (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0) || this.touch.steer,
      handbrake: k.has("Space") || this.touch.handbrake,
      boost: k.has("ShiftLeft") || k.has("ShiftRight") || this.touch.boost,
    };
  }
  dispose() {
    window.removeEventListener("keydown", this.down);
    window.removeEventListener("keyup", this.up);
    window.removeEventListener("blur", this.blur);
  }
}
