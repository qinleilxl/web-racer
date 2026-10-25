export class GameAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private engine?: OscillatorNode;
  private harmonic?: OscillatorNode;
  private engineGain?: GainNode;
  private wind?: GainNode;
  private tire?: GainNode;
  async start() {
    if (this.context) {
      await this.context.resume();
      return;
    }
    const ctx = new AudioContext();
    this.context = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.master.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 650;
    filter.connect(this.master);
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.055;
    this.engineGain.connect(filter);
    this.engine = ctx.createOscillator();
    this.engine.type = "sawtooth";
    this.engine.frequency.value = 35;
    this.engine.connect(this.engineGain);
    this.engine.start();
    this.harmonic = ctx.createOscillator();
    this.harmonic.type = "triangle";
    this.harmonic.frequency.value = 71;
    this.harmonic.connect(this.engineGain);
    this.harmonic.start();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++)
      data[i] = (Math.random() * 2 - 1) * 0.5;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "lowpass";
    windFilter.frequency.value = 1100;
    this.wind = ctx.createGain();
    noise.connect(windFilter);
    windFilter.connect(this.wind);
    this.wind.connect(this.master);
    const tireFilter = ctx.createBiquadFilter();
    tireFilter.type = "bandpass";
    tireFilter.frequency.value = 1900;
    this.tire = ctx.createGain();
    noise.connect(tireFilter);
    tireFilter.connect(this.tire);
    this.tire.connect(this.master);
    noise.start();
  }
  update(
    rpm: number,
    speed: number,
    drifting: boolean,
    volume: number,
    active: boolean,
  ) {
    if (!this.context || !this.master) return;
    const t = this.context.currentTime;
    this.master.gain.setTargetAtTime(active ? volume : 0, t, 0.1);
    const hz = 28 + rpm / 45;
    this.engine?.frequency.setTargetAtTime(hz, t, 0.06);
    this.harmonic?.frequency.setTargetAtTime(hz * 2.02, t, 0.06);
    this.wind?.gain.setTargetAtTime(0.018 + speed * 0.002, t, 0.1);
    this.tire?.gain.setTargetAtTime(drifting && speed > 6 ? 0.12 : 0, t, 0.08);
  }
  beep(frequency = 660, duration = 0.12) {
    if (!this.context || !this.master) return;
    const ctx = this.context;
    const oscillator = ctx.createOscillator(),
      gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.14, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start();
    oscillator.stop(ctx.currentTime + duration);
  }
  impact(strength: number) {
    if (!this.context || !this.master) return;
    const ctx = this.context,
      oscillator = ctx.createOscillator(),
      gain = ctx.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(140, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      35,
      ctx.currentTime + 0.18,
    );
    gain.gain.setValueAtTime(Math.min(0.5, strength * 0.04), ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.23);
  }
  dispose() {
    void this.context?.close();
  }
}
