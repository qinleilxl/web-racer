import { useEffect, useState } from "react";
import type { Game } from "../game/Game";
import type { Settings } from "../game/types";
import { touchAvailable, type TouchAction } from "../game/TouchInput";

export function useTouchCapability() {
  const [available, setAvailable] = useState(touchAvailable);
  useEffect(() => {
    const query = window.matchMedia("(any-pointer: coarse)");
    const update = () => setAvailable(touchAvailable());
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return available;
}
function ControlIcon({ action }: { action: TouchAction | "camera" | "reset" }) {
  const paths = {
    left: <path d="m15 5-7 7 7 7M8 12h12" />,
    right: <path d="m9 5 7 7-7 7M4 12h12" />,
    throttle: (
      <>
        <rect
          x="8"
          y="3"
          width="10"
          height="18"
          rx="3"
          transform="rotate(12 13 12)"
        />
        <path d="m11 8 3-2 2 3m-6 3 5 1m-6 3 5 1" />
      </>
    ),
    brake: (
      <>
        <rect x="4" y="6" width="16" height="12" rx="3" />
        <path d="M8 9v6m4-6v6m4-6v6M8 21h8" />
      </>
    ),
    handbrake: (
      <>
        <circle cx="12" cy="12" r="7" />
        <path d="M3 6a11 11 0 0 0 0 12M21 6a11 11 0 0 1 0 12M10 16V8h3a2.5 2.5 0 0 1 0 5h-3" />
      </>
    ),
    boost: (
      <>
        <path d="M3 8h11a3 3 0 1 0-3-3M2 12h17a2.5 2.5 0 1 1-2.5 2.5M5 16h5a2.5 2.5 0 1 1-2.5 2.5" />
      </>
    ),
    camera: (
      <>
        <path d="m3 8 4 0 2-3h6l2 3h4v12H3z" />
        <circle cx="12" cy="13" r="4" />
      </>
    ),
    reset: <path d="M4 9a8 8 0 1 1 0 6M4 3v6h6" />,
  };
  return (
    <svg
      width="27"
      height="27"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[action]}
    </svg>
  );
}
const labels: Record<TouchAction, string> = {
  left: "左转",
  right: "右转",
  throttle: "油门",
  brake: "刹车 / 倒车",
  handbrake: "手刹 / 漂移",
  boost: "借风加速",
};
export function TouchControls({
  game,
  settings,
  training,
}: {
  game: Game | null;
  settings: Settings;
  training: boolean;
}) {
  const [held, setHeld] = useState<Set<TouchAction>>(() => new Set());
  const refresh = () => setHeld(game?.input.touchPointers.held() ?? new Set());
  useEffect(() => {
    game?.input.clearTouch();
    setHeld(new Set());
    return () => game?.input.clearTouch();
  }, [game, settings.autoThrottle, settings.controls]);
  const release = (id: number) => {
    game?.input.releaseTouch(id);
    refresh();
  };
  const control = (action: TouchAction, caption: string) => (
    <button
      key={action}
      type="button"
      className={`touch-key touch-${action}${held.has(action) ? " held" : ""}`}
      data-control={action}
      aria-label={labels[action]}
      aria-pressed={held.has(action)}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0 && e.pointerType === "mouse") return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        void game?.audio.start().catch(() => {});
        game?.input.pressTouch(e.pointerId, action);
        refresh();
      }}
      onPointerUp={(e) => release(e.pointerId)}
      onPointerCancel={(e) => release(e.pointerId)}
      onLostPointerCapture={(e) => release(e.pointerId)}
    >
      <ControlIcon action={action} />
      <span>{caption}</span>
    </button>
  );
  return (
    <div
      className={`touch-controls${settings.autoThrottle ? " automatic" : ""}`}
      aria-label="触屏驾驶控制"
    >
      <div className="touch-direction">
        <div className="touch-tools">
          <button
            type="button"
            aria-label="切换驾驶视角"
            onClick={() => {
              game?.cycleCamera();
              (document.activeElement as HTMLElement)?.blur();
            }}
          >
            <ControlIcon action="camera" />
          </button>
          <button
            type="button"
            aria-label={
              training ? "回到试车起点" : "返回安全检查点，计时加三秒"
            }
            onClick={() => {
              game?.input.clearTouch();
              setHeld(new Set());
              game?.reset();
              (document.activeElement as HTMLElement)?.blur();
            }}
          >
            <ControlIcon action="reset" />
          </button>
        </div>
        <div className="touch-steering" role="group" aria-label="方向控制">
          {control("left", "左")}
          {control("right", "右")}
        </div>
      </div>
      <div className="touch-pedal-group">
        {settings.autoThrottle && (
          <div className="auto-throttle-badge">
            <i />
            自动油门
          </div>
        )}
        <div className="touch-pedals" role="group" aria-label="踏板控制">
          {control("handbrake", "手刹")}
          {control("boost", "加速")}
          {control("brake", "刹车")}
          {!settings.autoThrottle && control("throttle", "油门")}
        </div>
      </div>
    </div>
  );
}
