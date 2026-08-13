import { HTTPStatus } from "common";

import { submitPasswordBodySchema } from "@/controllers/accounts";
import { disconnectAccount } from "@/useCases/disconnectAccount";
import { getAccountStatus } from "@/useCases/getAccountStatus";
import { startQrLogin } from "@/useCases/startQrLogin";
import { submitLoginPassword } from "@/useCases/submitLoginPassword";
import { oauthHandler } from "@/utils/handler";

/**
 * OAuth-scoped twins of the account endpoints: the access token implies the
 * account, so callers (ChatGPT Actions with OAuth, scripts) never handle an
 * accountId. Same use cases underneath.
 */

export const meStatusHandler = oauthHandler
  .parse({})
  .handleAuthorized(async ({ auth }) => ({
    status: HTTPStatus.OK,
    body: getAccountStatus(auth.account),
  }));

export const meStartQrHandler = oauthHandler
  .parse({})
  .handleAuthorized(async ({ auth }) => ({
    status: HTTPStatus.OK,
    body: await startQrLogin(auth.account),
  }));

export const meSubmitPasswordHandler = oauthHandler
  .parse({ body: submitPasswordBodySchema })
  .handleAuthorized(async ({ auth, body }) => ({
    status: HTTPStatus.OK,
    body: await submitLoginPassword(auth.account, body.password),
  }));

export const meDisconnectHandler = oauthHandler
  .parse({})
  .handleAuthorized(async ({ auth }) => {
    await disconnectAccount(auth.account);
    return {
      status: HTTPStatus.OK,
      body: { deleted: auth.account.id },
    };
  });
