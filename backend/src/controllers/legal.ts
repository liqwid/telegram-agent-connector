import { HTTPStatus } from "common";

import { contactHtml } from "@/legal/contact";
import { legalIndexHtml } from "@/legal/legalIndex";
import { privacyPolicyHtml } from "@/legal/privacyPolicy";
import { termsOfServiceHtml } from "@/legal/termsOfService";
import { publicHandler } from "@/utils/handler";

/**
 * The public legal pages. Until 2026-08-28 /legal and /privacy were the same
 * handler serving one document that carried the privacy policy, the terms and
 * the contact address together; each now has its own route and its own page.
 */

const htmlPage = (render: () => string) =>
  publicHandler.parse({}).handle(async () => ({
    status: HTTPStatus.OK,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: render(),
  }));

export const legalHandler = htmlPage(legalIndexHtml);
export const privacyHandler = htmlPage(privacyPolicyHtml);
export const termsHandler = htmlPage(termsOfServiceHtml);
export const contactHandler = htmlPage(contactHtml);
