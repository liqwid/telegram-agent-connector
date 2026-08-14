import { describe, expect, it } from "vitest";

import {
  idListSchema,
  searchMessagesQuerySchema,
} from "@/controllers/chats";

describe("idListSchema", () => {
  it("parses comma-separated ids with whitespace", () => {
    expect(idListSchema.parse("120, 121,145")).toEqual([120, 121, 145]);
  });

  it("rejects non-numeric ids", () => {
    expect(idListSchema.safeParse("120,abc").success).toBe(false);
  });

  it("rejects non-positive ids", () => {
    expect(idListSchema.safeParse("0,5").success).toBe(false);
  });

  it("caps at 100 ids", () => {
    const ids = Array.from({ length: 150 }, (_, index) => index + 1).join(",");
    expect(idListSchema.parse(ids)).toHaveLength(100);
  });
});

describe("searchMessagesQuerySchema", () => {
  it("defaults to a browse-friendly shape", () => {
    expect(searchMessagesQuerySchema.parse({ chat: "@some_chat" })).toEqual({
      q: null,
      chat: "@some_chat",
      limit: 20,
      offsetId: null,
    });
  });

  it("accepts a paginated bulk request", () => {
    expect(
      searchMessagesQuerySchema.parse({
        q: "юрист, адвокат",
        chat: "@some_chat",
        limit: "300",
        offsetId: "4242",
      }),
    ).toEqual({
      q: ["юрист", "адвокат"],
      chat: "@some_chat",
      limit: 300,
      offsetId: 4242,
    });
  });

  it("rejects limits beyond the bulk cap", () => {
    expect(
      searchMessagesQuerySchema.safeParse({ q: "x", limit: "500" }).success,
    ).toBe(false);
  });
});
