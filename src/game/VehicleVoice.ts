import { CAR_AUDIO, audioTargets, type CarAudioState } from "./AudioProfiles";
import type { VehicleId } from "./Vehicles";

/** A reusable car-specific graph, also renderable by OfflineAudioContext. */
export class VehicleVoice {
  readonly profile;
  readonly mix: GainNode;
  readonly layers: Record<
    "engine" | "exhaust" | "tire" | "boost" | "wind",
    GainNode
  >;
  private nodes: AudioNode[] = [];
  private sources = new Set<AudioScheduledSourceNode>();
  private master: GainNode;
  private engine: OscillatorNode;
  private sub: OscillatorNode;
  private exhaust: OscillatorNode;
  private tireTone: OscillatorNode;
  private boostTone: OscillatorNode;
  private rough: OscillatorNode;
  private engineGain: GainNode;
  private engineFilter: BiquadFilterNode;
  private exhaustGain: GainNode;
  private exhaustFilter: BiquadFilterNode;
  private exhaustNoise: GainNode;
  private tireGain: GainNode;
  private tireToneGain: GainNode;
  private tireFilter: BiquadFilterNode;
  private tireMod: GainNode;
  private boostGain: GainNode;
  private boostToneGain: GainNode;
  private boostCrackle: GainNode;
  private boostFlutter: GainNode;
  private roughGain: GainNode;
  private wind: GainNode;
  private noiseBuffer: AudioBuffer;
  private previousThrottle = 0;
  private previousGear = 0;
  private wasBoosting = false;
  private boostStarted = 0;
  private cutUntil = 0;
  private lastPop = -10;
  private disposed = false;

  constructor(
    readonly context: BaseAudioContext,
    vehicle: VehicleId,
    destination: AudioNode = context.destination,
  ) {
    this.profile = CAR_AUDIO[vehicle];
    const p = this.profile,
      ctx = context;
    const own = <T extends AudioNode>(n: T) => {
      this.nodes.push(n);
      return n;
    };
    const gain = (value = 0) => {
      const n = own(ctx.createGain());
      n.gain.value = value;
      return n;
    };
    const filter = (type: BiquadFilterType, frequency: number, q = 0.7) => {
      const n = own(ctx.createBiquadFilter());
      n.type = type;
      n.frequency.value = frequency;
      n.Q.value = q;
      return n;
    };
    const oscillator = (type: OscillatorType, frequency: number) => {
      const n = own(ctx.createOscillator());
      n.type = type;
      n.frequency.value = frequency;
      this.sources.add(n);
      n.start();
      return n;
    };
    const periodic = (partials: number[]) => {
      const n = oscillator("sine", 40);
      n.setPeriodicWave(
        ctx.createPeriodicWave(
          new Float32Array(partials.length + 1),
          new Float32Array([0, ...partials]),
        ),
      );
      return n;
    };
    this.mix = gain(1);
    this.master = gain(0);
    const limiter = own(ctx.createDynamicsCompressor());
    limiter.threshold.value = -16;
    limiter.knee.value = 12;
    limiter.ratio.value = 3;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.15;
    this.mix.connect(limiter);
    limiter.connect(this.master);
    this.master.connect(destination);
    this.layers = {
      engine: gain(1),
      exhaust: gain(1),
      tire: gain(1),
      boost: gain(1),
      wind: gain(1),
    };
    Object.values(this.layers).forEach((n) => n.connect(this.mix));

    this.noiseBuffer = ctx.createBuffer(
      1,
      Math.floor(ctx.sampleRate * 2),
      ctx.sampleRate,
    );
    const data = this.noiseBuffer.getChannelData(0);
    let seed = p.seed;
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = (seed / 2147483648 - 1) * 0.6;
    }
    const noise = own(ctx.createBufferSource());
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    this.sources.add(noise);
    noise.start();

