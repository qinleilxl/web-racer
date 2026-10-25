import React, { useEffect, useRef, useState } from "react";
import { Game } from "../game/Game";
import {
  formatTime,
  loadSettings,
  type Settings,
  type Snapshot,
  type Input,
} from "../game/types";

type IconName =
  | "wind"
  | "arrow"
  | "sound"
  | "mute"
  | "settings"
  | "pause"
  | "expand"
  | "close"
  | "back"
  | "flag"
  | "car";
function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    wind: (
      <>
        <path d="M3 8h11a3 3 0 1 0-3-3M2 12h17a2.5 2.5 0 1 1-2.5 2.5M5 16h5a2.5 2.5 0 1 1-2.5 2.5" />
      </>
    ),
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    sound: (
      <>
        <path d="m11 4-6 5H2v6h3l6 5zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
      </>
    ),
    mute: (
      <>
        <path d="m11 4-6 5H2v6h3l6 5zM16 9l6 6m0-6-6 6" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="15" cy="17" r="3" />
      </>
    ),
    pause: (
      <>
        <path d="M8 5v14M16 5v14" strokeWidth="3" />
      </>
    ),
    expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    back: <path d="M20 12H4m6-6-6 6 6 6" />,
    flag: (
      <>
        <path d="M5 21V3m0 1c6-4 8 5 15 0v10c-7 5-9-4-15 0" />
      </>
    ),
    car: (
      <>
        <path d="m4 10 3-6h10l3 6M3 10h18v8H3zM6 18v3m12-3v3M6 14h2m8 0h2" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
function Bird() {
  return (
    <svg viewBox="0 0 56 40" fill="currentColor" aria-hidden="true">
      <path d="M2 11c9 0 16 3 25 12C37 10 46 7 55 6 43 15 38 20 34 26l-6 10-6-10C14 20 8 15 2 11Z" />
      <path d="m27 24 12 7-9-1z" />
    </svg>
  );
}
export default function App() {
  const host = useRef<HTMLDivElement>(null),
    game = useRef<Game | null>(null);
  const [state, setState] = useState<Snapshot | null>(null),
    [settings, setSettings] = useState(loadSettings),
    [settingsOpen, setSettingsOpen] = useState(false),
    [preview, setPreview] = useState(false),
    [engineError, setEngineError] = useState("");
  useEffect(() => {
    try {
      game.current = new Game(host.current!, settings, setState, setSettings);
    } catch (e) {
      setEngineError(e instanceof Error ? e.message : String(e));
    }
    return () => {
      game.current?.dispose();
    };
  }, []);
  const change = (s: Settings) => {
    setSettings(s);
    game.current?.setSettings(s);
  };
  const start = () => {
    (document.activeElement as HTMLElement)?.blur();
    setSettingsOpen(false);
    setPreview(false);
    void game.current?.start();
  };
  const menu = () => {
    setSettingsOpen(false);
    setPreview(false);
    game.current?.menu();
  };
  const pause = () => {
    (document.activeElement as HTMLElement)?.blur();
    game.current?.togglePause();
  };
  const phase = state?.phase || "loading";
  const active = ["racing", "countdown", "paused", "finished"].includes(phase);
  const error = engineError || state?.error;
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  };
  const showSettings = () => {
    if (phase === "racing" || phase === "countdown") game.current?.pause();
    setSettingsOpen(true);
  };
  return (
    <main className={`app phase-${phase}`}>
      <div
        className="game-viewport"
        ref={host}
        aria-label="云岬环线三维游戏画面"
      />
      <div className="film-grain" />
      {phase === "menu" && !preview && <div className="menu-shade" />}
      {phase !== "loading" && phase !== "error" && !engineError && (
        <header className="topbar">
          <button
            className="brand"
            aria-label={active ? "暂停并打开菜单" : "云岬环线主菜单"}
            onClick={() => {
              if (active) game.current?.pause();
              else menu();
            }}
          >
            <span className="bird">
              <Bird />
            </span>
            <span>
              CLOUDCAPE<span className="brand-rally">R A L L Y</span>
            </span>
          </button>
          <div className="top-actions">
            <span className="weather">
              <span className="sun-icon">☀</span> 盐风海岸 <i /> 午后 · 晴
            </span>
            <button
              className="icon-button"
              aria-label={settings.volume > 0 ? "关闭声音" : "开启声音"}
              title="声音"
              onClick={() =>
                change({ ...settings, volume: settings.volume > 0 ? 0 : 0.35 })
              }
            >
              <Icon name={settings.volume > 0 ? "sound" : "mute"} />
            </button>
            <button
              className="icon-button"
              aria-label="设置"
              onClick={showSettings}
            >
              <Icon name="settings" />
            </button>
            <button
              className="icon-button fullscreen-button"
              aria-label="切换全屏"
              onClick={fullscreen}
            >
              <Icon name="expand" />
            </button>
            {active && phase !== "finished" && (
              <button
                className="icon-button"
                aria-label={phase === "paused" ? "继续比赛" : "暂停比赛"}
                onClick={pause}
              >
                <Icon name="pause" />
              </button>
            )}
          </div>
        </header>
      )}
      {phase === "loading" && !error && (
        <section className="loading-screen">
          <div className="loading-bird">
            <Bird />
          </div>
          <p className="eyebrow">CLOUDCAPE RALLY</p>
          <h1>风正从海上吹来</h1>
          <p>正在准备小燕号与盐风海岸</p>
          <div className="load-track">
            <span style={{ width: `${state?.loaded || 3}%` }} />
          </div>
          <span className="load-percent">
            {Math.round(state?.loaded || 0)}%
          </span>
        </section>
      )}
      {error && (
        <section className="modal-scrim">
          <div className="dialog">
            <p className="eyebrow">暂时没能出发</p>
            <h2>游戏载入遇到了问题</h2>
            <p className="error-copy">{error}</p>
            <p>请使用支持 WebGL 2 的桌面浏览器，并确认硬件加速已开启。</p>
            <button className="primary" onClick={() => location.reload()}>
              重新载入 <Icon name="arrow" />
            </button>
          </div>
        </section>
      )}
      {phase === "menu" && !preview && (
        <>
          <section className="main-menu">
            <div className="edition">
              <span /> 环风竞速节 · 盐风海岸
            </div>
            <h1 className="game-title">
              云岬环线<span>CLOUDCAPE RALLY</span>
            </h1>
            <p className="tagline">追着风，去更远的地方。</p>
            <p className="intro">
              让引擎醒来，让海风带路。
              <br />
              下一段风景，就在转弯之后。
            </p>
            <button className="primary start-button" onClick={start}>
              <span>
                开始竞速<small>单人计时挑战</small>
              </span>
              <Icon name="arrow" size={24} />
            </button>
            <div className="menu-secondary">
              <button
                onClick={() => {
                  setPreview(true);
                  if (game.current) game.current.showcase = true;
                }}
              >
                <Icon name="car" /> 认识小燕号
              </button>
              <span />
              <button onClick={showSettings}>
                <Icon name="settings" /> 设置
              </button>
            </div>
            <div className="best-menu">
              <Icon name="flag" size={16} />
              <span>个人最佳</span>
              <strong>{formatTime(state?.best ?? null)}</strong>
            </div>
          </section>
          <aside className="track-postcard">
            <span className="postcard-line" />
            <p>SALTWIND COAST</p>
            <h2>
              盐风海岸 <span>01</span>
            </h2>
            <div>
              <span>海岸公路</span>
              <i />
              1.106 km
              <i />
              单圈
              <span className="difficulty">
                难度 <b /> <b className="dim" /> <b className="dim" />
              </span>
            </div>
          </aside>
          <footer className="menu-footer">
            <span className="footer-note">
              <Icon name="wind" size={16} /> 海风向前，旅程也是。
            </span>
            <div className="keyboard-hint">
              <kbd>W A S D</kbd> 驾驶 <kbd>Space</kbd> 漂移 <kbd>Shift</kbd>{" "}
              借风加速
            </div>
            <span className="version">初航试玩 · v0.6</span>
          </footer>
        </>
      )}
      {phase === "menu" && preview && (
        <section className="car-preview">
          <p className="eyebrow">SPARROW ONE · 01</p>
          <h1>小燕号</h1>
          <p>
            奶油白车身，落日红车顶。
            <br />
            一颗老派而自由的机械之心。
          </p>
          <dl>
            <div>
              <dt>驱动</dt>
              <dd>后轮驱动</dd>
            </div>
            <div>
              <dt>变速箱</dt>
              <dd>5 挡自动</dd>
            </div>
            <div>
              <dt>车重</dt>
              <dd>950 kg</dd>
            </div>
          </dl>
          <button className="primary" onClick={start}>
            驾驶小燕号 <Icon name="arrow" />
          </button>
          <button
            className="text-button"
            onClick={() => {
              setPreview(false);
              if (game.current) game.current.showcase = false;
            }}
          >
            <Icon name="back" /> 返回
          </button>
        </section>
      )}
      {active && state && (
        <>
          <section className="timing">
            <div className="lap-label">
              <span className="live-dot" /> 单人计时{" "}
              <span className="lap">
                LAP <b>01</b> / 01
              </span>
            </div>
            <div className="time-current">{formatTime(state.time)}</div>
            <div className="time-best">
              BEST <span>{formatTime(state.best)}</span>
            </div>
            <div className="race-progress">
              <span style={{ width: `${state.progress * 100}%` }} />
            </div>
            <div className="checkpoint-label">
              检查点{" "}
              <strong>
                {Math.min(state.checkpoint, 8)} <span>/ 8</span>
              </strong>
            </div>
          </section>
          <Minimap game={game.current} state={state} />
          {phase === "countdown" && (
            <div className="countdown" key={state.countdown}>
              <span>准备出发</span>
              <b>{state.countdown || "GO"}</b>
              <small>按住 W 或 ↑ 加速</small>
            </div>
          )}
          {phase === "racing" && (
            <>
              <div
                className={`notice ${state.notice ? "visible" : ""}`}
                role="status"
              >
                {state.notice}
              </div>
              {(state.offRoad || state.wrongWay || state.wallScrape > 0.2) && (
                <div className="driving-warning">
                  {state.wrongWay
                    ? "方向反了，试着调头"
                    : state.offRoad
                      ? "离开赛道 · 按 R 返回安全路段"
                      : "擦墙减速 · 反打方向离墙"}
                </div>
              )}
            </>
          )}
          <div className="hud-bottom">
            <div className="race-location">
              <span className="location-mark">↗</span>
              <div>
                <small>SALTWIND COAST</small>
                <strong>盐风海岸</strong>
                <span>
                  小燕号 · {settings.assists ? "辅助驾驶" : "自由驾驶"}
                </span>
              </div>
            </div>
            <div
              className={`wind-meter ${state.boosting ? "boosting" : ""} ${state.inWind ? "collecting" : ""}`}
            >
              <div>
                <Icon name="wind" size={19} />
                <span>
                  {state.boosting
                    ? "乘风加速"
                    : state.inWind
                      ? "正在收集海风"
                      : "风道能量"}
                </span>
                <strong>
                  {Math.round(state.energy)}
                  <small>%</small>
                </strong>
              </div>
              <div className="energy-track">
                <span style={{ width: `${state.energy}%` }} />
              </div>
              <p>
                <kbd>Shift</kbd> 按住借风加速
              </p>
            </div>
            <div className="speedometer">
              <svg viewBox="0 0 180 110" aria-hidden="true">
                <path className="speed-arc" d="M18 94a74 74 0 1 1 144 0" />
                <path
                  className="speed-arc-fill"
                  d="M18 94a74 74 0 1 1 144 0"
                  pathLength="100"
                  strokeDasharray={`${Math.min(100, (state.speed / 200) * 100)} 100`}
                />
                {Array.from({ length: 13 }, (_, i) => {
                  const angle = ((165 + i * 22.5) * Math.PI) / 180;
                  return (
                    <line
                      key={i}
                      x1={90 + Math.cos(angle) * 63}
                      y1={75 + Math.sin(angle) * 63}
                      x2={90 + Math.cos(angle) * (i % 3 === 0 ? 55 : 59)}
                      y2={75 + Math.sin(angle) * (i % 3 === 0 ? 55 : 59)}
                    />
                  );
                })}
              </svg>
              <div className="speed-readout">
                <strong>
                  {Math.round(state.speed).toString().padStart(2, "0")}
                </strong>
                <span>km/h</span>
              </div>
              <div className="gear">
                <span>GEAR</span>
                <b>
                  {state.gear < 0 ? "R" : state.gear === 0 ? "N" : state.gear}
                </b>
                <i>AUTO</i>
              </div>
            </div>
          </div>
          <div className="race-controls">
            <span>
              <kbd>W A S D</kbd> 驾驶
            </span>
            <span title="Space 起漂；点按 A/D 微调，松开方向渐渐回正，反打收角。同向长按过久可能失控。">
              <kbd>Space</kbd> {state.driftAngle > 60 ? "失控" : "漂移"}
              {state.driftAngle > 5 ? ` ${Math.round(state.driftAngle)}°` : ""}
            </span>
            <span>
              <kbd>R</kbd> 重置 +3s
            </span>
            <span>
              <kbd>C</kbd> 镜头
            </span>
            <span>
              <kbd>Esc</kbd> 暂停
            </span>
          </div>
          <TouchControls game={game.current} />
        </>
      )}
      {phase === "paused" && !settingsOpen && (
        <div className="modal-scrim">
          <section className="dialog pause-dialog">
            <div className="dialog-symbol">
              <Icon name="pause" size={28} />
            </div>
            <p className="eyebrow">TAKE A BREATH</p>
            <h2>让风等一会儿</h2>
            <p>比赛已暂停，下一段海岸仍在等你。</p>
            <button className="primary" onClick={pause}>
              继续竞速 <Icon name="arrow" />
            </button>
            <button className="secondary" onClick={showSettings}>
              驾驶设置
            </button>
            <div className="dialog-links">
              <button onClick={start}>重新出发</button>
              <button onClick={menu}>返回主菜单</button>
            </div>
          </section>
        </div>
      )}
      {phase === "finished" && state && !settingsOpen && (
        <div className="modal-scrim result-scrim">
          <section className="dialog results">
            <div className="finish-icon">
              <Icon name="flag" size={35} />
            </div>
            <p className="eyebrow">COASTLINE, CONQUERED.</p>
            <h2>
              {state.previousBest === null || state.time < state.previousBest
                ? "新的海岸纪录"
                : "又一圈，新的风景"}
            </h2>
            <p>盐风海岸 · 单圈计时完成</p>
            <div className="result-time">{formatTime(state.time)}</div>
            <div className="result-stats">
              <div>
                <span>个人最佳</span>
                <strong>{formatTime(state.best)}</strong>
              </div>
              <div>
                <span>与此前最佳</span>
                <strong
                  className={
                    state.previousBest !== null &&
                    state.time < state.previousBest
                      ? "improved"
                      : ""
                  }
                >
                  {state.previousBest === null
                    ? "首次完赛"
                    : `${state.time < state.previousBest ? "−" : "+"}${Math.abs(state.time - state.previousBest).toFixed(2)} s`}
                </strong>
              </div>
            </div>
            <button className="primary" onClick={start}>
              再追一次风 <Icon name="arrow" />
            </button>
            <button className="text-button" onClick={menu}>
              返回主菜单
            </button>
          </section>
        </div>
      )}
      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          change={change}
          close={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}
function Minimap({ game, state }: { game: Game | null; state: Snapshot }) {
  const track = game?.track;
  if (!track) return null;
  const xs = track.points.map((p) => p.x),
    zs = track.points.map((p) => p.z),
    minX = Math.min(...xs),
    minZ = Math.min(...zs),
    scale = 170 / Math.max(Math.max(...xs) - minX, Math.max(...zs) - minZ);
  const map = (x: number, z: number) => [
    25 + (x - minX) * scale,
    22 + (z - minZ) * scale,
  ];
  const points = track.points
    .filter((_, i) => i % 4 === 0)
    .map((p) => map(p.x, p.z).join(","))
    .join(" ");
  const car = map(state.x, state.z);
  const target = track.point(track.gateIndices[Math.min(7, state.checkpoint)]);
  const gate = map(target.x, target.z);
  const start = map(track.point(0).x, track.point(0).z);
  return (
    <aside className="minimap">
      <div className="map-heading">
        <span>盐风海岸</span>
        <span>N ↑</span>
      </div>
      <svg
        viewBox="0 0 220 215"
        aria-label="赛道地图，青色圆点为车辆，金色圆点为下一个检查点"
      >
        <polygon
          className="map-coast"
          points="15,195 15,13 207,13 207,140 151,157 140,185 89,201"
        />
        <polyline
          className="map-road-under"
          points={points + " " + points.split(" ")[0]}
        />
        <polyline
          className="map-road"
          points={points + " " + points.split(" ")[0]}
        />
        <rect
          x={start[0] - 3}
          y={start[1] - 3}
          width="6"
          height="6"
          fill="#49665b"
        />
        <circle cx={gate[0]} cy={gate[1]} r="4" fill="#d39154" />
        <circle className="map-car-halo" cx={car[0]} cy={car[1]} r="9" />
        <path
          className="map-car"
          d="M0 -7 4.5 5 0 3-4.5 5Z"
          transform={`translate(${car[0]} ${car[1]}) rotate(${180 - (state.heading * 180) / Math.PI})`}
        />
      </svg>
      <div className="map-caption">
        <span /> 下一个检查点 <b>{Math.round(state.progress * 100)}%</b>
      </div>
    </aside>
  );
}
function SettingsPanel({
  settings,
  change,
  close,
}: {
  settings: Settings;
  change: (s: Settings) => void;
  close: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const fn = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        e.stopImmediatePropagation();
        close();
      }
      if (e.code === "Tab") {
        const items =
          ref.current?.querySelectorAll<HTMLElement>("button,input");
        if (items?.length) {
          const first = items[0],
            last = items[items.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    window.addEventListener("keydown", fn, true);
    return () => window.removeEventListener("keydown", fn, true);
  }, []);
  return (
    <div className="modal-scrim">
      <section
        ref={ref}
        className="dialog settings"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-heading"
      >
        <button
          className="close-button icon-button"
          aria-label="关闭设置"
          onClick={close}
        >
          <Icon name="close" />
        </button>
        <p className="eyebrow">MAKE YOURSELF AT HOME</p>
        <h2 id="settings-heading">随风调校</h2>
        <p>找到适合你的驾驶节奏。</p>
        <div className="setting-row">
          <label>
            画面质量<small>阴影与渲染清晰度</small>
          </label>
          <div className="segmented">
            {(["low", "medium", "high"] as const).map((q, i) => (
              <button
                aria-pressed={settings.quality === q}
                className={settings.quality === q ? "selected" : ""}
                key={q}
                onClick={() => change({ ...settings, quality: q })}
              >
                {["低", "中", "高"][i]}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <label htmlFor="volume">
            游戏音量<small>{Math.round(settings.volume * 100)}%</small>
          </label>
          <input
            id="volume"
            aria-label="游戏音量"
            type="range"
            min="0"
            max="1"
            step=".05"
            value={settings.volume}
            onChange={(e) =>
              change({ ...settings, volume: Number(e.target.value) })
            }
          />
        </div>
        <div className="setting-row">
          <label>
            镜头距离<small>也可以按 C 切换</small>
          </label>
          <div className="segmented">
            <button
              className={settings.camera === "near" ? "selected" : ""}
              onClick={() => change({ ...settings, camera: "near" })}
            >
              近景
            </button>
            <button
              className={settings.camera === "far" ? "selected" : ""}
              onClick={() => change({ ...settings, camera: "far" })}
            >
              远景
            </button>
          </div>
        </div>
        <div className="setting-row">
          <label htmlFor="assists">
            驾驶辅助<small>平滑转向与轻度防侧滑</small>
          </label>
          <button
            id="assists"
            role="switch"
            aria-checked={settings.assists}
            className={`switch ${settings.assists ? "on" : ""}`}
            onClick={() => change({ ...settings, assists: !settings.assists })}
          >
            <span />
          </button>
        </div>
        <div className="settings-controls">
          <div>
            <kbd>W ↑</kbd> 油门
          </div>
          <div>
            <kbd>S ↓</kbd> 刹车 / 倒车
          </div>
          <div>
            <kbd>A D</kbd> 转向
          </div>
          <div>
            <kbd>Space</kbd> 手刹漂移
          </div>
          <div>
            <kbd>Shift</kbd> 风道加速
          </div>
          <div>
            <kbd>R</kbd> 安全重置 +3s
          </div>
        </div>
        <button className="primary" onClick={close}>
          调校完成 <Icon name="arrow" />
        </button>
      </section>
    </div>
  );
}
function TouchControls({ game }: { game: Game | null }) {
  const set = (key: keyof Input, value: number | boolean) => {
    if (game) game.input.touch = { ...game.input.touch, [key]: value };
  };
  const control = (
    key: keyof Input,
    value: number | boolean,
    label: string,
  ) => (
    <button
      aria-label={label}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        set(key, value);
      }}
      onPointerUp={() => set(key, typeof value === "boolean" ? false : 0)}
      onPointerCancel={() => set(key, typeof value === "boolean" ? false : 0)}
      onLostPointerCapture={() =>
        set(key, typeof value === "boolean" ? false : 0)
      }
    >
      {label}
    </button>
  );
  return (
    <div className="touch-controls">
      <div>
        {control("steer", -1, "←")}
        {control("steer", 1, "→")}
      </div>
      <div>
        {control("boost", true, "风")}
        {control("brake", 1, "刹车")}
        {control("throttle", 1, "油门")}
      </div>
    </div>
  );
}
