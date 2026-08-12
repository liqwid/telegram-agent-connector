import type { AccountWithTokenHash } from "@/models/account";
import { getQrLoginView } from "@/services/telegramLogin";

export type AccountStatus = {
  accountId: string;
  status: string;
  telegramUser: {
    id: string;
    username: string | null;
    firstName: string | null;
  } | null;
  qrExpiresAt: Date | null;
  passwordHint: string | null;
  error: string | null;
};

/**
 * The merged view plugins poll: a stored session wins (durably authorized),
 * otherwise the live login attempt's state, otherwise "not_started".
 */
export function getAccountStatus(account: AccountWithTokenHash): AccountStatus {
  if (account.sessionEnc) {
    return {
      accountId: account.id,
      status: "authorized",
      telegramUser: {
        id: account.tgUserId ?? "",
        username: account.tgUsername,
        firstName: account.tgFirstName,
      },
      qrExpiresAt: null,
      passwordHint: null,
      error: null,
    };
  }

  const login = getQrLoginView(account.id);
  return {
    accountId: account.id,
    status: login?.status ?? "not_started",
    telegramUser: null,
    qrExpiresAt: login?.qrExpiresAt ?? null,
    passwordHint: login?.passwordHint ?? null,
    error: login?.error ?? null,
  };
}
