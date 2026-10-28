import type { VehicleId } from "./Vehicles";

export type CarAudioProfile = {
  name: string;
  seed: number;
  engine: {
    pulses: number;
    rpmScale: number;
    harmonics: number[];
    subRatio: number;
    subGain: number;
    cutoff: number;
    brightness: number;
    gain: number;
    roughness: number;
    roughRate: number;
  };
  exhaust: {
    ratio: number;
    harmonics: number[];
    cutoff: number;
    drive: number;
    gain: number;
    noise: number;
    popPitch: number;
    popDuration: number;
    popInterval: number;
  };
  tire: {
    band: number;
    q: number;
    tone: number;
    waveform: OscillatorType;
    noise: number;
    squeal: number;
    grain: number;
  };
  boost: {
    from: number;
    to: number;
    rise: number;
    waveform: OscillatorType;
    band: number;
    q: number;
    noise: number;
    tone: number;
  };
};

/** Separate spectra, combustion pulses, exhaust distortion and tyre textures. */
export const CAR_AUDIO: Record<VehicleId, CarAudioProfile> = {
  sparrow: {
    name: "轻快机械 · 暖调短排气 · 细胎轻啸 · 短促喷焰",
    seed: 1709,
    engine: {
      pulses: 2,
      rpmScale: 0.82,
      harmonics: [1, 0.42, 0.24, 0.08, 0.12, 0.03],
      subRatio: 0.5,
      subGain: 0.25,
      cutoff: 580,
      brightness: 1000,
      gain: 0.075,
      roughness: 0.1,
      roughRate: 8,
    },
    exhaust: {
      ratio: 0.5,
      harmonics: [1, 0.23, 0.16, 0.05],
      cutoff: 470,
      drive: 1.45,
      gain: 0.045,
      noise: 0.008,
      popPitch: 115,
      popDuration: 0.085,
      popInterval: 0.9,
    },
    tire: {
      band: 1750,
      q: 0.95,
      tone: 1090,
      waveform: "sine",
      noise: 0.1,
      squeal: 0.015,
      grain: 9,
    },
    boost: {
      from: 48,
      to: 76,
      rise: 0.5,
      waveform: "sine",
      band: 650,
      q: 0.45,
      noise: 0.19,
      tone: 0.008,
    },
  },
  scarlet: {
    name: "低沉八缸 · 沙哑双管 · 宽胎嘶鸣 · 双管喷焰轰鸣",
    seed: 4513,
    engine: {
      pulses: 4,
      rpmScale: 1,
      harmonics: [1, 0.22, 0.66, 0.13, 0.36, 0.1, 0.18, 0.05],
      subRatio: 0.5,
      subGain: 0.55,
      cutoff: 820,
      brightness: 1900,
      gain: 0.08,
      roughness: 0.19,
      roughRate: 13,
    },
    exhaust: {
      ratio: 0.5,
      harmonics: [1, 0.56, 0.14, 0.42, 0.08, 0.24],
      cutoff: 1050,
      drive: 3.6,
      gain: 0.067,
      noise: 0.018,
      popPitch: 165,
      popDuration: 0.14,
      popInterval: 0.52,
    },
    tire: {
      band: 1310,
      q: 1.45,
      tone: 1540,
      waveform: "triangle",
      noise: 0.12,
      squeal: 0.028,
      grain: 17,
    },
    boost: {
      from: 62,
      to: 98,
      rise: 0.38,
      waveform: "triangle",
      band: 900,
      q: 0.5,
      noise: 0.24,
      tone: 0.012,
    },
  },
  formula: {
    name: "高转赛车 · 清脆排气 · 光头胎锐啸 · 高转喷焰嘶吼",
    seed: 9377,
    engine: {
      pulses: 5,
      rpmScale: 1.45,
      harmonics: [0.65, 0.88, 0.35, 0.62, 0.15, 0.3, 0.08, 0.17],
      subRatio: 2,
      subGain: 0.27,
      cutoff: 1600,
      brightness: 4200,
      gain: 0.066,
      roughness: 0.035,
      roughRate: 27,
    },
    exhaust: {
      ratio: 1,
      harmonics: [0.35, 1, 0.18, 0.52, 0.11, 0.28],
      cutoff: 2700,
      drive: 2.1,
      gain: 0.041,
      noise: 0.012,
      popPitch: 330,
      popDuration: 0.055,
      popInterval: 0.31,
    },
    tire: {
      band: 2670,
      q: 2.5,
      tone: 2220,
      waveform: "sine",
      noise: 0.083,
      squeal: 0.037,
      grain: 31,
    },
    boost: {
      from: 88,
      to: 132,
      rise: 0.22,
      waveform: "sawtooth",
      band: 1350,
      q: 0.55,
      noise: 0.18,
      tone: 0.007,
    },
  },
  targa: {
    name: "温暖水平对置 · 绵密排气 · 街道胎摩擦 · 喷焰低吼",
    seed: 12143,
    engine: {
      pulses: 3,
      rpmScale: 0.94,
      harmonics: [1, 0.39, 0.48, 0.17, 0.24, 0.08, 0.13],
      subRatio: 0.5,
      subGain: 0.38,
      cutoff: 690,
      brightness: 1500,
      gain: 0.078,
      roughness: 0.14,
      roughRate: 11,
    },
    exhaust: {
      ratio: 0.5,
      harmonics: [1, 0.41, 0.28, 0.17, 0.09],
      cutoff: 780,
      drive: 2.35,
      gain: 0.057,
      noise: 0.016,
      popPitch: 138,
      popDuration: 0.11,
      popInterval: 0.67,
    },
    tire: {
      band: 1570,
      q: 1.2,
      tone: 1280,
      waveform: "triangle",
      noise: 0.105,
      squeal: 0.021,
      grain: 13,
    },
    boost: {
      from: 54,
      to: 86,
      rise: 0.44,
      waveform: "sine",
      band: 760,
      q: 0.48,
      noise: 0.215,
      tone: 0.01,
    },
  },
  suv: {
    name: "低转重机 · 厚重低频 · 粗胎摩擦 · 低频喷焰轰鸣",
    seed: 6823,
    engine: {
      pulses: 3,
      rpmScale: 0.56,
      harmonics: [1, 0.73, 0.19, 0.37, 0.12, 0.21, 0.07],
      subRatio: 0.5,
      subGain: 0.65,
      cutoff: 410,
      brightness: 760,
      gain: 0.088,
      roughness: 0.26,
      roughRate: 6,
    },
    exhaust: {
      ratio: 0.5,
      harmonics: [1, 0.67, 0.31, 0.12, 0.22],
      cutoff: 360,
      drive: 2.7,
      gain: 0.07,
      noise: 0.026,
      popPitch: 76,
      popDuration: 0.19,
      popInterval: 1.15,
    },
    tire: {
      band: 790,
      q: 0.6,
      tone: 650,
      waveform: "sawtooth",
      noise: 0.15,
      squeal: 0.011,
      grain: 6,
    },
    boost: {
      from: 32,
      to: 54,
      rise: 0.72,
      waveform: "square",
      band: 440,
      q: 0.45,
      noise: 0.26,
      tone: 0.016,
    },
  },
};

