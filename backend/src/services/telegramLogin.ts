import { logger } from "common/logging";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

import { env } from "@/env";
import {
  InvalidPasswordError,
  NoActiveLoginError,
  TelegramLoginError,
} from "@/models/error";
import { createDeferred, type Deferred } from "@/utils/deferred";
import { waitForCondition } from "@/utils/waitForCondition";

/**
 * In-memory QR-login state machine, one entry per account. gramjs drives the
 * flow through callbacks (`qrCode` fires on every token rotation, `password`
 * awaits the 2FA password); this module turns those callbacks into a pollable
 * status plus a deferred the HTTP layer resolves when the password arrives in
 * a later request.
 *
 * Live logins exist only in this process — run a single instance. The durable
 * artifact is the session string handed to `onAuthorized` once login succeeds.
 */

export type QrLoginStatus =
  "waiting_scan" | "password_needed" | "authorized" | "expired" | "error";

export type AuthorizedTelegramUser = {
  sessionString: string;
  tgUserId: string;
  tgUsername: string | null;
  tgFirstName: string | null;
};

export type QrLoginView = {
  status: QrLoginStatus;
  qrUrl: string | null;
  qrExpiresAt: Date | null;
  passwordHint: string | null;
  error: string | null;
};

type QrLoginState = {
  accountId: string;
  client: TelegramClient;
  session: StringSession;
  status: QrLoginStatus;
  qrUrl: string | null;
  qrExpiresAt: Date | null;
  passwordHint: string | null;
  passwordWasRejected: boolean;
  error: string | null;
  passwordRequest: Deferred<string> | null;
  // Bumped on every transition so waiters can detect "something changed".
  version: number;
  expiryTimer: NodeJS.Timeout | null;
};

const activeLogins = new Map<string, QrLoginState>();

const QR_APPEAR_TIMEOUT_MS = 15_000;
const PASSWORD_CHECK_TIMEOUT_MS = 30_000;

const isTerminal = (status: QrLoginStatus): boolean =>
  status === "authorized" || status === "expired" || status === "error";

function transition(
  state: QrLoginState,
  patch: Partial<
    Pick<
      QrLoginState,
      | "status"
      | "qrUrl"
      | "qrExpiresAt"
      | "passwordHint"
      | "passwordWasRejected"
      | "error"
      | "passwordRequest"
    >
  >,
): void {
  Object.assign(state, patch);
  state.version += 1;
  logger.info("qrLogin: transition", {
    accountId: state.accountId,
    status: state.status,
    version: state.version,
  });
}

const toView = (state: QrLoginState): QrLoginView => ({
  status: state.status,
  qrUrl: state.status === "waiting_scan" ? state.qrUrl : null,
  qrExpiresAt: state.status === "waiting_scan" ? state.qrExpiresAt : null,
  passwordHint: state.status === "password_needed" ? state.passwordHint : null,
  error: state.error,
});

/** The gramjs RPC error code, when `err` is an RPC error. */
const rpcErrorMessage = (err: unknown): string | null =>
  err !== null &&
  typeof err === "object" &&
  "errorMessage" in err &&
  typeof err.errorMessage === "string"
    ? err.errorMessage
    : null;

const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export function getQrLoginView(accountId: string): QrLoginView | null {
  const state = activeLogins.get(accountId);
  return state ? toView(state) : null;
}

/** The current `tg://login` URL, for rendering the QR image. */
export function getActiveQrUrl(accountId: string): string {
  const state = activeLogins.get(accountId);
  if (!state || state.status !== "waiting_scan" || !state.qrUrl) {
    throw new NoActiveLoginError(
      "No QR login is waiting for a scan — start one first",
    );
  }
  return state.qrUrl;
}

export async function startQrLogin(input: {
  accountId: string;
  apiId: number;
  apiHash: string;
  onAuthorized: (user: AuthorizedTelegramUser) => Promise<void>;
}): Promise<QrLoginView> {
  // Restarting replaces any previous in-flight attempt for this account.
  await dropQrLogin(input.accountId);

  logger.info("qrLogin: starting", { accountId: input.accountId });
  const session = new StringSession("");
  const client = new TelegramClient(session, input.apiId, input.apiHash, {
    connectionRetries: 3,
  });

  const state: QrLoginState = {
    accountId: input.accountId,
    client,
    session,
    status: "waiting_scan",
    qrUrl: null,
    qrExpiresAt: null,
    passwordHint: null,
    passwordWasRejected: false,
    error: null,
    passwordRequest: null,
    version: 0,
    expiryTimer: null,
  };
  activeLogins.set(input.accountId, state);
  state.expiryTimer = setTimeout(() => {
    void expireQrLogin(state);
  }, env.LOGIN_TTL_SECONDS * 1000);

  void runQrFlow(state, input);

  const qrAppeared = await waitForCondition(
    () => state.qrUrl !== null || isTerminal(state.status),
    QR_APPEAR_TIMEOUT_MS,
  );
  if (state.status === "error" || !qrAppeared) {
    await dropQrLogin(input.accountId);
    throw new TelegramLoginError(
      state.error ?? "Telegram did not issue a QR login token in time",
    );
  }
  return toView(state);
}

