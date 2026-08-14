import { z } from "zod";

import type { Credentials } from "./credentials";

/** Typed HTTP client for the session backend. */

export const backendUrl = (): string =>
  (process.env.TELEGRAM_CONNECTOR_URL ?? "http://localhost:8300").replace(
    /\/+$/,
    "",
  );

export const createdAccountSchema = z.object({
  accountId: z.string(),
  accountToken: z.string(),
});

export const startedQrSchema = z.object({
  status: z.string(),
  connectPage: z.string(),
  loginTtlSeconds: z.number(),
});

export const accountStatusSchema = z.object({
  accountId: z.string(),
  status: z.string(),
  telegramUser: z
    .object({
      id: z.string(),
      username: z.string().nullable(),
      firstName: z.string().nullable(),
    })
    .nullable(),
  passwordHint: z.string().nullable(),
  error: z.string().nullable(),
});

export type AccountStatus = z.infer<typeof accountStatusSchema>;

export const chatSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  username: z.string().nullable(),
  kind: z.string(),
  memberCount: z.number().nullable(),
  isJoined: z.boolean(),
  link: z.string().nullable(),
});

export const chatSearchResultSchema = z.object({
  queries: z.array(z.string()),
  chats: z.array(chatSummarySchema),
});

export const messageHitSchema = z.object({
  chat: z
    .object({
      id: z.string(),
      title: z.string(),
      username: z.string().nullable(),
    })
    .nullable(),
  messageId: z.number(),
  sentAt: z.string().nullable(),
  senderName: z.string().nullable(),
  text: z.string(),
  replyToMsgId: z.number().nullable(),
  matchedQuery: z.string().nullable(),
  link: z.string().nullable(),
});

export const messageSearchResultSchema = z.object({
  queries: z.array(z.string()),
  scope: z.string(),
  chat: chatSummarySchema.nullable(),
  variantStats: z
    .array(
      z.object({
        query: z.string().nullable(),
        totalCount: z.number().nullable(),
        fetched: z.number(),
      }),
    )
    .nullable(),
  nextOffsetId: z.number().nullable(),
  messages: z.array(messageHitSchema),
});

export const messageFetchResultSchema = z.object({
  chat: chatSummarySchema,
  messages: z.array(messageHitSchema),
});

export const joinChatResultSchema = z.object({
  joined: z.boolean(),
  pendingApproval: z.boolean(),
  chat: chatSummarySchema.nullable(),
});

export class BackendError extends Error {}

const errorBodySchema = z.object({ message: z.string() });

async function raiseForStatus(response: Response): Promise<void> {
  if (response.ok) return;
  const body = errorBodySchema.safeParse(
    await response.json().catch(() => null),
  );
  const detail = body.success ? body.data.message : response.statusText;
  throw new BackendError(`Backend returned ${response.status}: ${detail}`);
}

const authHeaders = (credentials: Credentials): Record<string, string> => ({
  Authorization: `Bearer ${credentials.accountToken}`,
});

export async function requestJson<Output>(
  schema: z.ZodType<Output>,
  input: {
    method: "GET" | "POST" | "DELETE";
    path: string;
    credentials?: Credentials;
    body?: unknown;
  },
): Promise<Output> {
  const response = await fetch(`${backendUrl()}${input.path}`, {
    method: input.method,
    headers: {
      "Content-Type": "application/json",
      ...(input.credentials ? authHeaders(input.credentials) : {}),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  await raiseForStatus(response);
  return schema.parse(await response.json());
}

/** Fetch the current QR image; null when no login is waiting for a scan. */
export async function fetchQrPng(
  credentials: Credentials,
): Promise<Buffer | null> {
  const response = await fetch(
    `${backendUrl()}/v1/accounts/${credentials.accountId}/qr.png`,
    { headers: authHeaders(credentials) },
  );
  if (response.status === 409) return null;
  await raiseForStatus(response);
  return Buffer.from(await response.arrayBuffer());
}
