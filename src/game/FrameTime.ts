/** Keep animation damping bounded without throwing away simulation time at low FPS.
 * A quarter-second stall is the catch-up limit; hidden tabs are paused by Game.
 */
export function frameTime(elapsed: number) {
  const seconds = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  return {
    visual: Math.min(seconds, 0.08),
    simulation: Math.min(seconds, 0.25),
  };
}
