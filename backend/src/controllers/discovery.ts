import { HTTPStatus } from "common";

import { env } from "@/env";
import { buildOpenApiSpec } from "@/openapi/spec";
import { renderQrPng } from "@/services/qrImage";
import { publicHandler } from "@/utils/handler";

/** Legacy ChatGPT plugin manifest; Custom GPT Actions use /openapi.json. */
export const aiPluginHandler = publicHandler.parse({}).handle(async () => ({
  status: HTTPStatus.OK,
  body: {
    schema_version: "v1",
    name_for_human: "Telegram Connector",
    name_for_model: "telegram_connector",
    description_for_human: "Connect your Telegram account via QR login.",
    description_for_model: [
      "Connects the user's Telegram account.",
      "To authenticate: 1) POST /v1/accounts (no input) and remember accountId and accountToken,",
      "2) POST /v1/accounts/{accountId}/qr with the token as a Bearer header,",
      "3) send the user the connectPage link from the response so they can scan the QR,",
      "4) poll GET /v1/accounts/{accountId} until status is 'authorized';",
      "if it is 'password_needed', ask for the 2FA password and POST it to /password.",
    ].join(" "),
    auth: { type: "none" },
    api: { type: "openapi", url: `${env.PUBLIC_BASE_URL}/openapi.json` },
    logo_url: `${env.PUBLIC_BASE_URL}/logo.png`,
    contact_email: env.CONTACT_EMAIL,
    legal_info_url: `${env.PUBLIC_BASE_URL}/legal`,
  },
}));

export const openApiHandler = publicHandler.parse({}).handle(async () => ({
  status: HTTPStatus.OK,
  body: buildOpenApiSpec(),
}));

/** Zero-asset logo: a QR code pointing at the project repository. */
export const logoHandler = publicHandler.parse({}).handle(async () => ({
  status: HTTPStatus.OK,
  headers: { "Content-Type": "image/png" },
  body: await renderQrPng(
    "https://github.com/liqwid/telegram-agent-connector",
  ),
}));

export const healthHandler = publicHandler.parse({}).handle(async () => ({
  status: HTTPStatus.OK,
  body: { ok: true },
}));
