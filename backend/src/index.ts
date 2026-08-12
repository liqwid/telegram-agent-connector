import { logger } from "common/logging";

import { createApp } from "@/app";
import { env } from "@/env";
import { shutdownQrLogins } from "@/services/telegramLogin";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(
    `Telegram Agent Connector listening on http://localhost:${env.PORT}`,
  );
});

// In-flight QR logins hold open MTProto connections — close them cleanly.
const shutdown = (signal: string): void => {
  logger.info(`${signal} received, shutting down`);
  server.close();
  void shutdownQrLogins().finally(() => process.exit(0));
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
