import { describe, expect, it } from "vitest";

import { createDeferred } from "@/utils/deferred";

describe("createDeferred", () => {
  it("resolves the promise from outside", async () => {
    const deferred = createDeferred<string>();
    deferred.resolve("value");
    await expect(deferred.promise).resolves.toBe("value");
  });

  it("rejects the promise from outside", async () => {
    const deferred = createDeferred<string>();
    deferred.reject(new Error("boom"));
    await expect(deferred.promise).rejects.toThrow("boom");
  });
});
