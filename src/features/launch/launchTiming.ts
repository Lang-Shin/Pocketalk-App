export const LAUNCH_HOLD_MS = 1550;
export const LAUNCH_FADE_MS = 250;

export function launchExitDuration(reducedMotion: boolean): number {
  return reducedMotion ? 0 : LAUNCH_FADE_MS;
}

export function scheduleLaunchExit(
  onExit: () => void,
  schedule: typeof setTimeout = setTimeout,
  cancel: typeof clearTimeout = clearTimeout,
): () => void {
  let active = true;
  const timer = schedule(() => {
    if (active) onExit();
  }, LAUNCH_HOLD_MS);
  return () => {
    active = false;
    cancel(timer);
  };
}
