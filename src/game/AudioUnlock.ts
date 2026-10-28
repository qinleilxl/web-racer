// iOS requires this context to be created/resumed inside the initial tap,
// before the asynchronously loaded game engine becomes available.
let primed: AudioContext | undefined;

export function primeGameAudio() {
  if (typeof AudioContext === "undefined") return;
  try {
    if (!primed || primed.state === "closed") primed = new AudioContext();
    void primed.resume().catch(() => {});
  } catch { /* Driving also works without audio. */ }
}

export function takePrimedAudio() {
  const context = primed?.state === "closed" ? undefined : primed;
  primed = undefined;
  return context;
}

export function releasePrimedAudio() {
  const context = takePrimedAudio();
  void context?.close().catch(() => {});
}
