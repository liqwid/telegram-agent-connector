/**
 * Central place to report a handled error. The boilerplate just logs to the
 * console — swap the body for Sentry/Datadog/your logger of choice without
 * touching the call sites in `parseModels` and the HTTP layer.
 */
export function captureError(
  err: Error,
  context: Record<string, unknown> | null = null,
): void {
  if (context) {
    console.error(err.message, context, err);
  } else {
    console.error(err.message, err);
  }
}