async function runQrFlow(
  state: QrLoginState,
  input: {
    apiId: number;
    apiHash: string;
    onAuthorized: (user: AuthorizedTelegramUser) => Promise<void>;
  },
): Promise<void> {
  try {
    await state.client.connect();
    const user = await state.client.signInUserWithQrCode(
      { apiId: input.apiId, apiHash: input.apiHash },
      {
        qrCode: async (code) =>
          transition(state, {
            status: "waiting_scan",
            qrUrl: `tg://login?token=${code.token.toString("base64url")}`,
            qrExpiresAt: new Date(code.expires * 1000),
          }),
        password: async (hint) => requestPassword(state, hint ?? null),
        onError: async (err) => handleFlowError(state, err),
      },
    );
    await finalizeAuthorized(state, user, input.onAuthorized);
  } catch (err) {
    if (!isTerminal(state.status)) {
      logger.error("qrLogin: flow failed", { accountId: state.accountId }, err);
      transition(state, { status: "error", error: errorText(err) });
    }
  } finally {
    await safeDisconnect(state.client);
  }
}

/**
 * gramjs calls this when the scanned account has 2FA enabled — and again after
 * every rejected attempt. The returned promise resolves when the user submits
 * a password via `submitLoginPassword`.
 */
function requestPassword(
  state: QrLoginState,
  hint: string | null,
): Promise<string> {
  const request = createDeferred<string>();
  transition(state, {
    status: "password_needed",
    passwordHint: hint,
    passwordRequest: request,
  });
  return request.promise;
}

/**
 * gramjs error callback: returning true aborts the flow, false retries. A
 * rejected 2FA password is a retry — flag it so the waiting HTTP request can
 * report it — everything else is fatal.
 */
function handleFlowError(state: QrLoginState, err: Error): boolean {
  if (rpcErrorMessage(err) === "PASSWORD_HASH_INVALID") {
    logger.warn("qrLogin: 2FA password rejected", {
      accountId: state.accountId,
    });
    transition(state, { passwordWasRejected: true });
    return false;
  }
  logger.error("qrLogin: telegram error", { accountId: state.accountId }, err);
  transition(state, { status: "error", error: errorText(err) });
  return true;
}

async function finalizeAuthorized(
  state: QrLoginState,
  user: Api.TypeUser,
  onAuthorized: (authorized: AuthorizedTelegramUser) => Promise<void>,
): Promise<void> {
  const profile =
    user instanceof Api.User
      ? {
          tgUserId: user.id.toString(),
          tgUsername: user.username ?? null,
          tgFirstName: user.firstName ?? null,
        }
      : { tgUserId: "", tgUsername: null, tgFirstName: null };
  await onAuthorized({ sessionString: state.session.save(), ...profile });
  transition(state, { status: "authorized" });
  logger.info("qrLogin: authorized", {
    accountId: state.accountId,
    tgUserId: profile.tgUserId,
  });
}

/**
 * Resolve the pending password request and wait for Telegram's verdict: the
 * next transition is either `authorized` or a re-request (rejected password).
 */
export async function submitLoginPassword(
  accountId: string,
  password: string,
): Promise<QrLoginView> {
  const state = activeLogins.get(accountId);
  if (!state || state.status !== "password_needed" || !state.passwordRequest) {
    throw new NoActiveLoginError(
      "No login attempt is waiting for a 2FA password",
    );
  }
  const request = state.passwordRequest;
  const versionBefore = state.version;
  transition(state, { passwordRequest: null, passwordWasRejected: false });
  request.resolve(password);

  const settled = await waitForCondition(
    () => state.version > versionBefore + 1 || isTerminal(state.status),
    PASSWORD_CHECK_TIMEOUT_MS,
  );
  if (state.passwordWasRejected) {
    throw new InvalidPasswordError("Telegram rejected the 2FA password");
  }
  if (!settled) {
    throw new TelegramLoginError(
      "Timed out waiting for Telegram to verify the password",
    );
  }
  return toView(state);
}

async function expireQrLogin(state: QrLoginState): Promise<void> {
  if (isTerminal(state.status)) return;
  logger.info("qrLogin: expired", { accountId: state.accountId });
  transition(state, { status: "expired" });
  state.passwordRequest?.reject(new Error("QR login expired"));
  await safeDisconnect(state.client);
}

/** Cancel and forget the in-flight login for an account, if any. */
export async function dropQrLogin(accountId: string): Promise<void> {
  const state = activeLogins.get(accountId);
  if (!state) return;
  activeLogins.delete(accountId);
  if (state.expiryTimer) clearTimeout(state.expiryTimer);
  state.passwordRequest?.reject(new Error("QR login cancelled"));
  await safeDisconnect(state.client);
  logger.info("qrLogin: dropped", { accountId });
}

/**
 * Best-effort remote logout of a stored session (invalidates the "device" in
 * the user's Telegram settings). Failures are logged, never thrown — deleting
 * the local account must not depend on Telegram being reachable.
 */
export async function logoutStoredSession(
  apiId: number,
  apiHash: string,
  sessionString: string,
): Promise<void> {
  const client = new TelegramClient(
    new StringSession(sessionString),
    apiId,
    apiHash,
    { connectionRetries: 1 },
  );
  try {
    await client.connect();
    await client.invoke(new Api.auth.LogOut());
    logger.info("logoutStoredSession: remote logout done");
  } catch (err) {
    logger.warn("logoutStoredSession: remote logout failed", {
      error: errorText(err),
    });
  } finally {
    await safeDisconnect(client);
  }
}

export async function shutdownQrLogins(): Promise<void> {
  await Promise.all(
    [...activeLogins.keys()].map((accountId) => dropQrLogin(accountId)),
  );
}

async function safeDisconnect(client: TelegramClient): Promise<void> {
  try {
    await client.disconnect();
  } catch {
    // Already disconnected or never connected — nothing to clean up.
  }
}
