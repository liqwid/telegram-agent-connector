import { describe, expect, it } from "vitest";
import { z } from "zod";

import { buildOpenApiSpec } from "@/openapi/spec";

/** The parts of an operation ChatGPT's Actions importer validates. */
const operationSchema = z.object({
  operationId: z.string(),
  summary: z.string(),
});

const allOperations = (): { path: string; summary: string }[] => {
  const paths = z
    .object({ paths: z.record(z.string(), z.record(z.string(), z.unknown())) })
    .parse(buildOpenApiSpec()).paths;
  return Object.entries(paths).flatMap(([path, methods]) =>
    Object.values(methods).map((operation) => ({
      path,
      summary: operationSchema.parse(operation).summary,
    })),
  );
};

describe("buildOpenApiSpec", () => {
  // ChatGPT's Actions importer rejects the whole schema when any operation
  // summary exceeds 300 characters.
  it("keeps every operation summary within ChatGPT's 300-char limit", () => {
    allOperations().forEach(({ path, summary }) => {
      expect(
        summary.length,
        `${path}: summary is ${summary.length} chars`,
      ).toBeLessThanOrEqual(300);
    });
  });

  it("covers the full endpoint surface", () => {
    expect(allOperations().length).toBeGreaterThanOrEqual(16);
  });
});
