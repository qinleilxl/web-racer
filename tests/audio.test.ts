import { test } from "node:test";
import { primeGameAudio, releasePrimedAudio } from "../src/game/AudioUnlock";
import assert from "node:assert/strict";
import {
  CAR_AUDIO,
  audioTargets,
  combustionWave,
  type CarAudioState,
} from "../src/game/AudioProfiles";
import { VehicleVoice } from "../src/game/VehicleVoice";
import { GameAudio } from "../src/game/Audio";
import type { VehicleId } from "../src/game/Vehicles";

const state: CarAudioState = {
  rpm: 4500,
  speed: 25,
  throttle: 0.8,
  braking: false,
  drifting: false,
  slipAngle: 0,
  boosting: false,
  gear: 3,
  volume: 0.35,
  active: true,
  cockpit: false,
};

test("every vehicle has different engine/exhaust spectra, tyre texture and boost voice", () => {
  const profiles = Object.values(CAR_AUDIO);
  for (const field of ["engine", "exhaust", "tire", "boost"] as const)
    assert.equal(
      new Set(profiles.map((p) => JSON.stringify(p[field]))).size,
      profiles.length,
    );
  const distance = (a: Float32Array, b: Float32Array) =>
    Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0) / a.length);
  for (let i = 0; i < profiles.length; i++)
    for (let j = i + 1; j < profiles.length; j++) {
      assert.ok(
        distance(
          combustionWave(profiles[i].engine.harmonics),
          combustionWave(profiles[j].engine.harmonics),
        ) > 0.08,
        "engine difference is only pitch",
      );
      assert.ok(
        distance(
          combustionWave(profiles[i].exhaust.harmonics),
          combustionWave(profiles[j].exhaust.harmonics),
        ) > 0.06,
        "exhaust difference is only volume",
      );
      assert.notEqual(profiles[i].tire.band, profiles[j].tire.band);
      assert.notEqual(profiles[i].boost.band, profiles[j].boost.band);
    }
});

test("RPM, throttle load, actual slide and boost independently control each vehicle's sound", () => {
  for (const profile of Object.values(CAR_AUDIO)) {
    const idle = audioTargets(profile, {
      ...state,
      rpm: 1000,
      throttle: 0,
      speed: 0,
    });
    const loaded = audioTargets(profile, state);
    const coast = audioTargets(profile, { ...state, throttle: 0 });
    assert.ok(loaded.firingHz > idle.firingHz * 3);
    assert.ok(loaded.exhaustGain > coast.exhaustGain * 1.5);
    assert.ok(loaded.engineCutoff > coast.engineCutoff);
    assert.equal(loaded.tireNoise, 0);
    assert.equal(loaded.boostNoise, 0);
    const slide = audioTargets(profile, {
      ...state,
      drifting: true,
      slipAngle: 0.4,
    });
    assert.ok(slide.tireNoise > 0 && slide.tireTone > 0);
    assert.equal(
      audioTargets(profile, { ...state, drifting: true, speed: 2 }).tireNoise,
      0,
    );
    const boost = audioTargets(profile, { ...state, boosting: true });
    assert.ok(boost.boostNoise > 0 && boost.boostTone > 0);
    assert.equal(
      audioTargets(profile, { ...state, boosting: true, braking: true })
        .boostNoise,
      0,
    );
    assert.ok(
      audioTargets(profile, { ...state, cockpit: true }).engineCutoff <
        loaded.engineCutoff,
    );
    const paused = audioTargets(profile, {
      ...state,
      active: false,
      boosting: true,
      drifting: true,
    });
    for (const key of [
      "engineGain",
      "exhaustGain",
      "tireNoise",
      "tireTone",
      "boostNoise",
      "boostTone",
      "wind",
      "volume",
    ] as const)
      assert.equal(paused[key], 0);
  }
});

