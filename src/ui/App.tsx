import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { TouchControls, useTouchCapability } from "./TouchControls";
import { touchControlsEnabled } from "../game/TouchInput";
import type { Game } from "../game/Game";
import { CAMERA_LABELS, CAMERA_MODES } from "../game/CameraModes";
import { VEHICLES, vehicleFromSearch, vehicleURL, type VehicleId } from "../game/Vehicles";
import { mapFromSearch, mapURL } from "../game/MapMode";
import type { Showroom } from "../game/Showroom";
import { primeGameAudio, releasePrimedAudio } from "../game/AudioUnlock";
import {
  formatTime,
  loadSettings,
  loadBest,
  type Settings,
  type Snapshot,
} from "../game/types";

const DebugPanel = lazy(() => import("./DebugPanel").then((m) => ({ default: m.DebugPanel })));

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
  | "car"
  | "camera"
  | "reset"
  | "help"
  | "check"
  | "light"
  | "roof";
function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    wind: (
      <path d="M3 8h11a3 3 0 1 0-3-3M2 12h17a2.5 2.5 0 1 1-2.5 2.5M5 16h5a2.5 2.5 0 1 1-2.5 2.5" />
    ),
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    sound: (
      <path d="m11 4-6 5H2v6h3l6 5zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
    ),
    mute: <path d="m11 4-6 5H2v6h3l6 5zM16 9l6 6m0-6-6 6" />,
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="15" cy="17" r="3" />
      </>
    ),
    pause: <path d="M8 5v14M16 5v14" strokeWidth="2.5" />,
    expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    back: <path d="M20 12H4m6-6-6 6 6 6" />,
    flag: <path d="M5 21V3m0 1c6-4 8 5 15 0v10c-7 5-9-4-15 0" />,
    car: <path d="m4 10 3-6h10l3 6M3 10h18v8H3zM6 18v3m12-3v3M6 14h2m8 0h2" />,
    camera: (
      <>
        <path d="M3 8h4l2-3h6l2 3h4v12H3z" />
        <circle cx="12" cy="13" r="4" />
      </>
    ),
    reset: <path d="M4 9a8 8 0 1 1 0 6M4 3v6h6" />,
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 8.5a2.7 2.7 0 1 1 4 2.3c-1.5.8-1.5 1.4-1.5 2.7M12 17h.01" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    light: <path d="M13 5a7 7 0 0 1 0 14V5ZM3 7h6M2 12h7M3 17h6" />,
    roof: (
      <path d="m3 16 2-5h14l2 5v3H3v-3ZM7 11l2-5h6l2 5M7 19v2m10-2v2M10 3h8m-2-2 2 2-2 2" />
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
type SettingsTab = "driving" | "display" | "vehicles" | "controls";
const VEHICLE_CLASSES: Record<VehicleId, string> = {
  sparrow: "复古竞速",
  scarlet: "性能跑车",
  formula: "开放座舱",
  targa: "机械敞篷",
  suv: "全地形",
};
const timeLabel = (time: number | null) =>
  time === null ? "暂无纪录" : formatTime(time);

export default function App() {
  const host = useRef<HTMLDivElement>(null),
    game = useRef<Game | null>(null);
  const showroomHost = useRef<HTMLDivElement>(null), showroom = useRef<Showroom | null>(null);
  const [state, setState] = useState<Snapshot | null>(null);
  const [settings, setSettings] = useState(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("driving");
  const [garage, setGarage] = useState(false);
  const [engineError, setEngineError] = useState("");
  const [initialSelection] = useState(() => {
    const vehicle = vehicleFromSearch(location.search), map = mapFromSearch(location.search);
    const cleanURL = vehicleURL(mapURL(location.href, map), vehicle);
    if (cleanURL !== location.href) history.replaceState(history.state, "", cleanURL);
    return {vehicle, map};
  });
  const [initialVehicle, setInitialVehicle] = useState(initialSelection.vehicle);
  const [initialMap] = useState(initialSelection.map);
  const [engineRequested, setEngineRequested] = useState(initialMap === "test");
  const [launchRequested, setLaunchRequested] = useState(initialMap === "test");
  const [previewRoof, setPreviewRoof] = useState<Snapshot["roof"]>();
  const previewRoofRef = useRef<Snapshot["roof"]>(undefined);
  const pendingStart = useRef(false), garageRef = useRef(false), settingsRef = useRef(settings);
  settingsRef.current = settings;
  const engineReady = !!state && state.phase !== "loading" && state.phase !== "error";
  const roof = engineReady ? state?.roof : previewRoof;
  const touchMode = touchControlsEnabled(
    settings.controls,
    useTouchCapability(),
  );
  const secretClicks = useRef({ count: 0, last: 0 });
  const secretEntry = () => {
    const now = Date.now();
    secretClicks.current.count =
      now - secretClicks.current.last < 1800
        ? secretClicks.current.count + 1
        : 1;
    secretClicks.current.last = now;
    if (secretClicks.current.count >= 5) {
      secretClicks.current.count = 0;
      location.assign(mapURL(location.href, "test"));
    }
  };
  useEffect(() => {
    if (initialMap === "test" || engineReady) return;
    let cancelled = false;
    const prepareRace = () => { if (!cancelled) setEngineRequested(true); };
    // Paint the complete interface first, then the real 3D vehicle. Only after
    // the preview is visible do race assets begin their silent background load.
    void import("../game/Showroom").then(async ({ Showroom }) => {
      if (cancelled) return;
      const preview = new Showroom(showroomHost.current!, settingsRef.current.quality, (value) => {
        if (!cancelled) { previewRoofRef.current = value; setPreviewRoof(value); }
      });
      showroom.current = preview;
      await preview.load(initialVehicle);
      prepareRace();
    }).catch((e: unknown) => {
      if (!cancelled) { console.warn("Vehicle preview unavailable", e); prepareRace(); }
    });
    return () => { cancelled = true; showroom.current?.dispose(); showroom.current = null; };
  }, [initialVehicle, initialMap, engineReady]);
  useEffect(() => {
    if (!engineRequested) return;
    let cancelled = false;
    // The interface stays usable while the circuit and simulator prepare.
    void import("../game/Game").then(({ Game }) => {
      if (cancelled) return;
      game.current = new Game(host.current!, settingsRef.current, (next) => {
        if (cancelled) return;
        setState(next);
        if (next.phase === "menu" && pendingStart.current) {
          pendingStart.current = false;
          void game.current?.start().then(() => {
            if (!cancelled) setLaunchRequested(false);
          });
        }
      }, setSettings, () => previewRoofRef.current);
      game.current.showcase = garageRef.current;
    }).catch((e: unknown) => {
      if (!cancelled) setEngineError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
      game.current?.dispose();
      game.current = null;
    };
  }, [engineRequested]);
  useEffect(() => {
    if (state?.debugOpen) setSettingsOpen(false);
  }, [state?.debugOpen]);
  useEffect(() => releasePrimedAudio, []);
  const error = launchRequested ? (engineError || state?.error) : undefined;
  const loading = !state || state.phase === "loading" || state.phase === "error";
  const phase = error ? "error" : loading ? (launchRequested ? "loading" : "menu")
    : launchRequested && state.phase === "menu" ? "loading" : state.phase;
  const training = (state?.mapId ?? initialMap) === "test";
  const vehicle = VEHICLES[state?.vehicleId ?? initialVehicle];
  const best = state?.best ?? loadBest(vehicle.id);
  const active = ["racing", "countdown", "paused", "finished"].includes(phase);
  const busy = !!state?.vehicleLoading || !!state?.tuningBusy;
  const change = (s: Settings) => {
    setSettings(s);
    try { localStorage.setItem("cloudcape.settings", JSON.stringify(s)); } catch { /* Private storage. */ }
    game.current?.setSettings(s);
  };
  const start = () => {
    (document.activeElement as HTMLElement)?.blur();
    if (game.current) void game.current.audio.start().catch(() => {});
    else primeGameAudio();
    setSettingsOpen(false);
    setGarage(false);
    garageRef.current = false;
    if (engineReady) void game.current?.start();
    else {
      pendingStart.current = true;
      setLaunchRequested(true);
      setEngineRequested(true);
    }
  };
  const menu = () => {
    setSettingsOpen(false);
    setGarage(false);
    garageRef.current = false;
    pendingStart.current = false;
    setLaunchRequested(false);
    game.current?.menu();
  };
  const pause = () => {
    (document.activeElement as HTMLElement)?.blur();
    game.current?.togglePause();
  };
  const showGarage = (open: boolean) => {
    setGarage(open);
    garageRef.current = open;
    if (open) setEngineRequested(true);
    if (game.current) game.current.showcase = open;
  };
  const selectVehicle = (id: VehicleId) => {
    if (!engineRequested) {
      setInitialVehicle(id);
      history.replaceState(history.state, "", vehicleURL(location.href, id));
      try { localStorage.setItem("cloudcape.vehicle", id); } catch { /* Private storage. */ }
    } else if (engineReady) void game.current?.selectVehicle(id);
  };
  const showSettings = (tab: SettingsTab = "driving") => {
    game.current?.pause();
    game.current?.input.clear();
    game.current?.setDebugOpen(false);
    setSettingsTab(tab);
    setSettingsOpen(true);
  };
  const fullscreen = () => {
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };
  useEffect(() => {
    if (!garage || settingsOpen) return;
    const exit = (event: KeyboardEvent) => {
      if (event.code === "Escape") {
        event.stopImmediatePropagation();
        event.preventDefault();
        showGarage(false);
      }
    };
    window.addEventListener("keydown", exit, true);
    return () => window.removeEventListener("keydown", exit, true);
  }, [garage, settingsOpen]);
  useEffect(() => {
    if (engineRequested) return;
    const key = (event: KeyboardEvent) => {
      if (settingsOpen || (event.target instanceof Element && event.target.closest("button,input,select,textarea"))) return;
      if (event.code === "Enter") { event.preventDefault(); start(); }
      if (event.code === "F2") { event.preventDefault(); location.assign(mapURL(location.href, "test")); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [engineRequested, settingsOpen]);
  const selection = {
    selected: vehicle.id,
    change: selectVehicle,
    loading: state?.vehicleLoading,
    progress: state?.vehicleLoadProgress,
    error: state?.vehicleSwitchError,
    disabled: engineRequested && !engineReady,
  };
  const modal =
    settingsOpen || phase === "paused" || phase === "finished" || !!error;
  return (
    <main
      className={`app phase-${phase} camera-${settings.camera}${engineReady ? " engine-ready" : ""}${touchMode ? " input-touch" : ""}${training ? " map-test" : ""}${garage ? " garage-open" : ""}${state?.debugOpen ? " debug-open" : ""}`}
    >
      <div className="showroom-viewport" ref={showroomHost} aria-label="车辆三维展示" />
      <div
        className="game-viewport"
        ref={host}
        aria-label="云岬环线三维游戏画面"
      />
      <div className="film-grain" />
      {phase === "menu" && (
        <div className={`menu-shade${garage ? " garage-shade" : ""}`} />
      )}
      <div
        className="interface-layer"
        inert={modal && !state?.debugOpen ? true : undefined}
      >
        {phase !== "loading" && phase !== "error" && !error && (
          <header className="topbar">
            <button
              className="brand"
              aria-label={active ? "暂停比赛" : "云岬环线主菜单"}
              onClick={() => {
                if (active) game.current?.pause();
                else {
                  showGarage(false);
                  menu();
                }
              }}
            >
              <span className="bird">
                <Bird />
              </span>
              <span>
                CLOUDCAPE<span className="brand-rally">RALLY</span>
              </span>
            </button>
            {garage && (
              <span className="header-section">
                车库{" "}
                <span>
                  / {String(Object.keys(VEHICLES).length).padStart(2, "0")}
                </span>
              </span>
            )}
            <div className="top-actions">
              {vehicle.convertible && roof && (
                <button
                  className={`roof-toggle${roof.status === "opening" || roof.status === "closing" ? " moving" : ""}`}
                  aria-label={`${roof.targetOpen ? "关闭" : "开启"}敞篷 O`}
                  aria-pressed={roof.targetOpen}
                  title="敞篷开合 · O"
                  onClick={(e) => {
                    if (engineReady) game.current?.toggleRoof();
                    else showroom.current?.toggleRoof();
                    e.currentTarget.blur();
                  }}
                >
                  <Icon name="roof" />
                  <span>
                    {roof.status === "opening"
                      ? `开顶 ${Math.round(roof.progress * 100)}%`
                      : roof.status === "closing"
                        ? `关顶 ${Math.round((1 - roof.progress) * 100)}%`
                        : roof.status === "open"
                          ? "敞篷"
                          : "开顶"}
                  </span>
                </button>
              )}
              {training && (
                <button
                  className="icon-button debug-trigger"
                  aria-label="调试菜单 F2"
                  aria-expanded={state?.debugOpen ?? false}
                  title="调试 · F2"
                  onClick={() => {
                    (document.activeElement as HTMLElement)?.blur();
                    setSettingsOpen(false);
                    game.current?.setDebugOpen(!state?.debugOpen);
                  }}
                >
                  <Icon name="settings" size={16} />
                </button>
              )}
              {(active || garage) && (
                <button
                  className="icon-button headlights-button"
                  aria-label="切换车灯 H"
                  title="车灯 · H"
                  onClick={(e) => {
                    game.current?.toggleHeadlights();
                    e.currentTarget.blur();
                  }}
                >
                  <Icon name="light" />
                </button>
              )}
              <button
                className="icon-button sound-button"
                aria-label={settings.volume > 0 ? "关闭声音" : "开启声音"}
                title="声音"
                onClick={() =>
                  change({
                    ...settings,
                    volume: settings.volume > 0 ? 0 : 0.35,
                  })
                }
              >
                <Icon name={settings.volume > 0 ? "sound" : "mute"} />
              </button>
              <button
                className="icon-button"
                aria-label="设置"
                title="设置"
                onClick={() => showSettings()}
              >
                <Icon name="settings" />
              </button>
              <button
                className="icon-button fullscreen-button"
                aria-label="切换全屏"
                title="全屏"
                onClick={fullscreen}
              >
                <Icon name="expand" />
              </button>
              {active && phase !== "finished" && (
                <button
                  className="icon-button pause-button"
                  aria-label={
                    phase === "paused"
                      ? training
                        ? "继续试车"
                        : "继续比赛"
                      : training
                        ? "暂停试车"
                        : "暂停比赛"
                  }
                  title="暂停 · Esc"
                  onClick={pause}
                >
                  <Icon name="pause" />
                </button>
              )}
            </div>
          </header>
        )}
        {phase === "menu" && !garage && (
          <div className="menu-layout">
            <section className="main-menu" aria-labelledby="game-title">
              <div className="menu-heading">
                <p className="edition">环风竞速节</p>
                <h1 className="game-title" id="game-title">
                  云岬环线
                </h1>
                <p className="tagline">追着风，去更远的地方。</p>
              </div>
              <div className="menu-entry">
                <button
                  className="primary start-button"
                  onClick={start}
                  disabled={busy}
                >
                  <span>
                    {training ? "开始试车" : "开始竞速"}
                    <small>
                      {training ? "海风试车场" : "盐风海岸 · 计时挑战"}
                    </small>
                  </span>
                  <Icon name="arrow" size={24} />
                </button>
                <button
                  className="garage-entry"
                  onClick={() => showGarage(true)}
                  aria-label={`更换车辆，当前${vehicle.name}`}
                >
                  <i style={{ background: vehicle.color }} />
                  <span>
                    <small>当前车辆</small>
                    <strong>{vehicle.name}</strong>
                  </span>
                  <span className="garage-entry-label">
                    车库 <Icon name="arrow" size={16} />
                  </span>
                </button>
                {best != null && (
                  <div className="best-menu">
                    <Icon name="flag" size={15} />
                    <span>个人最佳</span>
                    <strong>{formatTime(best)}</strong>
                  </div>
                )}
              </div>
            </section>
            <RouteCard game={game.current} training={training} />
            <footer className="menu-footer">
              <button
                className="copyright"
                aria-label="云岬环线"
                onClick={secretEntry}
              >
                © CLOUDCAPE RALLY
              </button>
              <button
                className="help-entry"
                onClick={() => showSettings("controls")}
              >
                <Icon name="help" size={16} /> 操作指南
              </button>
            </footer>
          </div>
        )}
        {phase === "menu" && garage && (
          <section className="garage" aria-labelledby="garage-heading">
            <button className="back-link" onClick={() => showGarage(false)}>
              <Icon name="back" size={17} /> 返回
            </button>
            <div className="garage-info">
              <p className="eyebrow">{vehicle.english}</p>
              <h1 id="garage-heading">{vehicle.name}</h1>
              <span className="vehicle-class">
                {VEHICLE_CLASSES[vehicle.id]}
              </span>
            </div>
            {engineRequested && !engineReady && (
              <div className="stage-loading" role="status">
                正在载入车辆 <span>{Math.round(state?.loaded ?? 0)}%</span>
              </div>
            )}
            <VehiclePicker {...selection} />
            <dl className="vehicle-specs">
              <div>
                <dt>极速</dt>
                <dd>
                  {state?.tuning.topSpeed ?? 180}
                  <small> km/h</small>
                </dd>
              </div>
              <div>
                <dt>车重</dt>
                <dd>
                  {state?.tuning.mass ?? 950}
                  <small> kg</small>
                </dd>
              </div>
              <div>
                <dt>驱动</dt>
                <dd className="drive-type">
                  {(state?.tuning.frontDrive ?? 0) === 0
                    ? "后轮"
                    : state?.tuning.frontDrive === 100
                      ? "前轮"
                      : "四轮"}
                </dd>
              </div>
            </dl>
            <button className="primary" onClick={start} disabled={busy || !engineReady}>
              驾驶{vehicle.name} <Icon name="arrow" />
            </button>
          </section>
        )}
        {active && state && (
          <>
            <RaceHud game={game.current} state={state} training={training} />
            {phase === "countdown" && !training && (
              <div className="countdown" key={state.countdown}>
                <span>准备出发</span>
                <b>{state.countdown || "GO"}</b>
              </div>
            )}
            {phase === "racing" && (
              <>
                <div
                  className={`notice${state.notice ? " visible" : ""}`}
                  role="status"
                >
                  {state.notice}
                </div>
                {(state.offRoad ||
                  state.wrongWay ||
                  state.wallScrape > 0.2) && (
                  <div className="driving-warning" role="status">
                    {state.wrongWay
                      ? "逆向行驶"
                      : state.offRoad
                        ? "驶离赛道"
                        : "擦墙减速"}
                    {state.offRoad && (
                      <button onClick={() => game.current?.reset()}>
                        返回赛道 <Icon name="reset" size={14} />
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
            <nav className="race-controls" aria-label="驾驶快捷操作">
              <button
                className="camera-cycle"
                onClick={(e) => {
                  game.current?.cycleCamera();
                  e.currentTarget.blur();
                }}
                aria-label={`切换视角，当前${CAMERA_LABELS[settings.camera]}`}
              >
                <Icon name="camera" size={17} />
                {CAMERA_LABELS[settings.camera]}
                <kbd>C</kbd>
              </button>
              <button
                onClick={(e) => {
                  game.current?.reset();
                  e.currentTarget.blur();
                }}
                title={training ? "回到起点 · R" : "返回检查点 · R，计时 +3 秒"}
              >
                <Icon name="reset" size={16} />
                复位<kbd>R</kbd>
              </button>
              <button onClick={() => showSettings("controls")}>
                <Icon name="help" size={16} />
                操作
              </button>
            </nav>
            {touchMode && (phase === "racing" || phase === "countdown") && (
              <TouchControls
                game={game.current}
                settings={settings}
                training={training}
              />
            )}
          </>
        )}
      </div>
      {phase === "loading" && !error && (
        <LoadingScreen loaded={state?.loaded ?? 0} />
      )}
      {error && <ErrorDialog error={error} />}
      {phase === "paused" && !settingsOpen && !state?.debugOpen && (
        <Modal
          labelledBy="pause-heading"
          className="pause-dialog"
          close={pause}
        >
          <div className="dialog-symbol">
            <Icon name="pause" size={28} />
          </div>
          <p className="eyebrow">
            {training ? "自由试车" : "盐风海岸 · 计时挑战"}
          </p>
          <h2 id="pause-heading">已暂停</h2>
          <div className="pause-session">
            <span>{vehicle.name}</span>
            {!training && <strong>{formatTime(state?.time ?? 0)}</strong>}
          </div>
          <button className="primary" onClick={pause} disabled={busy}>
            {training ? "继续试车" : "继续竞速"} <Icon name="arrow" />
          </button>
          <button
            className="secondary"
            onClick={() => showSettings("vehicles")}
          >
            <Icon name="car" size={17} />
            更换车辆
          </button>
          <button className="secondary" onClick={() => showSettings()}>
            <Icon name="settings" size={17} />
            设置
          </button>
          <div className="dialog-links">
            <button onClick={start} disabled={busy}>
              重新开始
            </button>
            <button onClick={menu} disabled={busy}>
              返回主菜单
            </button>
          </div>
        </Modal>
      )}
      {phase === "finished" && state && !settingsOpen && !state.debugOpen && (
        <Results
          state={state}
          vehicleName={vehicle.name}
          start={start}
          menu={menu}
        />
      )}
      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          training={training}
          initialTab={settingsTab}
          switching={selection}
          change={change}
          close={() => setSettingsOpen(false)}
        />
      )}
      {training && state && phase !== "loading" && phase !== "error" && (
        <Suspense fallback={null}><DebugPanel
          state={state}
          close={() => game.current?.setDebugOpen(false)}
          pause={pause}
          apply={async (tuning) => {
            await game.current?.applyTuning(tuning);
          }}
        /></Suspense>
      )}
    </main>
  );
}

type Selection = {
  selected: VehicleId;
  change: (id: VehicleId) => void;
  loading?: VehicleId | null;
  progress?: number;
  error?: string;
  disabled?: boolean;
};
function VehiclePicker({
  selected,
  change,
  loading,
  progress,
  error,
  disabled,
}: Selection) {
  const buttons = useRef<Partial<Record<VehicleId, HTMLButtonElement | null>>>(
    {},
  );
  useEffect(() => {
    buttons.current[loading ?? selected]?.scrollIntoView({
      block: "nearest",
      inline: "center",
      behavior: "auto",
    });
  }, [selected, loading]);
  return (
    <div className="vehicle-selection">
      <div className="vehicle-picker" role="group" aria-label="选择车辆">
        {Object.values(VEHICLES).map((vehicle) => (
          <button
            key={vehicle.id}
            ref={(node) => {
              buttons.current[vehicle.id] = node;
            }}
            aria-label={`选择${vehicle.name}`}
            aria-pressed={selected === vehicle.id}
            aria-busy={loading === vehicle.id}
            disabled={disabled}
            className={`${selected === vehicle.id ? "selected" : ""}${loading === vehicle.id ? " pending" : ""}`}
            onClick={() => change(vehicle.id)}
          >
            <i style={{ background: vehicle.color }} aria-hidden="true" />
            <span>
              <strong>{vehicle.name}</strong>
              <small>{vehicle.english}</small>
            </span>
            <span className="vehicle-check">
              {loading === vehicle.id ? (
                `${Math.round(progress ?? 0)}%`
              ) : selected === vehicle.id ? (
                <Icon name="check" size={17} />
              ) : null}
            </span>
          </button>
        ))}
      </div>
      {error && (
        <p className="vehicle-switch-error" role="alert">
          {error}
        </p>
      )}
      <span className="sr-only" role="status">
        {loading
          ? `正在载入${VEHICLES[loading].name}，${Math.round(progress ?? 0)}%`
          : ""}
      </span>
    </div>
  );
}
function routeShape(game: Game | null, size = 170) {
  const points = game?.track?.points;
  if (!points?.length) return null;
  const xs = points.map((p) => p.x),
    zs = points.map((p) => p.z),
    minX = Math.min(...xs),
    minZ = Math.min(...zs);
  const scale = size / Math.max(Math.max(...xs) - minX, Math.max(...zs) - minZ);
  const map = (x: number, z: number) => [
    25 + (x - minX) * scale,
    22 + (z - minZ) * scale,
  ];
  const line = points
    .filter((_, i) => i % 4 === 0)
    .map((p) => map(p.x, p.z).join(","))
    .join(" ");
  return { map, line: line + " " + line.split(" ")[0] };
}
function RouteCard({
  game,
  training,
}: {
  game: Game | null;
  training: boolean;
}) {
  const shape = routeShape(game);
  return (
    <aside className="route-card" aria-label="当前赛道">
      {shape && !training && (
        <svg viewBox="0 0 220 215" aria-hidden="true">
          <polyline points={shape.line} />
        </svg>
      )}
      <div>
        <p>{training ? "FREE PRACTICE" : "SALTWIND COAST"}</p>
        <h2>{training ? "海风试车场" : "盐风海岸"}</h2>
        <span>
          {training ? "1,200 × 1,200 m" : "1.106 km"}
          <i />
          {training ? "自由驾驶" : "单圈计时"}
        </span>
      </div>
    </aside>
  );
}
function Minimap({ game, state }: { game: Game | null; state: Snapshot }) {
  const track = game?.track,
    shape = routeShape(game);
  if (!track || !shape) return null;
  const car = shape.map(state.x, state.z),
    target = track.point(track.gateIndices[Math.min(7, state.checkpoint)]),
    gate = shape.map(target.x, target.z);
  return (
    <aside className="minimap" aria-label="赛道地图">
      <div className="map-heading">
        <span>盐风海岸</span>
        <span>N ↑</span>
      </div>
      <svg viewBox="0 0 220 215" aria-label="车辆位置与下一个检查点">
        <polyline className="map-road-under" points={shape.line} />
        <polyline className="map-road" points={shape.line} />
        <circle cx={gate[0]} cy={gate[1]} r="4" className="map-gate" />
        <circle className="map-car-halo" cx={car[0]} cy={car[1]} r="10" />
        <path
          className="map-car"
          d="M0 -7 4.5 5 0 3-4.5 5Z"
          transform={`translate(${car[0]} ${car[1]}) rotate(${180 - (state.heading * 180) / Math.PI})`}
        />
      </svg>
    </aside>
  );
}
function RaceHud({
  game,
  state,
  training,
}: {
  game: Game | null;
  state: Snapshot;
  training: boolean;
}) {
  return (
    <>
      <div className="race-instruments">
      <section
        className={`timing${training ? " test-session" : ""}`}
        aria-label={training ? "自由试驾" : "比赛计时"}
      >
        <div className="lap-label">
          {training ? "自由试车" : "计时挑战"}
          <span>{training ? "海风试车场" : "LAP 01 / 01"}</span>
        </div>
        {!training && (
          <>
            <div className="time-current">{formatTime(state.time)}</div>
            <div className="time-best">
              <span>最佳</span>
              <strong>{timeLabel(state.best)}</strong>
            </div>
            <div className="race-progress" aria-hidden="true">
              <span style={{ width: `${state.progress * 100}%` }} />
            </div>
            <div className="checkpoint-label">
              检查点
              <strong>
                {Math.min(state.checkpoint, state.totalCheckpoints)}
                <span> / {state.totalCheckpoints}</span>
              </strong>
            </div>
            {state.customSetup && <div className="debug-lap-label">调校圈</div>}
          </>
        )}
      </section>
      {!training && <Minimap game={game} state={state} />}
      <div className="hud-bottom">
        <div
          className={`wind-meter${state.boosting ? " boosting" : ""}${state.inWind ? " collecting" : ""}`}
        >
          <div>
            <Icon name="wind" size={18} />
            <span>
              {state.boosting ? "乘风加速" : state.inWind ? "收集风能" : "风能"}
            </span>
            <strong>
              {Math.round(state.energy)}
              <small>%</small>
            </strong>
          </div>
          <div className="energy-track">
            <span style={{ width: `${state.energy}%` }} />
          </div>
        </div>
        <div className="speedometer">
          <svg viewBox="0 0 180 110" aria-hidden="true">
            <path className="speed-arc" d="M18 94a74 74 0 1 1 144 0" />
            <path
              className="speed-arc-fill"
              d="M18 94a74 74 0 1 1 144 0"
              pathLength="100"
              strokeDasharray={`${Math.min(100, (state.speed / 240) * 100)} 100`}
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
            <b>{state.gear < 0 ? "R" : state.gear === 0 ? "N" : state.gear}</b>
            <i>AUTO</i>
          </div>
        </div>
      </div>
      </div>
      {state.driftAngle > 8 && phaseDriving(state) && (
        <div
          className={`drift-indicator${state.driftAngle > 60 ? " spin" : ""}`}
        >
          {state.driftAngle > 60 ? "失控" : "漂移"}
          <strong>
            {Math.round(state.driftAngle)}
            <small>°</small>
          </strong>
        </div>
      )}
    </>
  );
}
function phaseDriving(state: Snapshot) {
  return state.phase === "racing";
}

function Modal({
  children,
  labelledBy,
  className = "",
  close,
}: {
  children: React.ReactNode;
  labelledBy: string;
  className?: string;
  close?: () => void;
}) {
  const ref = useRef<HTMLElement>(null),
    closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.code === "Escape") {
        event.stopImmediatePropagation();
        event.preventDefault();
        closeRef.current?.();
      }
      if (event.code === "Tab") {
        const items = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select,summary,[tabindex="0"]',
          ) ?? [],
        ).filter(
          (node) => node.getClientRects().length > 0 && node.tabIndex >= 0,
        );
        const first = items[0],
          last = items[items.length - 1];
        if (!first) {
          event.preventDefault();
          return;
        }
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === ref.current)
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className="modal-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) closeRef.current?.();
      }}
    >
      <section
        ref={ref}
        className={`dialog ${className}`}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onKeyDown={(event) => event.stopPropagation()}
        onKeyUp={(event) => event.stopPropagation()}
      >
        {children}
      </section>
    </div>
  );
}
export function Results({
  state,
  vehicleName,
  start,
  menu,
}: {
  state: Snapshot;
  vehicleName: string;
  start: () => void;
  menu: () => void;
}) {
  const record =
    !state.customSetup &&
    (state.previousBest === null || state.time < state.previousBest);
  return (
    <Modal labelledBy="result-heading" className="results" close={menu}>
      <div className={`finish-icon${record ? " new-record" : ""}`}>
        <Icon name="flag" size={32} />
      </div>
      <p className="eyebrow">盐风海岸 · {vehicleName}</p>
      <h2 id="result-heading">
        {state.customSetup ? "调校圈完成" : record ? "新纪录" : "完赛"}
      </h2>
      <div className="result-time">{formatTime(state.time)}</div>
      <div className="result-stats">
        <div>
          <span>个人最佳</span>
          <strong>{timeLabel(state.best)}</strong>
        </div>
        <div>
          <span>成绩差值</span>
          <strong className={record ? "improved" : ""}>
            {state.previousBest === null
              ? "首次完赛"
              : `${state.time < state.previousBest ? "−" : "+"}${Math.abs(state.time - state.previousBest).toFixed(2)} s`}
          </strong>
        </div>
      </div>
      {state.customSetup && <p className="result-note">调校圈不计入个人最佳</p>}
      <button className="primary" onClick={start}>
        再跑一圈 <Icon name="arrow" />
      </button>
      <button className="text-button" onClick={menu}>
        返回主菜单
      </button>
    </Modal>
  );
}
function SettingsPanel({
  settings,
  training,
  initialTab,
  switching,
  change,
  close,
}: {
  settings: Settings;
  training: boolean;
  initialTab: SettingsTab;
  switching: Selection;
  change: (s: Settings) => void;
  close: () => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const tabs: [SettingsTab, string][] = [
    ["driving", "驾驶"],
    ["display", "画面与声音"],
    ["vehicles", "车辆"],
    ["controls", "操作指南"],
  ];
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <Modal labelledBy="settings-heading" className="settings" close={close}>
      <header className="dialog-header">
        <div>
          <p className="eyebrow">CLOUDCAPE RALLY</p>
          <h2 id="settings-heading">设置</h2>
        </div>
        <button
          className="close-button icon-button"
          aria-label="关闭设置"
          onClick={close}
        >
          <Icon name="close" />
        </button>
      </header>
      <nav className="settings-tabs" role="tablist" aria-label="设置分类">
        {tabs.map(([id, label], index) => (
          <button
            key={id}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            role="tab"
            id={`tab-${id}`}
            aria-controls={`panel-${id}`}
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
              else if (event.key === "ArrowLeft")
                next = (index + tabs.length - 1) % tabs.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = tabs.length - 1;
              else return;
              event.preventDefault();
              setTab(tabs[next][0]);
              tabRefs.current[next]?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <div
        className="settings-body"
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
      >
        {tab === "driving" && (
          <>
            <SettingRow label="驾驶视角">
              <div className="segmented" role="group" aria-label="驾驶视角">
                {CAMERA_MODES.map((mode) => (
                  <button
                    key={mode}
                    aria-pressed={settings.camera === mode}
                    className={settings.camera === mode ? "selected" : ""}
                    onClick={() => change({ ...settings, camera: mode })}
                  >
                    {mode === "far"
                      ? "远景"
                      : mode === "near"
                        ? "近景"
                        : "车内"}
                  </button>
                ))}
              </div>
            </SettingRow>
            <SettingRow label="驾驶辅助" htmlFor="assists">
              <Toggle
                id="assists"
                checked={settings.assists}
                change={() =>
                  change({ ...settings, assists: !settings.assists })
                }
              />
            </SettingRow>
            <SettingRow label="操作方式">
              <div className="segmented" role="group" aria-label="操作方式">
                {(["auto", "touch", "keyboard"] as const).map((mode, index) => (
                  <button
                    key={mode}
                    aria-pressed={settings.controls === mode}
                    className={settings.controls === mode ? "selected" : ""}
                    onClick={() => change({ ...settings, controls: mode })}
                  >
                    {["自动", "触屏", "键盘"][index]}
                  </button>
                ))}
              </div>
            </SettingRow>
            <SettingRow label="触屏自动油门" htmlFor="auto-throttle">
              <Toggle
                id="auto-throttle"
                checked={settings.autoThrottle}
                change={() =>
                  change({ ...settings, autoThrottle: !settings.autoThrottle })
                }
              />
            </SettingRow>
          </>
        )}
        {tab === "display" && (
          <>
            <SettingRow label="画面质量">
              <div className="segmented" role="group" aria-label="画面质量">
                {(["low", "medium", "high"] as const).map((quality, index) => (
                  <button
                    key={quality}
                    aria-pressed={settings.quality === quality}
                    className={settings.quality === quality ? "selected" : ""}
                    onClick={() => change({ ...settings, quality })}
                  >
                    {["流畅", "均衡", "精细"][index]}
                  </button>
                ))}
              </div>
            </SettingRow>
            <SettingRow label="游戏音量" htmlFor="volume">
              <div className="volume-control">
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
                <output htmlFor="volume">
                  {Math.round(settings.volume * 100)}%
                </output>
              </div>
            </SettingRow>
          </>
        )}
        {tab === "vehicles" && (
          <>
            <VehiclePicker {...switching} />
            <p className="settings-note">换车后回到起点</p>
          </>
        )}
        {tab === "controls" && <ControlsGuide training={training} />}
      </div>
      <footer className="settings-footer">
        <span>即时生效</span>
        <button className="primary" onClick={close}>
          完成 <Icon name="check" size={18} />
        </button>
      </footer>
    </Modal>
  );
}
function SettingRow({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="setting-row">
      {htmlFor ? (
        <label htmlFor={htmlFor}>{label}</label>
      ) : (
        <span>{label}</span>
      )}
      {children}
    </div>
  );
}
function Toggle({
  id,
  checked,
  change,
}: {
  id: string;
  checked: boolean;
  change: () => void;
}) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      className={`switch${checked ? " on" : ""}`}
      onClick={change}
    >
      <span />
    </button>
  );
}
function ControlsGuide({ training }: { training: boolean }) {
  const controls = [
    ["A", "油门"],
    ["Z", "刹车 / 倒车"],
    ["←  →", "转向"],
    ["Space", "手刹 / 漂移"],
    ["Shift", "风能加速"],
    ["C", "切换视角"],
    ["H", "车灯"],
    ["O", "敞篷开合"],
    ["R", training ? "回到起点" : "返回检查点 +3s"],
    ["Esc", "暂停"],
  ];
  return (
    <>
      <div className="controls-guide">
        {controls.map(([key, label]) => (
          <div key={key}>
            <span>{label}</span>
            <kbd>{key}</kbd>
          </div>
        ))}
      </div>
      <div className="touch-guide">
        <Icon name="car" size={21} />
        <p>
          触屏：左侧转向，右侧控制踏板。
          <br />
          自动油门可在驾驶设置中开启。
        </p>
      </div>
    </>
  );
}

export function LoadingScreen({ loaded }: { loaded: number }) {
  return (
    <section className="loading-screen" aria-label="正在载入游戏">
      <div className="loading-brand">
        <span className="loading-bird">
          <Bird />
        </span>
        <span>CLOUDCAPE RALLY</span>
      </div>
      <div className="loading-content">
        <h1>云岬环线</h1>
        <div className="loading-status">
          <span>正在载入</span>
          <strong>
            {Math.round(loaded)}
            <small>%</small>
          </strong>
        </div>
        <div
          className="load-track"
          role="progressbar"
          aria-label="游戏载入进度"
          aria-valuenow={Math.round(loaded)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${loaded}%` }} />
        </div>
      </div>
    </section>
  );
}

export function ErrorDialog({ error }: { error: string }) {
  return (
    <Modal labelledBy="error-heading" className="error-dialog">
      <div className="dialog-symbol">
        <Icon name="reset" size={30} />
      </div>
      <h2 id="error-heading">暂时无法出发</h2>
      <p className="dialog-caption">请重新载入游戏后再试。</p>
      <button className="primary" onClick={() => location.reload()}>
        重新载入 <Icon name="arrow" />
      </button>
      <details className="error-details">
        <summary>查看详情</summary>
        <p>{error}</p>
        <p>请确认浏览器支持 WebGL 2 并已开启硬件加速。</p>
      </details>
    </Modal>
  );
}
