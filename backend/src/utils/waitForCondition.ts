const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll `condition` until it returns true or `timeoutMs` elapses. Returns
 * whether the condition was met — used to await in-memory login-state
 * transitions driven by gramjs callbacks.
 */
export async function waitForCondition(
  condition: () => boolean,
  timeoutMs: number,
  intervalMs = 200,
): Promise<boolean> {
  if (condition()) return true;
  if (timeoutMs <= 0) return false;
  await sleep(Math.min(intervalMs, timeoutMs));
  return waitForCondition(condition, timeoutMs - intervalMs, intervalMs);
}