export type CarAudioState = {
  rpm: number;
  speed: number;
  throttle: number;
  braking: boolean;
  drifting: boolean;
  slipAngle: number;
  boosting: boolean;
  gear: number;
  volume: number;
  active: boolean;
  cockpit: boolean;
};
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

/** Physical RPM drives firing pulses; load changes tone independently of speed. */
export function audioTargets(p: CarAudioProfile, s: CarAudioState) {
  const rpm = clamp(s.rpm, 650, 10000),
    rev = clamp((rpm - 900) / 6100, 0, 1);
  const throttle = clamp(s.throttle, 0, 1),
    load = s.active && !s.braking ? throttle : 0;
  const skid =
    s.active && s.drifting && s.speed > 6
      ? clamp(Math.abs(s.slipAngle) * 1.3 + s.speed / 90, 0.2, 1)
      : 0;
  const cabin = s.cockpit ? 0.72 : 1;
  return {
    firingHz: (rpm / 60) * p.engine.pulses * p.engine.rpmScale,
    engineGain: s.active ? p.engine.gain * (0.4 + rev * 0.23 + load * 0.5) : 0,
    engineCutoff:
      (p.engine.cutoff + rev * p.engine.brightness + load * 550) * cabin,
    exhaustGain: s.active
      ? p.exhaust.gain * (0.2 + rev * 0.3 + load * 0.75) * cabin
      : 0,
    exhaustCutoff: p.exhaust.cutoff * (0.8 + rev * 0.55 + load * 0.8) * cabin,
    exhaustNoise: s.active
      ? p.exhaust.noise * (0.12 + rev * 0.3 + load * 0.58)
      : 0,
    tireNoise: p.tire.noise * skid * cabin,
    tireTone: p.tire.squeal * skid * cabin,
    tireHz: p.tire.tone * (0.82 + skid * 0.3 + clamp(s.speed / 160, 0, 0.25)),
    tireBand: p.tire.band * (0.88 + skid * 0.24),
    boostNoise:
      s.active && s.boosting && !s.braking ? p.boost.noise * cabin : 0,
    boostTone: s.active && s.boosting && !s.braking ? p.boost.tone * cabin : 0,
    wind: s.active
      ? Math.min(0.055, Math.max(0, s.speed) * 0.0009) * (s.cockpit ? 0.45 : 1)
      : 0,
    volume: s.active ? clamp(s.volume, 0, 1) : 0,
    load,
    rev,
  };
}

export function combustionWave(profile: number[], samples = 512) {
  const data = new Float32Array(samples);
  let peak = 0;
  for (let i = 0; i < samples; i++) {
    data[i] = profile.reduce(
      (v, a, n) => v + a * Math.sin((((n + 1) * i) / samples) * Math.PI * 2),
      0,
    );
    peak = Math.max(peak, Math.abs(data[i]));
  }
  return data.map((v) => v / Math.max(1, peak));
}
