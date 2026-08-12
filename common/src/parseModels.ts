import { z, ZodError } from "zod";

import { captureError } from "./captureError";
import { camelCaseDeep, isNotNull } from "./helpers";

export class ParserError extends Error {
  constructor(parser: z.ZodType, item?: unknown) {
    super(`Error parsing ${JSON.stringify(parser)} ${JSON.stringify(item)}`);
    this.name = "ParserError";
  }
}

/**
 * Parse a list of raw records, dropping any that fail validation (the failures
 * are reported through `captureError`). Use this at the boundary where you read
 * untrusted/loosely-typed rows and want valid DTOs out.
 */
export function parseItems<Output>(
  parser: z.ZodType<Output>,
  items?: Record<string, unknown>[] | null,
): Output[] {
  return (items ?? []).map((item) => parseItem(parser, item)).filter(isNotNull);
}

export function parseItem<Output>(
  parser: z.ZodType<Output>,
  item?: Record<string, unknown> | null,
  camelCase = true,
): Output | null {
  // Absent input is "not found", not a parse failure — return null quietly.
  if (item == null) return null;

  const result = parser.safeParse(camelCase ? camelCaseDeep(item) : item);

  if (!result.success) {
    captureError(result.error);
    return null;
  }

  return result.data;
}

export function parseItemWithDefault<Output>(
  parser: z.ZodType<Output>,
  item?: unknown,
  defaultValue: Output | null = null,
): Output | null {
  const result = parser.safeParse(item);

  if (!result.success) return defaultValue;

  return result.data;
}

export function parseItemStrict<Output>(
  parser: z.ZodType<Output>,
  item?: Record<string, unknown> | null,
  camelCase = true,
): Output {
  const data = parseItem(parser, item, camelCase);

  if (data == null) {
    throw new ParserError(parser, item);
  }

  return data;
}

export function parseItemsStrict<Output>(
  parser: z.ZodType<Output>,
  items?: Record<string, unknown>[] | null,
): Output[] {
  return (items ?? []).map((item) => parseItemStrict(parser, item));
}

export function parseRequest<Output>(
  parser: z.ZodType<Output>,
  item?: Record<string, unknown> | null,
  camelCase = true,
): Output {
  return parser.parse(item && camelCase ? camelCaseDeep(item) : item);
}

export function validateItemStrict<T>(schema: z.ZodType, item: T): T {
  const result = schema.safeParse(item);
  if (!result.success) {
    throw new ParserError(schema, item);
  }
  return item;
}

export function parseEnum<Output>(
  parser: z.ZodType<Output>,
  item?: string | null,
): Output | null {
  const result = parser.safeParse(item);

  if (!result.success) return null;

  return result.data;
}

export function parseEnumStrict<Output>(
  parser: z.ZodType<Output>,
  item?: string | null,
): Output {
  const result = parser.safeParse(item);

  if (!result.success) {
    throw new ParserError(parser, item);
  }

  return result.data;
}

export function parseEnums<Output>(
  parser: z.ZodType<Output>,
  items?: string[] | null,
): Output[] {
  return (items ?? []).map((item) => parseEnum(parser, item)).filter(isNotNull);
}

export function isEnum<Output>(
  parser: z.ZodType<Output>,
  item?: string | null,
): boolean {
  return parser.safeParse(item).success;
}

export function parseItemsWithErrors<Output>(
  parser: z.ZodType<Output>,
  items: Record<string, unknown>[],
): {
  results: Output[];
  failed: { item: Record<string, unknown>; error: ZodError }[];
} {
  const results: Output[] = [];
  const failed: { item: Record<string, unknown>; error: ZodError }[] = [];

  for (const item of items ?? []) {
    const result = parser.safeParse(camelCaseDeep(item));
    if (result.success) {
      results.push(result.data);
    } else {
      failed.push({ item, error: result.error });
    }
  }

  return { results, failed };
}
