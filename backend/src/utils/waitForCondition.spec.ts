import { describe, expect, it } from "vitest";

import { waitForCondition } from "@/utils/waitForCondition";

describe("waitForCondition", () => {
  it("returns true immediately when the condition already holds", async () => {
    expect(await waitForCondition(() => true, 1000)).toBe(true);
  });

  it("returns true once the condition flips within the timeout", async () => {
    const state = { done: false };
    setTimeout(() => {
      state.done = true;
    }, 30);
    expect(await waitForCondition(() => state.done, 1000, 10)).toBe(true);
  });

  it("returns false when the timeout elapses first", async () => {
    expect(await waitForCondition(() => false, 50, 10)).toBe(false);
  });
});
