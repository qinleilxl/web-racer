import { t } from "../i18n";
import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../game/types";
import {
  vehicleDefaults,
  TUNING_GROUPS,
  TUNING_PRESETS,
  TUNING_SCHEMA,
  parseTuning,
  sanitizeTuning,
  serializeTuning,
  tuningPreset,
  type PhysicsTuning,
  type TuningKey,
} from "../game/Tuning";
import "./debug.css";
import { VEHICLES } from "../game/Vehicles";

const tuningKeys = Object.keys(TUNING_SCHEMA) as TuningKey[];
const wheelNames = ["左前", "右前", "左后", "右后"];
const percent = (value: number) => Math.round(value * 100);
const displayNumber = (value: number) => Number(value.toFixed(3)).toString();

function Parameter({
  name,
  value,
  disabled,
  change,
}: {
  name: TuningKey;
  value: number;
  disabled: boolean;
  change: (value: number) => void;
}) {
  const field = TUNING_SCHEMA[name];
  const [text, setText] = useState(displayNumber(value));
  useEffect(() => setText(displayNumber(value)), [value]);
  const commit = () => {
    const parsed = Number(text);
    if (text.trim() && Number.isFinite(parsed)) {
      const bounded = Math.max(field.min, Math.min(field.max, parsed));
      change(bounded);
      setText(displayNumber(bounded));
    } else setText(displayNumber(value));
  };
  return (
    <div className="debug-parameter">
      <div className="debug-parameter-heading">
        <label htmlFor={`tuning-${name}`}>{t(field.label)}</label>
        <div className="debug-number-wrap">
          <input
            id={`tuning-${name}`}
            type="number"
            min={field.min}
            max={field.max}
            step={field.step}
            value={text}
            disabled={disabled}
            onChange={(event) => {
              setText(event.target.value);
              const next = event.target.valueAsNumber;
              if (
                Number.isFinite(next) &&
                next >= field.min &&
                next <= field.max
              )
                change(next);
            }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          <span>{field.unit || "—"}</span>
        </div>
      </div>
      <input
        className="debug-range"
        aria-label={t("{0}滑杆", { 0: t(field.label) })}
        type="range"
        min={field.min}
        max={field.max}
        step={field.step}
        value={value}
        disabled={disabled}
        onChange={(event) => change(event.target.valueAsNumber)}
      />
      <div className="debug-range-scale" aria-hidden="true">
        <span>{field.min}</span>
        <span>{t("默认")} {field.value}</span>
        <span>{field.max}</span>
      </div>
    </div>
  );
}

export function DebugPanel({
  state,
  close,
  apply,
  pause,
}: {
  state: Snapshot;
  close: () => void;
  apply: (tuning: PhysicsTuning) => Promise<void>;
  pause: () => void;
}) {
  const [tab, setTab] = useState<"setup" | "telemetry">("setup");
  const [group, setGroup] = useState<string>(TUNING_GROUPS[0]);
  const [draft, setDraft] = useState<PhysicsTuning>(() => ({
    ...state.tuning,
  }));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [localBusy, setLocalBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // The panel stays mounted when closed, so an uncommitted setup survives F2.
  const appliedSignature = JSON.stringify(state.tuning);
  useEffect(() => {
    setDraft({ ...state.tuning });
  }, [appliedSignature, state.vehicleId]);
  const changed = tuningKeys.filter((key) => draft[key] !== state.tuning[key]);
  const busy = localBusy || state.tuningBusy;
  const preset =
    Object.keys(TUNING_PRESETS).find((key) => {
      const values = tuningPreset(key, state.vehicleId);
      return tuningKeys.every((name) => draft[name] === values[name]);
    }) ?? "custom";
  const setValue = (name: TuningKey, value: number) => {
    setDraft((current) => ({ ...current, [name]: value }));
    setMessage("");
    setError("");
  };
  const applyDraft = async () => {
    if (busy || !changed.length) return;
    setLocalBusy(true);
    setError("");
    setMessage("");
    try {
      await apply(sanitizeTuning(draft));
      setMessage(t("参数已应用。车辆已重置，可继续试车。"));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("参数未能应用，请重试。"),
      );
    } finally {
      setLocalBusy(false);
    }
  };
  const exportDraft = () => {
    const url = URL.createObjectURL(
      new Blob([serializeTuning(draft)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `cloudcape-${state.vehicleId}-setup.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(t("已导出当前草稿。"));
    setError("");
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    setError("");
    setMessage("");
    try {
      if (file.size > 64 * 1024) throw new Error(t("调校文件应小于 64 KB。"));
      setDraft(parseTuning(await file.text()));
      setMessage(t("已导入草稿，点击应用后生效。"));
      setTab("setup");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("无法读取调校 JSON。"));
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  if (state.mapId !== "test" || !state.debugOpen) return null;
  const telemetry = state.telemetry;
  const driving = ["racing", "countdown", "paused"].includes(state.phase);
  return (
    <aside
      className="debug-panel"
      aria-label={t("车辆与赛道调试")}
      onWheel={(event) => event.stopPropagation()}
    >
      <header className="debug-header">
        <div>
          <span className="debug-eyebrow">
            {VEHICLES[state.vehicleId].english} · ENGINEERING
          </span>
          <h2>{t("试车工作台")}</h2>
        </div>
        <button
          className="debug-close"
          aria-label={t("关闭调试菜单")}
          title={t("关闭 · F2 / Esc")}
          onClick={close}
        >
          ×
        </button>
      </header>
      <div className="debug-session">
        <span
          className={
            state.phase === "racing" ? "debug-status live" : "debug-status"
          }
        >
          <i />{" "}
          {state.phase === "paused"
            ? t("已暂停")
            : state.phase === "racing"
              ? t("试车中")
              : state.phase === "countdown"
                ? t("准备起步")
                : t("车库")}
        </span>
        <span>{state.customSetup ? t("自定义调校") : t("标准调校")}</span>
        {driving && (
          <button disabled={busy} onClick={pause}>
            {state.phase === "paused" ? t("继续试车") : t("暂停试车")}
          </button>
        )}
      </div>
      <div className="debug-tabs" role="tablist" aria-label={t("调试视图")}>
        <button
          id="debug-tab-setup"
          role="tab"
          aria-selected={tab === "setup"}
          aria-controls="debug-setup"
          onClick={(event) => {
            setTab("setup");
            event.currentTarget.blur();
          }}
        >
          {t("调校参数")}{changed.length > 0 && <b>{changed.length}</b>}
        </button>
        <button
          id="debug-tab-telemetry"
          role="tab"
          aria-selected={tab === "telemetry"}
          aria-controls="debug-telemetry"
          onClick={(event) => {
            setTab("telemetry");
            event.currentTarget.blur();
          }}
        >
          {t("实时遥测")}{" "}
          <span className="debug-tab-fps">{Math.round(state.fps)} FPS</span>
        </button>
      </div>
      <div className="debug-scroll">
        {tab === "setup" ? (
          <section
            id="debug-setup"
            role="tabpanel"
            aria-labelledby="debug-tab-setup"
          >
            <div className="debug-preset-row">
              <label htmlFor="debug-preset">{t("调校预设")}</label>
              <select
                id="debug-preset"
                value={preset}
                disabled={busy}
                onChange={(event) => {
                  setDraft(tuningPreset(event.target.value, state.vehicleId));
                  setMessage(t("预设已载入草稿，点击应用后生效。"));
                  setError("");
                }}
              >
                {preset === "custom" && (
                  <option value="custom" disabled>
                    {t("自定义调校")}</option>
                )}
                {Object.entries(TUNING_PRESETS).map(([key, value]) => (
                  <option key={key} value={key}>
                    {key === "balanced"
                      ? t("{0} · 标准", { 0: t(VEHICLES[state.vehicleId].name) })
                      : t(value.label)}
                  </option>
                ))}
              </select>
            </div>
            <nav className="debug-groups" aria-label={t("参数分组")}>
              {TUNING_GROUPS.map((value) => (
                <button
                  key={value}
                  aria-pressed={group === value}
                  onClick={() => setGroup(value)}
                >
                  {t(value)}
                </button>
              ))}
            </nav>
            <div className="debug-parameters" aria-label={t(group)}>
              {tuningKeys
                .filter((name) => TUNING_SCHEMA[name].group === group)
                .map((name) => (
                  <Parameter
                    key={name}
                    name={name}
                    value={draft[name]}
                    disabled={busy}
                    change={(value) => setValue(name, value)}
                  />
                ))}
            </div>
            <div className="debug-file-actions">
              <button
                disabled={busy}
                onClick={() => {
                  setDraft(vehicleDefaults(state.vehicleId));
                  setMessage(t("默认参数已载入草稿，点击应用后生效。"));
                  setError("");
                }}
              >
                {t("恢复默认")}</button>
              <button
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                {t("导入 JSON")}</button>
              <button disabled={busy} onClick={exportDraft}>
                {t("导出草稿")}</button>
              <input
                ref={fileInput}
                className="debug-file-input"
                type="file"
                accept=".json,application/json"
                aria-label={t("导入调校 JSON 文件")}
                onChange={(event) => void importFile(event.target.files?.[0])}
              />
            </div>
          </section>
        ) : (
          <section
            id="debug-telemetry"
            role="tabpanel"
            aria-labelledby="debug-tab-telemetry"
          >
            <div className="debug-live-readouts">
              <div>
                <span>{t("车速")}</span>
                <strong>
                  {state.speed.toFixed(0)}
                  <small>km/h</small>
                </strong>
                <small>{(state.speed / 3.6).toFixed(2)} {t("m/s · 物理速度")}</small>
              </div>
              <div>
                <span>{t("发动机")}</span>
                <strong>
                  {Math.round(state.rpm)}
                  <small>rpm</small>
                </strong>
              </div>
              <div>
                <span>{t("车身滑角")}</span>
                <strong>
                  {(telemetry?.slipAngle ?? 0).toFixed(1)}
                  <small>°</small>
                </strong>
              </div>
              <div>
                <span>{t("偏航角速度")}</span>
                <strong>
                  {(telemetry?.yawRate ?? 0).toFixed(1)}
                  <small>°/s</small>
                </strong>
              </div>
            </div>
            <div className="debug-g-readouts">
              <span>
                {t("纵向")}<b>{(telemetry?.longitudinalG ?? 0).toFixed(2)} G</b>
              </span>
              <span>
                {t("横向")}<b>{(telemetry?.lateralG ?? 0).toFixed(2)} G</b>
              </span>
              <span>
                {t("挡位")}{" "}
                <b>
                  {state.gear < 0 ? "R" : state.gear === 0 ? "N" : state.gear}
                </b>
              </span>
            </div>
            <div className="debug-section-heading">
              <h3>{t("四轮接地")}</h3>
              <span>{t("轮胎抓地使用率")}</span>
            </div>
            <div className="debug-wheels">
              {wheelNames.map((name, index) => {
                const wheel = telemetry?.wheels[index];
                const usage = Math.max(0, Math.min(2, wheel?.gripUsage ?? 0));
                return (
                  <div
                    key={name}
                    className={`debug-wheel ${wheel?.grounded ? "grounded" : "airborne"}`}
                  >
                    <div className="debug-wheel-title">
                      <b>{t(name)}</b>
                      <span>{wheel?.grounded ? t("接地") : t("离地")}</span>
                    </div>
                    <strong>
                      {Math.round(wheel?.load ?? 0)}
                      <small>N</small>
                    </strong>
                    <div
                      className="debug-usage"
                      role="meter"
                      aria-label={t("{0}抓地使用率", { 0: t(name) })}
                      aria-valuemin={0}
                      aria-valuemax={200}
                      aria-valuenow={Math.round(usage * 100)}
                    >
                      <span style={{ width: `${Math.min(1, usage) * 100}%` }} />
                    </div>
                    <div className="debug-wheel-pair">
                      <span>{t("抓地使用")}</span>
                      <b>{Math.round(usage * 100)}%</b>
                    </div>
                    <div className="debug-wheel-pair">
                      <span>{t("纵向滑移")}</span>
                      <b>{percent(wheel?.slipRatio ?? 0)}%</b>
                    </div>
                    <div className="debug-wheel-pair">
                      <span>{t("侧偏角")}</span>
                      <b>{(wheel?.slipAngle ?? 0).toFixed(1)}°</b>
                    </div>
                    <div className="debug-wheel-pair">
                      <span>{t("悬挂长度")}</span>
                      <b>{Math.round((wheel?.suspension ?? 0) * 1000)} mm</b>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="debug-section-heading">
              <h3>{t("辅助与接触")}</h3>
              <span>{t("当前作用量")}</span>
            </div>
            <dl className="debug-detail-list">
              <div>
                <dt>{t("牵引力控制 TCS")}</dt>
                <dd>{percent(telemetry?.tcs ?? 0)}%</dd>
              </div>
              <div>
                <dt>{t("防抱死辅助 ABS")}</dt>
                <dd>{percent(telemetry?.abs ?? 0)}%</dd>
              </div>
              <div>
                <dt>{t("后轴抓地恢复")}</dt>
                <dd>{percent(telemetry?.rearGrip ?? 1)}%</dd>
              </div>
              <div>
                <dt>{t("护墙接触")}</dt>
                <dd>{telemetry?.wallContact ? t("接触中") : t("无接触")}</dd>
              </div>
              <div>
                <dt>{t("撞击接近速度")}</dt>
                <dd>{(telemetry?.impactSpeed ?? 0).toFixed(1)} m/s</dd>
              </div>
              <div>
                <dt>{t("持续擦墙")}</dt>
                <dd>{percent(state.wallScrape)}%</dd>
              </div>
            </dl>
            <p className="debug-explainer">
              {t("接近 100% 表示轮胎正在用尽当前抓地预算。观察前后轴的负载、滑移与车身滑角，再调整参数。")}</p>
          </section>
        )}
      </div>
      <footer className="debug-footer">
        {error && (
          <p className="debug-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="debug-message" role="status">
            {message}
          </p>
        )}
        <div className="debug-apply-status">
          <span className={changed.length ? "pending" : ""}>
            {changed.length ? t("{0} 项修改尚未应用", { 0: changed.length }) : t("参数已同步")}
          </span>
          <span>{t("仅保存在本机")}</span>
        </div>
        <button
          className="debug-apply"
          disabled={busy || !changed.length}
          onClick={() => void applyDraft()}
        >
          {busy ? t("正在重建车辆…") : t("应用并重置车辆")}
          <span aria-hidden="true">↗</span>
        </button>
        <p className="debug-explainer">
          {t("应用时暂停并将车辆重置到试车场起点。关闭面板后仍保持暂停。")}</p>
      </footer>
    </aside>
  );
}
