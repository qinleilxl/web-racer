import type { VehicleId } from "./Vehicles";
import type { CarAudioState } from "./AudioProfiles";
import { VehicleVoice } from "./VehicleVoice";
import { takePrimedAudio } from "./AudioUnlock";

export class GameAudio {
  private context?: AudioContext;
  private voice?: VehicleVoice;
  private disposed = false;
  constructor(public vehicle: VehicleId = "sparrow") {}
  setVehicle(vehicle: VehicleId) {
    if (this.disposed || this.vehicle === vehicle) return;
    // Retain the context unlocked by the original gesture, including on iOS.
    // Build the new silent graph before releasing the former vehicle's voice.
    const voice =
      this.context && this.context.state !== "closed"
        ? new VehicleVoice(this.context, vehicle)
        : undefined;
    this.voice?.dispose();
    this.voice = voice;
    this.vehicle = vehicle;
    if (this.context?.state === "closed") this.context = undefined;
  }
  async start() {
    if (this.disposed) return;
    if (!this.context) {
      this.context = takePrimedAudio() ?? new AudioContext();
      this.voice = new VehicleVoice(this.context, this.vehicle);
    }
    if (this.context.state === "suspended") await this.context.resume();
  }
  update(state: CarAudioState) {
    this.voice?.update(state);
  }
  beep(frequency = 660, duration = 0.12) {
    this.cue("sine", frequency, frequency, 0.12, duration);
  }
  impact(strength: number) {
    this.cue("triangle", 140, 35, Math.min(0.35, strength * 0.035), 0.22);
  }
  private cue(
    type: OscillatorType,
    from: number,
    to: number,
    level: number,
    duration: number,
  ) {
    if (!this.context || !this.voice || this.disposed) return;
    const ctx = this.context,
      oscillator = ctx.createOscillator(),
      gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      to,
      ctx.currentTime + duration,
    );
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(level, ctx.currentTime + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(this.voice.mix);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start();
    oscillator.stop(ctx.currentTime + duration + 0.01);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.voice?.dispose();
    void this.context?.close();
  }
}
