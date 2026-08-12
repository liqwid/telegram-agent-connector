export function isNotNull<T>(element: T | null): element is T {
  return element != null;
}

export function isNotNullish<T>(element?: T | null): element is T {
  return element != null;
}

/**
 * Recursively converts snake_case object keys to camelCase. Useful when a data
 * source (e.g. SQL rows) returns snake_case columns that should be parsed into
 * camelCase DTOs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function camelCaseDeep(obj: any): unknown {
  if (typeof obj !== "object" || obj === null || obj instanceof Set) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(camelCaseDeep);
  }

  if (obj instanceof Date) {
    return obj;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newObj: any = {};
  for (const [key, value] of Object.entries(obj)) {
    newObj[key.replace(/_(.)/g, (_, c: string) => c.toUpperCase())] =
      camelCaseDeep(value);
  }
  return newObj;
}

export function base64UrlDecode(str: string): string {
  return Buffer.from(str, "base64url").toString("utf8");
}
