import { describe, expect, it } from "vitest";
import { z } from "zod";

import { buildOpenApiSpec } from "@/openapi/spec";

/** The parts of an operation ChatGPT's Actions importer validates. */
const operationSchema = z.object({
  operationId: z.string(),
  summary: z.string(),
  description: z.string().optional(),
});

/**
 * The contract ChatGPT imports: operationId -> path. Counting operations is
 * not enough — a renamed or dropped path keeps the count and silently ships a
 * GPT that cannot reach the endpoint, so the mapping itself is asserted.
 */
const EXPECTED_OPERATIONS: Record<string, string> = {
  createAccount: "/v1/accounts",
  startQrLogin: "/v1/accounts/{accountId}/qr",
  getQrPng: "/v1/accounts/{accountId}/qr.png",
  getAccountStatus: "/v1/accounts/{accountId}",
  disconnectAccount: "/v1/accounts/{accountId}",
  submitPassword: "/v1/accounts/{accountId}/password",
  searchChats: "/v1/accounts/{accountId}/chats/search",
  searchMessages: "/v1/accounts/{accountId}/messages/search",
  fetchMessages: "/v1/accounts/{accountId}/messages/get",
  sendMessage: "/v1/accounts/{accountId}/messages/send",
  joinChat: "/v1/accounts/{accountId}/chats/join",
  getMyStatus: "/v1/me",
  disconnectMe: "/v1/me",
  startMyQrLogin: "/v1/me/qr",
  submitMyPassword: "/v1/me/password",
  searchMyChats: "/v1/me/chats/search",
  searchMyMessages: "/v1/me/messages/search",
  fetchMyMessages: "/v1/me/messages/get",
  sendMyMessage: "/v1/me/messages/send",
  joinMyChat: "/v1/me/chats/join",
};

const allOperations = (): {
  path: string;
  operationId: string;
  summary: string;
  description: string | undefined;
}[] => {
  const paths = z
    .object({ paths: z.record(z.string(), z.record(z.string(), z.unknown())) })
    .parse(buildOpenApiSpec()).paths;
  return Object.entries(paths).flatMap(([path, methods]) =>
    Object.values(methods).map((operation) => {
      const parsed = operationSchema.parse(operation);
      return {
        path,
        operationId: parsed.operationId,
        summary: parsed.summary,
        description: parsed.description,
      };
    }),
  );
};

describe("buildOpenApiSpec", () => {
  // ChatGPT's Actions importer rejects the whole schema when any operation
  // summary OR description exceeds 300 characters.
  it("keeps every operation summary and description within ChatGPT's 300-char limit", () => {
    allOperations().forEach(({ path, summary, description }) => {
      expect(
        summary.length,
        `${path}: summary is ${summary.length} chars`,
      ).toBeLessThanOrEqual(300);
      expect(
        description?.length ?? 0,
        `${path}: description is ${description?.length ?? 0} chars`,
      ).toBeLessThanOrEqual(300);
    });
  });

  it("covers the full endpoint surface", () => {
    expect(allOperations().length).toBeGreaterThanOrEqual(18);
  });

  it("exposes every contracted operation at its expected path", () => {
    const byOperationId = new Map(
      allOperations().map((operation) => [operation.operationId, operation]),
    );
    Object.entries(EXPECTED_OPERATIONS).forEach(([operationId, path]) => {
      expect(
        byOperationId.get(operationId)?.path,
        `${operationId} is missing or moved`,
      ).toBe(path);
    });
  });
});
