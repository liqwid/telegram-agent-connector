type Meta = Record<string, unknown>;

/**
 * Minimal structured logger used across the backend. Swap the bodies for
 * pino/winston/your platform logger without changing call sites.
 */
export const logger = {
  info: (message: string, meta?: Meta) => console.info(message, meta ?? ""),
  warn: (message: string, meta?: Meta) => console.warn(message, meta ?? ""),
  error: (message: string, meta?: Meta, err?: unknown) =>
    console.error(message, meta ?? "", err ?? ""),
  debug: (message: string, meta?: Meta) => console.debug(message, meta ?? ""),
};
