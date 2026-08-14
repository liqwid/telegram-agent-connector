import { describe, expect, it } from "vitest";
import { z } from "zod";

import { buildOpenApiSpec } from "@/openapi/spec";

/** The parts of an operation ChatGPT's Actions importer validates. */
const operationSchema = z.object({
  operationId: z.string(),
  summary: z.string(),
  description: z.string().optional(),
});

const allOperations = (): {
  path: string;
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
    expect(allOperations().length).toBeGreaterThanOrEqual(16);
  });
});