class Param {
  value = 0;
  events: { value: number; time: number }[] = [];
  setTargetAtTime(v: number, t: number, lag: number) {
    assert.ok(lag > 0);
    return this.setValueAtTime(v, t);
  }
  setValueAtTime(value: number, time: number) {
    assert.ok(Number.isFinite(value) && Number.isFinite(time) && time >= 0);
    this.value = value;
    this.events.push({ value, time });
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    return this.setValueAtTime(v, t);
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    assert.ok(v > 0);
    return this.setValueAtTime(v, t);
  }
}
class Node {
  gain = new Param();
  frequency = new Param();
  detune = new Param();
  Q = new Param();
  threshold = new Param();
  knee = new Param();
  ratio = new Param();
  attack = new Param();
  release = new Param();
  edges: unknown[] = [];
  stopped = false;
  started = false;
  disconnected = false;
  onended?: () => void;
  wave?: { real: Float32Array; imag: Float32Array };
  constructor(readonly kind: string) {}
  connect(n: unknown) {
    this.edges.push(n);
    return n;
  }
  disconnect() {
    this.edges = [];
    this.disconnected = true;
  }
  setPeriodicWave(w: { real: Float32Array; imag: Float32Array }) {
    this.wave = w;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}
function fixture() {
  const nodes: Node[] = [];
  const add = (kind: string) => {
    const n = new Node(kind);
    nodes.push(n);
    return n;
  };
  const context = {
    sampleRate: 22050,
    currentTime: 0,
    destination: add("destination"),
    createGain: () => add("gain"),
    createBiquadFilter: () => add("filter"),
    createOscillator: () => add("oscillator"),
    createBufferSource: () => add("buffer"),
    createWaveShaper: () => add("distortion"),
    createDynamicsCompressor: () => add("limiter"),
    createPeriodicWave: (real: Float32Array, imag: Float32Array) => ({
      real,
      imag,
    }),
    createBuffer: (_channels: number, frames: number) => {
      const data = new Float32Array(frames);
      return { getChannelData: () => data };
    },
  };
  return { nodes, context: context as unknown as BaseAudioContext };
}

test("hot vehicle changes reuse the unlocked audio context and stop the previous voice", async (t) => {
  const old = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
  const f = fixture();
  let created = 0,
    closed = 0;
  Object.assign(f.context, {
    state: "running",
    close: async () => {
      closed++;
    },
  });
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: function () {
      created++;
      return f.context;
    },
  });
  t.after(() => {
    if (old) Object.defineProperty(globalThis, "AudioContext", old);
    else Reflect.deleteProperty(globalThis, "AudioContext");
  });
  const audio = new GameAudio("scarlet");
  await audio.start();
  const previous = f.nodes.slice();
  audio.setVehicle("formula");
  await audio.start();
  assert.equal(audio.vehicle, "formula");
  assert.equal(
    created,
    1,
    "vehicle change created another locked audio context",
  );
  assert.ok(previous.filter((n) => n.started).every((n) => n.stopped));
  assert.ok(
    previous
      .filter((n) => n.kind !== "destination")
      .every((n) => n.disconnected),
  );
  audio.update(state);
  audio.dispose();
  audio.dispose();
  assert.equal(closed, 1);
  assert.ok(f.nodes.filter((n) => n.started).every((n) => n.stopped));
});

test("the first tap unlocks audio before the deferred game engine has loaded", async (t) => {
  const old = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
  const f = fixture();
  let created = 0, resumed = 0, closed = 0;
  Object.assign(f.context, {
    state: "running",
    resume: async () => { resumed++; },
    close: async () => { closed++; },
  });
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: function () { created++; return f.context; },
  });
  t.after(() => {
    releasePrimedAudio();
    if (old) Object.defineProperty(globalThis, "AudioContext", old);
    else Reflect.deleteProperty(globalThis, "AudioContext");
  });
  primeGameAudio();
  primeGameAudio();
  assert.equal(created, 1);
  assert.equal(resumed, 2);
  assert.equal(f.nodes.filter((n) => n.kind !== "destination").length, 0,
    "landing started the expensive audio graph");
  const audio = new GameAudio("sparrow");
  await audio.start();
  assert.equal(created, 1, "deferred engine lost the gesture-unlocked context");
  assert.ok(f.nodes.length > 0);
  audio.dispose();
  releasePrimedAudio();
  assert.equal(closed, 1);
});

test("all real audio graphs use their own spectra, schedule smooth transitions and release every node", () => {
  for (const id of Object.keys(CAR_AUDIO) as VehicleId[]) {
    const f = fixture(),
      voice = new VehicleVoice(f.context, id);
    const oscillators = f.nodes.filter((n) => n.kind === "oscillator");
    const waves = oscillators.filter((n) => n.wave);
    assert.deepEqual(
      Array.from(waves[0].wave!.imag).map((v) => +v.toFixed(3)),
      [0, ...CAR_AUDIO[id].engine.harmonics],
    );
    assert.deepEqual(
      Array.from(waves[1].wave!.imag).map((v) => +v.toFixed(3)),
      [0, ...CAR_AUDIO[id].exhaust.harmonics],
    );
    voice.update({ ...state, rpm: 1000, throttle: 0, gear: 1 }, 0);
    const before = f.nodes.length;
    for (let i = 1; i <= 120; i++) voice.update(state, i / 60);
    // One load/gear transition may pop once; steady driving creates no new graph.
    const afterLoad = f.nodes.length;
    for (let i = 121; i <= 240; i++) voice.update(state, i / 60);
    assert.equal(f.nodes.length, afterLoad);
    assert.ok(afterLoad <= before + 4);
    voice.update({ ...state, boosting: true }, 4.1);
    voice.update({ ...state, drifting: true, slipAngle: 0.3 }, 4.3);
    voice.update({ ...state, throttle: 0 }, 4.5);
    voice.update({ ...state, active: false }, 4.8);
    const master = f.nodes.find(
      (n) => n.kind === "gain" && n.edges.includes(f.context.destination),
    )!;
    assert.equal(master.gain.value, 0);
    voice.dispose();
    voice.dispose();
    assert.ok(f.nodes.filter((n) => n.started).every((n) => n.stopped));
    assert.ok(
      f.nodes
        .filter((n) => n.kind !== "destination")
        .every((n) => n.disconnected),
    );
  }
});
