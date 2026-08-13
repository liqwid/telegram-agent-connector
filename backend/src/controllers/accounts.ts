import { HTTPStatus } from "common";
import { z } from "zod";

import { renderQrPng } from "@/services/qrImage";
import { getActiveQrUrl } from "@/services/telegramLogin";
import { createAccount } from "@/useCases/createAccount";
import { disconnectAccount } from "@/useCases/disconnectAccount";
import { getAccountStatus } from "@/useCases/getAccountStatus";
import { startQrLogin } from "@/useCases/startQrLogin";
import { submitLoginPassword } from "@/useCases/submitLoginPassword";
import { accountHandler, publicHandler } from "@/utils/handler";

export const accountPathSchema = z.object({
  accountId: z.string().min(1),
});

export const submitPasswordBodySchema = z.object({
  password: z.string().min(1),
});

/** Register an account slot; returns the one-time bearer token. */
export const createAccountHandler = publicHandler.parse({}).handle(async () => {
  const created = await createAccount();
  return {
    status: HTTPStatus.CREATED,
    body: {
      ...created,
      next: `POST /v1/accounts/${created.accountId}/qr to start the QR login`,
    },
  };
});

/** Start (or restart) a QR login for the account. */
export const startQrHandler = accountHandler
  .parse({ path: accountPathSchema })
  .handleAuthorized(async ({ auth }) => ({
    status: HTTPStatus.OK,
    body: await startQrLogin(auth.account),
  }));

/** The current QR code as a PNG image (the underlying token rotates ~30s). */
export const qrPngHandler = accountHandler
  .parse({ path: accountPathSchema })
  .handleAuthorized(async ({ auth }) => ({
    status: HTTPStatus.OK,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    },
    body: await renderQrPng(getActiveQrUrl(auth.account.id)),
  }));

/** Login/session status — what plugins poll while the user scans. */
export const accountStatusHandler = accountHandler
  .parse({ path: accountPathSchema })
  .handleAuthorized(async ({ auth }) => ({
    status: HTTPStatus.OK,
    body: getAccountStatus(auth.account),
  }));

/** Complete a 2FA-protected login with the user's cloud password. */
export const submitPasswordHandler = accountHandler
  .parse({ body: submitPasswordBodySchema, path: accountPathSchema })
  .handleAuthorized(async ({ auth, body }) => ({
    status: HTTPStatus.OK,
    body: await submitLoginPassword(auth.account, body.password),
  }));

/** Log out of Telegram and delete the account, credentials included. */
export const deleteAccountHandler = accountHandler
  .parse({ path: accountPathSchema })
  .handleAuthorized(async ({ auth }) => {
    await disconnectAccount(auth.account);
    return {
      status: HTTPStatus.OK,
      body: { deleted: auth.account.id },
    };
  });