    this.engineFilter = filter("lowpass", p.engine.cutoff);
    this.engineGain = gain();
    this.engineGain.connect(this.engineFilter);
    this.engineFilter.connect(this.layers.engine);
    this.engine = periodic(p.engine.harmonics);
    this.engine.connect(this.engineGain);
    this.sub = oscillator(vehicle === "suv" ? "triangle" : "sine", 30);
    const subGain = gain(p.engine.subGain);
    this.sub.connect(subGain);
    subGain.connect(this.engineGain);
    this.rough = oscillator("sine", p.engine.roughRate);
    this.roughGain = gain();
    this.rough.connect(this.roughGain);
    this.roughGain.connect(this.engineGain.gain);

    this.exhaust = periodic(p.exhaust.harmonics);
    this.exhaustGain = gain();
    const distortion = own(ctx.createWaveShaper()),
      curve = new Float32Array(512);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * p.exhaust.drive) / Math.tanh(p.exhaust.drive);
    }
    distortion.curve = curve;
    distortion.oversample = "2x";
    this.exhaust.connect(distortion);
    distortion.connect(this.exhaustGain);
    this.exhaustFilter = filter("lowpass", p.exhaust.cutoff);
    this.exhaustGain.connect(this.exhaustFilter);
    this.exhaustFilter.connect(this.layers.exhaust);
    this.exhaustNoise = gain();
    noise.connect(this.exhaustNoise);
    this.exhaustNoise.connect(this.exhaustFilter);

    this.tireFilter = filter("bandpass", p.tire.band, p.tire.q);
    this.tireGain = gain();
    noise.connect(this.tireFilter);
    this.tireFilter.connect(this.tireGain);
    this.tireGain.connect(this.layers.tire);
    this.tireTone = oscillator(p.tire.waveform, p.tire.tone);
    this.tireToneGain = gain();
    this.tireTone.connect(this.tireToneGain);
    this.tireToneGain.connect(this.layers.tire);
    const grain = oscillator("sine", p.tire.grain);
    this.tireMod = gain();
    grain.connect(this.tireMod);
    this.tireMod.connect(this.tireGain.gain);
    const vibrato = gain(vehicle === "formula" ? 12 : 35);
    grain.connect(vibrato);
    vibrato.connect(this.tireTone.detune);

    // Combustion rumble under a broad, turbulent roar; no rising synth whistle.
    this.boostTone = periodic(p.exhaust.harmonics);
    const boostToneFilter = filter("lowpass", 280);
    this.boostToneGain = gain();
    this.boostTone.connect(boostToneFilter);
    boostToneFilter.connect(this.boostToneGain);
    this.boostToneGain.connect(this.layers.boost);
    const boostFilter = filter("lowpass", p.boost.band, p.boost.q);
    const boostHighpass = filter("highpass", 35);
    this.boostGain = gain();
    noise.connect(boostHighpass);
    boostHighpass.connect(boostFilter);
    boostFilter.connect(this.boostGain);
    this.boostGain.connect(this.layers.boost);
    const crackleFilter = filter("bandpass", p.boost.band * 2.4, 0.45);
    this.boostCrackle = gain();
    noise.connect(crackleFilter);
    crackleFilter.connect(this.boostCrackle);
    this.boostCrackle.connect(this.layers.boost);
    const turbulence = filter("lowpass", 18 + p.engine.roughRate);
    this.boostFlutter = gain();
    noise.connect(turbulence);
    turbulence.connect(this.boostFlutter);
    this.boostFlutter.connect(this.boostGain.gain);
    const windFilter = filter("lowpass", 1100);
    this.wind = gain();
    noise.connect(windFilter);
    windFilter.connect(this.wind);
    this.wind.connect(this.layers.wind);
  }

  update(state: CarAudioState, time = this.context.currentTime) {
    if (this.disposed) return;
    const p = this.profile,
      s = audioTargets(p, state);
    const set = (param: AudioParam, value: number, lag = 0.045) =>
      param.setTargetAtTime(value, time, lag);
    const boosting = s.boostNoise > 0;
    if (boosting && !this.wasBoosting) this.boostStarted = time;
    const shift =
      state.active &&
      this.previousGear > 0 &&
      state.gear > this.previousGear &&
      s.load > 0.4;
    if (shift) this.cutUntil = time + 0.065;
    const lift =
      this.previousThrottle > 0.5 && state.throttle < 0.15 && state.rpm > 2400;
    if (
      state.active &&
      time - this.lastPop > 0.17 &&
      (shift ||
        lift ||
        (boosting && time - this.lastPop > p.exhaust.popInterval))
    ) {
      this.pop(
        time,
        shift ? 0.6 : boosting ? (this.wasBoosting ? 0.65 : 1) : 0.8,
      );
      this.lastPop = time;
    }
    set(this.master.gain, s.volume, state.active ? 0.07 : 0.025);
    set(this.engine.frequency, s.firingHz);
    set(this.sub.frequency, s.firingHz * p.engine.subRatio);
    set(this.engineGain.gain, s.engineGain * (time < this.cutUntil ? 0.65 : 1));
    set(this.engineFilter.frequency, s.engineCutoff, 0.07);
    set(
      this.rough.frequency,
      p.engine.roughRate + s.rev * p.engine.roughRate * 0.7,
    );
    set(this.roughGain.gain, s.engineGain * p.engine.roughness);
    set(this.exhaust.frequency, s.firingHz * p.exhaust.ratio);
    set(this.exhaustGain.gain, s.exhaustGain);
    set(this.exhaustFilter.frequency, s.exhaustCutoff);
    set(this.exhaustNoise.gain, s.exhaustNoise);
    set(this.tireGain.gain, s.tireNoise, 0.065);
    set(this.tireToneGain.gain, s.tireTone, 0.075);
    set(this.tireTone.frequency, s.tireHz, 0.07);
    set(this.tireFilter.frequency, s.tireBand);
    set(this.tireMod.gain, s.tireNoise * 0.12);
    const rise = Math.min(
      1,
      Math.max(0, (time - this.boostStarted) / p.boost.rise),
    );
    set(
      this.boostTone.frequency,
      p.boost.from + (p.boost.to - p.boost.from) * s.rev,
      0.025,
    );
    set(
      this.boostGain.gain,
      s.boostNoise * (0.7 + rise * 0.3),
      boosting ? 0.035 : 0.09,
    );
    set(this.boostToneGain.gain, s.boostTone, boosting ? 0.035 : 0.09);
    set(this.boostCrackle.gain, s.boostNoise * 0.32, boosting ? 0.025 : 0.065);
    set(this.boostFlutter.gain, s.boostNoise * 1.8, boosting ? 0.045 : 0.09);
    set(this.wind.gain, s.wind, 0.1);
    this.wasBoosting = boosting;
    this.previousGear = state.active ? state.gear : 0;
    this.previousThrottle = state.active ? state.throttle : 0;
  }

  private pop(time: number, strength: number) {
    const ctx = this.context,
      p = this.profile.exhaust;
    const tone = ctx.createOscillator(),
      gain = ctx.createGain();
    const noise = ctx.createBufferSource(),
      filter = ctx.createBiquadFilter();
    tone.type =
      this.profile.boost.waveform === "sawtooth"
        ? "triangle"
        : this.profile.boost.waveform;
    tone.frequency.setValueAtTime(p.popPitch, time);
    tone.frequency.exponentialRampToValueAtTime(
      p.popPitch * 0.3,
      time + p.popDuration,
    );
    noise.buffer = this.noiseBuffer;
    filter.type = "bandpass";
    filter.frequency.value = p.cutoff * 1.5;
    filter.Q.value = 0.8;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.045 * strength, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + p.popDuration);
    tone.connect(gain);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.layers.exhaust);
    const nodes = [tone, noise, filter, gain];
    this.nodes.push(...nodes);
    this.sources.add(tone);
    this.sources.add(noise);
    tone.onended = () => {
      nodes.forEach((n) => {
        n.disconnect();
        const i = this.nodes.indexOf(n);
        if (i >= 0) this.nodes.splice(i, 1);
      });
      this.sources.delete(tone);
      this.sources.delete(noise);
    };
    tone.start(time);
    noise.start(time);
    tone.stop(time + p.popDuration + 0.01);
    noise.stop(time + p.popDuration + 0.01);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.sources.forEach((s) => {
      try {
        s.stop();
      } catch {
        /* Already ended. */
      }
    });
    this.sources.clear();
    this.nodes.forEach((n) => n.disconnect());
    this.nodes.length = 0;
  }
}
