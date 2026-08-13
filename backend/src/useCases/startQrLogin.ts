import { logger } from "common/logging";

import { env } from "@/env";
import type { AccountWithTokenHash } from "@/models/account";
import {
  AlreadyAuthorizedError,
  TelegramCredentialsError,
} from "@/models/error";
import { saveAccountSession } from "@/repositories/accountRepository";
import { encryptSecret } from "@/services/encryption";
import { createPageToken } from "@/services/pageTokens";
import {
  type QrLoginView,
  startQrLogin as startTelegramQrLogin,
} from "@/services/telegramLogin";

export type StartedQrLogin = QrLoginView & {
  accountId: string;
  pngUrl: string;
  connectPage: string;
  loginTtlSeconds: number;
};

const CREDENTIAL_ERROR_CODES = ["API_ID_INVALID", "API_ID_PUBLISHED_FLOOD"];

/**
 * Kick off a QR login for the account using the deployment's Telegram
 * application credentials, and hand back everything a plugin needs to show
 * the QR — the raw `tg://login` URL, a PNG endpoint, and a hosted fallback
 * page. Links are authenticated with a short-lived signed page token, so
 * they work for OAuth callers who never hold a raw account token.
 */
export async function startQrLogin(
  account: AccountWithTokenHash,
): Promise<StartedQrLogin> {
  if (account.sessionEnc) {
    throw new AlreadyAuthorizedError(
      "This account already holds a Telegram session — disconnect it first",
    );
  }

  const view = await startTelegramQrLogin({
    accountId: account.id,
    apiId: env.TELEGRAM_API_ID,
    apiHash: env.TELEGRAM_API_HASH,
    onAuthorized: async (user) =>
      saveAccountSession(account.id, {
        sessionEnc: encryptSecret(user.sessionString, env.ENCRYPTION_SECRET),
        tgUserId: user.tgUserId,
        tgUsername: user.tgUsername,
        tgFirstName: user.tgFirstName,
      }),
  }).catch((error: unknown) => {
    const isCredentialError =
      error instanceof Error &&
      CREDENTIAL_ERROR_CODES.some((code) => error.message.includes(code));
    if (isCredentialError) {
      // Operator misconfiguration, not a caller mistake — surfaces as a 500.
      throw new TelegramCredentialsError(
        "Telegram rejected this deployment's TELEGRAM_API_ID/TELEGRAM_API_HASH — the operator must fix the backend configuration",
      );
    }
    throw error;
  });

  logger.info("startQrLogin: QR issued", { accountId: account.id });
  const base = env.PUBLIC_BASE_URL;
  const token = encodeURIComponent(
    createPageToken(account.id, env.LOGIN_TTL_SECONDS + 300),
  );
  return {
    ...view,
    accountId: account.id,
    pngUrl: `${base}/v1/accounts/${account.id}/qr.png?token=${token}`,
    connectPage: `${base}/connect/${account.id}?token=${token}`,
    loginTtlSeconds: env.LOGIN_TTL_SECONDS,
  };
}
